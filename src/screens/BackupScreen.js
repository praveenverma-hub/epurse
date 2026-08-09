// =============================================================================
// BackupScreen — encrypted Google Drive backup & restore.
//
// A pushed screen (ui-consistency §2b): it holds conditional sections, a
// destructive flow and rows that open sheets, all of which outgrow a bottom
// sheet. Plain chrome + centred title, matching Settings / Categories.
//
// The screen deliberately states the ONE thing users get wrong about
// end-to-end encryption: a forgotten password cannot be recovered by us, by
// Google, or by anyone. That warning is placed where the password is created —
// not buried in a help page — because it is the moment it matters.
//
// All logic lives in `backupService`; this file only renders state and collects
// input. Crypto and Drive are never touched from here.
// =============================================================================
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/Toast';
import CenterModal from '../components/CenterModal';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';
import InfoIcon from '../components/InfoIcon';
import GradientButton from '../components/GradientButton';
import { formatDateLabel } from '../utils/format';

import { isBackupConfigured } from '../backup/config';
import { generateRecoveryKey } from '../backup/random';
import * as auth from '../backup/googleAuth';
import {
  runBackup, listRemoteBackups, fetchAndDecrypt, applyRestore,
  removeRemoteBackup, getPreRestoreSnapshot, undoRestore,
} from '../backup/backupService';

const MIN_PASSWORD = 8;

const prettySize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const BackupScreen = ({ navigation, route }) => {
  // Opened from onboarding on a fresh device: there is nothing to back up yet, and
  // a successful restore has to land the user in the app rather than back on the
  // setup screen they came from.
  const fromOnboarding = !!route?.params?.fromOnboarding;
  const theme = useTheme();
  const toast = useToast();

  const [account, setAccount]   = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy]         = useState(null);   // progress string | null
  const [backups, setBackups]   = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [confirm, setConfirm]   = useState(null);

  // Password sheet: { mode: 'backup' | 'restore', file? }
  const [pwSheet, setPwSheet]   = useState(null);
  const [pw, setPw]             = useState('');
  const [pw2, setPw2]           = useState('');
  const [pwErr, setPwErr]       = useState('');
  // Recovery key mode (backup only). `saved` gates the submit: a key the user
  // hasn't stored is worse than a password, because there's nothing to remember.
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [keySaved, setKeySaved]       = useState(false);

  const configured = isBackupConfigured();

  const refresh = useCallback(async () => {
    const [inAcct, has, snap] = await Promise.all([
      auth.getSignedInAccount(), auth.isSignedIn(), getPreRestoreSnapshot(),
    ]);
    setAccount(inAcct);
    setSignedIn(has);
    setSnapshot(snap);
    if (has) {
      setLoadingList(true);
      try { setBackups(await listRemoteBackups()); }
      catch (e) { toast.warning('Could not load backups', e.message); }
      finally { setLoadingList(false); }
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── actions ────────────────────────────────────────────────────────────────
  const handleSignIn = async () => {
    try {
      setBusy('Opening Google');
      const { email } = await auth.signIn();
      toast.success('Connected', email ? `Backing up to ${email}` : 'Google account connected.');
      await refresh();
    } catch (e) {
      // Cancelling is a choice, not an error — don't scold the user for it.
      if (e.code !== 'CANCELLED') toast.error('Sign-in failed', e.message);
    } finally { setBusy(null); }
  };

  const handleSignOut = () => setConfirm({
    title: 'Disconnect Google?',
    message: 'ePurse will stop backing up. Backups already in your Drive are kept, and you can reconnect any time.',
    primaryText: 'Disconnect',
    secondaryText: 'Cancel',
    destructive: true,
    onConfirm: async () => {
      setConfirm(null);
      await auth.signOut();
      setBackups([]);
      await refresh();
      toast.info('Disconnected', 'Your existing backups were not deleted.');
    },
  });

  const openPassword = (mode, file) => {
    setPw(''); setPw2(''); setPwErr('');
    setRecoveryKey(null); setKeySaved(false);
    setPwSheet({ mode, file });
  };

  const useRecoveryKey = () => {
    // Generated on demand from the CSPRNG — 256 bits, so unlike a chosen password
    // it can't be guessed or brute-forced.
    const key = generateRecoveryKey();
    setRecoveryKey(key);
    setPw(key); setPw2(key); setPwErr('');
  };

  const copyKey = async () => {
    await Clipboard.setStringAsync(recoveryKey);
    setKeySaved(true);
    toast.info('Copied', 'Paste it somewhere safe — a password manager or notes.');
  };

  const submitPassword = async () => {
    const mode = pwSheet?.mode;
    if (recoveryKey && !keySaved) {
      setPwErr('Copy the key first — without it this backup can never be opened.');
      return;
    }
    // A recovery key IS the key material, so the password rules don't apply to it.
    if (!recoveryKey && pw.length < MIN_PASSWORD) {
      setPwErr(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (!recoveryKey && mode === 'backup' && pw !== pw2) {
      setPwErr("Those two passwords don't match.");
      return;
    }
    const file = pwSheet?.file;
    setPwSheet(null);

    if (mode === 'backup') {
      try {
        const created = await runBackup(pw, setBusy);
        toast.success('Backed up', `Encrypted and saved to Drive (${prettySize(created.size)}).`);
        await refresh();
      } catch (e) {
        toast.error('Backup failed', e.message);
      } finally { setBusy(null); }
      return;
    }

    // Restore: decrypt FIRST, then confirm — a wrong password must cost nothing.
    try {
      const { payload, meta } = await fetchAndDecrypt(file.id, pw, setBusy);
      setBusy(null);
      setConfirm({
        title: 'Replace everything on this device?',
        message:
          `This backup is from ${meta.device} on ${formatDateLabel(meta.createdAt)}.\n\n` +
          'Your current data will be replaced. You can undo this straight afterwards.',
        primaryText: 'Restore',
        secondaryText: 'Cancel',
        destructive: true,
        onConfirm: async () => {
          setConfirm(null);
          setBusy('Restoring');
          try {
            await applyRestore(payload);
            if (fromOnboarding) {
              // `initialRouteName` is only read once, so the restored hasOnboarded
              // flag can't move us on its own — reset the stack explicitly, and
              // drop Onboarding from history so Back can't return to setup.
              toast.success('Restored', 'Welcome back — your data is here.');
              navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
              return;
            }
            await refresh();
            toast.success('Restored', 'Your data is back. Undo is available on this screen.');
          } catch (e) {
            toast.error('Restore failed', e.message);
          } finally { setBusy(null); }
        },
      });
    } catch (e) {
      setBusy(null);
      toast.error(e.code === 'BAD_PASSWORD' ? 'Wrong password' : 'Could not restore', e.message);
    }
  };

  const handleUndo = () => setConfirm({
    title: 'Undo the restore?',
    message: 'This puts back the data that was on this device before you restored.',
    primaryText: 'Undo',
    secondaryText: 'Cancel',
    onConfirm: async () => {
      setConfirm(null);
      const ok = await undoRestore();
      await refresh();
      ok ? toast.success('Undone', 'Your previous data is back.')
         : toast.warning('Nothing to undo', 'That snapshot is no longer available.');
    },
  });

  const handleDelete = (file) => setConfirm({
    title: 'Delete this backup?',
    message: 'It will be removed from your Google Drive. This cannot be undone.',
    primaryText: 'Delete',
    secondaryText: 'Cancel',
    destructive: true,
    onConfirm: async () => {
      setConfirm(null);
      try { await removeRemoteBackup(file.id); toast.success('Deleted', 'The backup was removed.'); await refresh(); }
      catch (e) { toast.error('Could not delete', e.message); }
    },
  });

  const latest = backups[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{fromOnboarding ? 'Restore' : 'Backup'}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Not configured in this build ────────────────────────────────── */}
        {!configured ? (
          <View style={styles.card}>
            <SectionHeader icon="construct-outline" title="Not set up yet" accentColor={colors.warning} />
            <Text style={styles.hint}>
              This build has no Google client ID, so backup is unavailable. Nothing is wrong with your data.
            </Text>
          </View>
        ) : (
          <>
            {/* ── Google account ───────────────────────────────────────────── */}
            <View style={styles.card}>
              <SectionHeader icon="cloud-outline" title="Google Drive" accentColor={theme.primary} />
              <Text style={styles.hint}>
                {fromOnboarding
                  ? 'Sign in with the Google account you backed up to, and pick a backup to restore.'
                  : "Backups are encrypted on this device before they're uploaded. ePurse can only ever see "
                    + 'the files it created — never the rest of your Drive.'}
              </Text>

              {signedIn ? (
                <View style={styles.row}>
                  <Ionicons name="person-circle-outline" size={22} color={colors.textSecondary} style={styles.rowIcon} />
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{account || 'Google account'}</Text>
                    <Text style={styles.rowHint} numberOfLines={1}>Connected</Text>
                  </View>
                  <TouchableOpacity onPress={handleSignOut} hitSlop={8}>
                    <Text style={[styles.linkDanger]}>Disconnect</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <GradientButton title="Connect Google Drive" onPress={handleSignIn} />
              )}
            </View>

            {/* ── Back up now — pointless on a fresh device ────────────────── */}
            {signedIn && !fromOnboarding ? (
              <View style={styles.card}>
                <SectionHeader icon="shield-checkmark-outline" title="Your backup" accentColor={theme.primary} />
                <Text style={styles.hint}>
                  {latest
                    ? `Last backed up ${formatDateLabel(latest.modifiedTime)} · ${prettySize(latest.size)}`
                    : 'You have no backups yet.'}
                </Text>

                <View style={[styles.noteRow, { backgroundColor: theme.primary + '0F', borderColor: theme.primary + '33' }]}>
                  <InfoIcon size={14} color={theme.primary} />
                  <Text style={[styles.noteText, { color: theme.primary }]}>
                    Your original SMS messages are never uploaded — only the transactions ePurse read from them.
                  </Text>
                </View>

                <GradientButton title="Back up now" onPress={() => openPassword('backup')} />
              </View>
            ) : null}

            {/* ── Restore ──────────────────────────────────────────────────── */}
            {signedIn ? (
              <View style={styles.card}>
                <SectionHeader icon="cloud-download-outline" title="Restore" accentColor={theme.primary} />

                {loadingList ? (
                  <ActivityIndicator style={{ marginVertical: spacing.lg }} color={theme.primary} />
                ) : backups.length === 0 ? (
                  <EmptyState
                    compact
                    icon="cloud-offline-outline"
                    title="No backups found"
                    subtitle="Back up once and it will appear here — on this device and any other."
                  />
                ) : (
                  backups.map((f, i) => (
                    <View key={f.id} style={[styles.row, i > 0 && styles.rowDivided]}>
                      <Ionicons name="document-lock-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                      <View style={styles.rowTextWrap}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {f.appProperties?.device || 'Backup'}
                        </Text>
                        {/* Shown from Drive metadata — no download, no password needed. */}
                        <Text style={styles.rowHint} numberOfLines={1}>
                          {formatDateLabel(f.appProperties?.createdAt || f.modifiedTime)}
                          {f.size ? `  ·  ${prettySize(f.size)}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => openPassword('restore', f)} hitSlop={8} style={styles.restoreBtn}>
                        <Text style={[styles.link, { color: theme.primary }]}>Restore</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(f)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {/* ── Undo, only while a snapshot exists ───────────────────────── */}
            {snapshot ? (
              <TouchableOpacity style={styles.undoBtn} onPress={handleUndo} activeOpacity={0.8}>
                <Ionicons name="arrow-undo-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.undoText}>
                  Undo the restore from {formatDateLabel(new Date(snapshot.at).toISOString())}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* ── Password sheet ─────────────────────────────────────────────────── */}
      <Modal visible={!!pwSheet} transparent animationType="slide" onRequestClose={() => setPwSheet(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPwSheet(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {pwSheet?.mode === 'backup' ? 'Set a backup password' : 'Enter your backup password'}
            </Text>

            {pwSheet?.mode === 'backup' ? (
              <View style={[styles.warnRow, { backgroundColor: colors.danger + '0F', borderColor: colors.danger + '33' }]}>
                <Ionicons name="warning-outline" size={15} color={colors.danger} />
                <Text style={[styles.noteText, { color: colors.danger }]}>
                  If you forget this password, your backup can never be opened — not by ePurse, and
                  not by Google. Store it somewhere safe.
                </Text>
              </View>
            ) : null}

            {recoveryKey ? (
              <>
                {/* Shown in full, monospace, grouped in 4s — this is the one moment
                    the user can save it, so it must be readable and copyable. */}
                <View style={styles.keyBox}>
                  <Text style={styles.keyText} selectable>{recoveryKey}</Text>
                </View>
                <TouchableOpacity style={styles.copyBtn} onPress={copyKey} activeOpacity={0.8}>
                  <Ionicons
                    name={keySaved ? 'checkmark-circle' : 'copy-outline'}
                    size={16}
                    color={keySaved ? colors.success : theme.primary}
                  />
                  <Text style={[styles.copyText, { color: keySaved ? colors.success : theme.primary }]}>
                    {keySaved ? 'Copied — now store it somewhere safe' : 'Copy recovery key'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setRecoveryKey(null); setPw(''); setPw2(''); setKeySaved(false); }}>
                  <Text style={styles.switchLink}>Use a password instead</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  value={pw}
                  onChangeText={(t) => { setPw(t); setPwErr(''); }}
                  placeholder={pwSheet?.mode === 'backup' ? 'Backup password' : 'Password or recovery key'}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={pwSheet?.mode === 'backup'}
                  autoCapitalize="none"
                  autoFocus
                  style={[styles.input, !!pwErr && styles.inputError]}
                />
                {pwSheet?.mode === 'backup' ? (
                  <>
                    <TextInput
                      value={pw2}
                      onChangeText={(t) => { setPw2(t); setPwErr(''); }}
                      placeholder="Confirm password"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      autoCapitalize="none"
                      style={[styles.input, !!pwErr && styles.inputError]}
                    />
                    {/* The stronger option, offered but not pushed: most people
                        will pick a password, and a key they lose is unrecoverable. */}
                    <TouchableOpacity onPress={useRecoveryKey}>
                      <Text style={styles.switchLink}>
                        Can't remember passwords? Generate a recovery key instead
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </>
            )}
            {pwErr ? <Text style={styles.errText}>{pwErr}</Text> : null}

            <GradientButton
              title={pwSheet?.mode === 'backup' ? 'Encrypt & upload' : 'Unlock & restore'}
              disabled={!!recoveryKey && !keySaved}
              onPress={submitPassword}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </View>
      </Modal>

      {/* ── Progress ───────────────────────────────────────────────────────── */}
      <Modal visible={!!busy} transparent animationType="fade">
        <View style={styles.busyBackdrop}>
          <View style={styles.busyCard}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.busyText}>{busy}…</Text>
          </View>
        </View>
      </Modal>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText}
        secondaryText={confirm?.secondaryText}
        destructive={confirm?.destructive}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        onSecondary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1, textAlign: 'center' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.md, ...shadows.card,
  },
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },

  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md,
  },
  warnRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md,
  },
  noteText: { ...typography.tiny, fontWeight: '600', flex: 1, lineHeight: 16 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  rowIcon: { width: 22, textAlign: 'center' },
  rowTextWrap: { flex: 1 },
  rowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  rowHint: { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },
  link: { ...typography.small, fontWeight: '700' },
  linkDanger: { ...typography.small, fontWeight: '700', color: colors.danger },
  restoreBtn: { paddingHorizontal: spacing.xs },

  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider,
  },
  undoText: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },

  sheetBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xxl,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.background, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginBottom: spacing.sm, color: colors.textPrimary, ...typography.body,
  },
  inputError: { borderWidth: 1.5, borderColor: colors.danger },
  keyBox: {
    backgroundColor: colors.background, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  keyText: {
    // Monospace so 0/O and 1/I are distinguishable when transcribed by hand.
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14, lineHeight: 22, letterSpacing: 1,
    color: colors.textPrimary, textAlign: 'center',
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md,
  },
  copyText: { ...typography.small, fontWeight: '700' },
  switchLink: {
    ...typography.small, color: colors.textSecondary, fontWeight: '600',
    textAlign: 'center', paddingVertical: spacing.sm,
  },
  errText: { ...typography.tiny, color: colors.danger, marginBottom: spacing.xs, fontWeight: '600' },

  busyBackdrop: { flex: 1, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  busyCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', gap: spacing.md, minWidth: 200,
  },
  busyText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
});

export default BackupScreen;
