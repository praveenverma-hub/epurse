// =============================================================================
// Backup service — the orchestration layer.
//
// Ties together the four pure pieces (payload → envelope → drive → auth) and is
// the ONLY module a screen should import. Screens never touch crypto or Drive
// directly, so there's exactly one place where the ordering guarantees live:
//
//   • the snapshot is written BEFORE state is replaced, never after
//   • pruning happens AFTER a successful upload, never before
//   • a failed restore leaves the device exactly as it was
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';

import { buildBackupPayload, readBackupPayload } from './payload';
import { sealBackup, openBackup, BackupError, toKeyMaterial, type BackupMeta } from './envelope';
import { randomBytes } from './random';
import { getAccessToken } from './googleAuth';
import {
  uploadBackup, listBackups, downloadBackup, deleteBackup, pruneBackups,
  type DriveDeps, type DriveBackupFile,
} from './driveClient';

const APP_VERSION = '1.5.0';
/**
 * zustand persist version — must match the store, so a restore can refuse a
 * backup written by a NEWER app than this one.
 *
 * Nothing enforced that by hand, so `backupDrive.test.mjs` now asserts this
 * constant equals the store's `version:` — the same source-of-truth check that
 * suite already does for the OAuth scheme in app.json.
 */
const STORE_VERSION = 24;

/** Local rollback copy, written immediately before a restore replaces state. */
const SNAPSHOT_KEY = '@ePurse:preRestoreSnapshot';

const deps = (): DriveDeps => ({ fetch: globalThis.fetch, getAccessToken });

const deviceLabel = (): string => {
  // Deliberately coarse. This lands in Drive's appProperties IN THE CLEAR, so it
  // must identify a device to its owner without identifying a person to anyone else.
  try {
    const { Platform } = require('react-native');
    return Platform.OS === 'ios' ? 'iPhone' : 'Android device';
  } catch { return 'device'; }
};

export type BackupProgress = (step: string) => void;

// ── Backup ───────────────────────────────────────────────────────────────────
export async function runBackup(password: string, onProgress?: BackupProgress): Promise<DriveBackupFile> {
  onProgress?.('Collecting your data');
  const payload = buildBackupPayload(
    useEPurseStore.getState() as unknown as Record<string, unknown>,
    useRewardStore.getState() as unknown as Record<string, unknown>,
  );

  onProgress?.('Encrypting');
  const meta: BackupMeta = {
    storeVersion: STORE_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    device: deviceLabel(),
  };
  // toKeyMaterial: a recovery key is normalised, a password is used verbatim.
  const envelope = sealBackup(payload, toKeyMaterial(password), meta, { randomBytes });

  onProgress?.('Uploading to Google Drive');
  const file = await uploadBackup(deps(), JSON.stringify(envelope), {
    // Plaintext on Google's servers — versions and a coarse device label only.
    createdAt: meta.createdAt,
    device: meta.device,
    appVersion: meta.appVersion,
    storeVersion: String(meta.storeVersion),
  });

  // Only now is it safe to drop older copies.
  onProgress?.('Tidying up');
  await pruneBackups(deps()).catch(() => 0);
  return file;
}

// ── Restore ──────────────────────────────────────────────────────────────────
export const listRemoteBackups = () => listBackups(deps());
export const removeRemoteBackup = (fileId: string) => deleteBackup(deps(), fileId);

/**
 * Download + decrypt WITHOUT touching app state, so a wrong password costs the
 * user nothing and they can simply retype it. Applying is a separate, explicit
 * step (`applyRestore`) — the UI shows what it found before overwriting anything.
 */
export async function fetchAndDecrypt(fileId: string, password: string, onProgress?: BackupProgress) {
  onProgress?.('Downloading');
  const raw = await downloadBackup(deps(), fileId);

  let envelope: any;
  try { envelope = JSON.parse(raw); }
  catch { throw new BackupError('UNSUPPORTED_FORMAT', 'That file is not a readable ePurse backup.'); }

  onProgress?.('Decrypting');
  const { payload, meta } = openBackup(envelope, toKeyMaterial(password));

  if (meta.storeVersion > STORE_VERSION) {
    throw new BackupError(
      'UNSUPPORTED_VERSION',
      'This backup came from a newer version of ePurse. Update the app, then restore.',
    );
  }
  return { payload: readBackupPayload(payload as any), meta };
}

/**
 * Replace local data with a decrypted payload.
 *
 * A snapshot of current state is written FIRST. Restoring is the one destructive
 * action in the app, and "I restored the wrong backup" needs a way back that
 * doesn't depend on the user having made another backup.
 */
export async function applyRestore(
  decrypted: { epurse: Record<string, unknown>; rewards: Record<string, unknown> },
): Promise<void> {

  const snapshot = buildBackupPayload(
    useEPurseStore.getState() as unknown as Record<string, unknown>,
    useRewardStore.getState() as unknown as Record<string, unknown>,
  );
  // Plaintext, but device-local and never uploaded — it's the same data the app
  // already holds in AsyncStorage, so it adds no new exposure.
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), snapshot }));

  useEPurseStore.setState(decrypted.epurse as any);
  if (decrypted.rewards && Object.keys(decrypted.rewards).length) {
    useRewardStore.setState(decrypted.rewards as any);
  }
}

export async function getPreRestoreSnapshot(): Promise<{ at: number } | null> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  try { const { at } = JSON.parse(raw); return { at }; } catch { return null; }
}

/** Undo the last restore. */
export async function undoRestore(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return false;
  try {
    const { snapshot } = JSON.parse(raw);
    const { epurse, rewards } = readBackupPayload(snapshot);
    useEPurseStore.setState(epurse as any);
    if (rewards && Object.keys(rewards).length) useRewardStore.setState(rewards as any);
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
    return true;
  } catch { return false; }
}
