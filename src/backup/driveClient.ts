// =============================================================================
// Google Drive REST client — the only code that talks to Google.
//
// No SDK: four endpoints is less surface than a dependency, and it keeps the
// bundle free of a library that would drag in its own auth stack.
//
// `fetch` and the token getter are INJECTED, so every path — including the ones
// that matter most (401 refresh, checksum mismatch, quota exceeded) — is
// testable headlessly. Nothing here knows about encryption: it moves opaque
// bytes, which is exactly the boundary that keeps plaintext off the network.
// =============================================================================
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { BACKUP_FILE_PREFIX, BACKUP_MIME, KEEP_BACKUPS } from './config';
import { utf8ToBytes } from './envelope';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export type DriveDeps = {
  fetch: typeof fetch;
  /** Returns a valid access token, refreshing it if needed. */
  getAccessToken: () => Promise<string>;
};

export type DriveBackupFile = {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
  /** Mirrors the envelope header so the restore list can show details
   *  WITHOUT downloading or decrypting anything. */
  appProperties?: Record<string, string>;
};

export type DriveErrorCode =
  | 'UNAUTHORIZED'    // token bad/revoked even after a refresh → re-auth
  | 'QUOTA'           // the user's Drive is full — their action, not a bug
  | 'NOT_FOUND'       // backup deleted from Drive since we listed it
  | 'NETWORK'         // offline / DNS / timeout
  | 'CHECKSUM'        // uploaded bytes don't match what we sent
  | 'DRIVE';          // anything else, with Google's message attached

export class DriveError extends Error {
  code: DriveErrorCode;
  status?: number;
  constructor(code: DriveErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'DriveError';
    this.code = code;
    this.status = status;
  }
}

/** Map an HTTP failure to something the UI can act on. */
async function toDriveError(res: Response): Promise<DriveError> {
  let detail = '';
  try { detail = (await res.text()).slice(0, 300); } catch { /* body already consumed */ }
  if (res.status === 401 || res.status === 403) {
    // 403 is overloaded: quota vs permission. The body distinguishes them.
    if (/quota|storageQuotaExceeded/i.test(detail)) {
      return new DriveError('QUOTA', 'Your Google Drive is full. Free up space and try again.', res.status);
    }
    return new DriveError('UNAUTHORIZED', 'Google access was denied. Sign in again to continue.', res.status);
  }
  if (res.status === 404) return new DriveError('NOT_FOUND', 'That backup no longer exists in Drive.', 404);
  return new DriveError('DRIVE', `Google Drive error ${res.status}. ${detail}`, res.status);
}

/**
 * One retry on 401 ONLY. A refreshed token fixes an expired one; a second 401
 * means the grant is gone, and retrying past that would spin.
 */
async function authed(deps: DriveDeps, url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await deps.getAccessToken();
  let res: Response;
  try {
    res = await deps.fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    throw new DriveError('NETWORK', 'No connection to Google Drive. Check your network and try again.');
  }
  if (res.status === 401 && !retried) return authed(deps, url, init, true);
  return res;
}

const backupName = (iso: string) => `${BACKUP_FILE_PREFIX}-${iso.replace(/[:.]/g, '-')}.json`;

/**
 * Upload one backup. Multipart (metadata + bytes in a single request) is right
 * here because our payload is tens of KB — resumable upload's extra round trips
 * would cost more than they save.
 */
export async function uploadBackup(
  deps: DriveDeps,
  body: string,
  appProperties: Record<string, string>,
): Promise<DriveBackupFile> {
  const boundary = `epurse${Math.abs(hashString(body)).toString(36)}`;
  const metadata = {
    name: backupName(appProperties.createdAt || new Date().toISOString()),
    mimeType: BACKUP_MIME,
    // Drive caps appProperties; keep to the few non-sensitive fields the restore
    // list needs. NEVER amounts or names — Google stores these in the clear.
    appProperties,
  };
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${BACKUP_MIME}\r\n\r\n${body}\r\n` +
    `--${boundary}--`;

  const res = await authed(deps, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum,appProperties`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw await toDriveError(res);

  const file = await res.json();
  // Verify the bytes landed intact. A truncated upload would otherwise sit in
  // Drive looking like a valid backup until the day someone needed it.
  if (file.md5Checksum && file.md5Checksum !== md5Hex(body)) {
    throw new DriveError('CHECKSUM', 'The backup uploaded incompletely. Please try again.');
  }
  return file as DriveBackupFile;
}

/** Newest first. Only ever returns files THIS app created (drive.file scope). */
export async function listBackups(deps: DriveDeps): Promise<DriveBackupFile[]> {
  const q = encodeURIComponent(`name contains '${BACKUP_FILE_PREFIX}' and trashed = false`);
  const fields = encodeURIComponent('files(id,name,size,modifiedTime,appProperties)');
  const res = await authed(deps, `${DRIVE_API}/files?q=${q}&orderBy=modifiedTime desc&fields=${fields}&pageSize=25`);
  if (!res.ok) throw await toDriveError(res);
  const json = await res.json();
  return (json.files || []) as DriveBackupFile[];
}

export async function downloadBackup(deps: DriveDeps, fileId: string): Promise<string> {
  const res = await authed(deps, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!res.ok) throw await toDriveError(res);
  return res.text();
}

export async function deleteBackup(deps: DriveDeps, fileId: string): Promise<void> {
  const res = await authed(deps, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  // 404 means it's already gone — that's the desired end state, not a failure.
  if (!res.ok && res.status !== 404) throw await toDriveError(res);
}

/**
 * Keep the newest KEEP_BACKUPS. Runs AFTER a successful upload, never before —
 * pruning first would risk deleting the only good copy if the upload then fails.
 * Individual delete failures are swallowed: a stale extra file is harmless, and
 * failing the whole backup over cleanup would be worse.
 */
export async function pruneBackups(deps: DriveDeps, keep = KEEP_BACKUPS): Promise<number> {
  const files = await listBackups(deps);
  const stale = files.slice(keep);
  let removed = 0;
  for (const f of stale) {
    try { await deleteBackup(deps, f.id); removed += 1; } catch { /* best effort */ }
  }
  return removed;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

/**
 * MD5 of the bytes we sent, to compare against the md5Checksum Drive reports.
 * MD5 is broken for AUTHENTICITY and must never be used for that — but this is a
 * TRANSPORT-integrity check (did all the bytes arrive?), and Drive only offers
 * md5. Authenticity is already covered, and covered properly, by AES-GCM's tag.
 * From @noble/hashes, which is already a dependency for scrypt.
 */
function md5Hex(body: string): string {
  // utf8ToBytes, not TextEncoder — Hermes has no TextEncoder (see envelope.ts).
  return bytesToHex(md5(utf8ToBytes(body)));
}
