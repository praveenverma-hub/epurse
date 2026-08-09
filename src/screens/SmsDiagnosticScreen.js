// =============================================================================
// SmsDiagnosticScreen
// -----------------------------------------------------------------------------
// Shows exactly what the native SMS module can see:
//   • READ_SMS permission status
//   • How many raw messages are in the inbox
//   • How many were parsed as financial transactions
//   • The first 10 raw message bodies so you can see the format
//   • Any native module errors
//
// Accessible from Dashboard → gear icon → "SMS Diagnostic"
// Useful when SMS auto-import isn't picking up transactions.
// =============================================================================

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Linking,
} from 'react-native';
import { PermissionsAndroid } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import {
  smsSupported, hasSmsPermission, requestSmsPermission, readInbox,
} from '../services/smsService';
import { parseMessageDetailed } from '../utils/messageParser';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useGradient } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import CenterModal from '../components/CenterModal';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

const STATUS = { idle: 'idle', running: 'running', done: 'done', error: 'error' };

export default function SmsDiagnosticScreen({ navigation }) {
  // Was the STATIC orange constant, so this screen ignored the theme entirely.
  const gradient = useGradient();
  const ingestMessage           = useEPurseStore((s) => s.ingestMessage);
  const setSmsPermissionGranted = useEPurseStore((s) => s.setSmsPermissionGranted);
  const setLastSmsSync          = useEPurseStore((s) => s.setLastSmsSync);
  const setLastSmsDate          = useEPurseStore((s) => s.setLastSmsDate);

  const [status, setStatus] = useState(STATUS.idle);
  const [log, setLog] = useState([]);   // array of { level, text } entries
  const [rawMessages, setRawMessages] = useState([]);
  const [parsedCount, setParsedCount] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [confirm, setConfirm] = useState(null);

  const addLog = useCallback((level, text) => {
    setLog((prev) => [...prev, { level, text, ts: new Date().toLocaleTimeString() }]);
  }, []);

  const runDiagnostic = useCallback(async () => {
    setStatus(STATUS.running);
    setLog([]);
    setRawMessages([]);
    setParsedCount(0);
    setImportedCount(0);

    try {
      // ── Step 1: Platform check ──────────────────────────────────────────
      addLog('info', `Platform: ${Platform.OS} (${Platform.Version})`);

      if (Platform.OS !== 'android') {
        addLog('warn', 'SMS reading is Android-only. iOS does not allow third-party SMS access.');
        setStatus(STATUS.done);
        return;
      }

      // ── Step 2: Native module check ─────────────────────────────────────
      addLog('info', `Native SMS module available: ${smsSupported ? '✅ YES' : '❌ NO'}`);
      if (!smsSupported) {
        addLog('error', 'Native module not linked. Rebuild the APK with: npm run deploy');
        setStatus(STATUS.error);
        return;
      }

      // ── Step 3: Permission check ────────────────────────────────────────
      const alreadyGranted = await hasSmsPermission();
      addLog('info', `READ_SMS permission: ${alreadyGranted ? '✅ GRANTED' : '❌ NOT GRANTED'}`);

      if (!alreadyGranted) {
        addLog('warn', 'Requesting permission now…');
        const { granted, neverAskAgain } = await requestSmsPermission();
        if (granted) {
          setSmsPermissionGranted(true);
          addLog('info', '✅ Permission granted just now');
        } else if (neverAskAgain) {
          addLog('error', 'Permission permanently denied. Enable in: Settings → Apps → ePurse → Permissions → SMS');
          setConfirm({
            title:         'Open Settings?',
            message:       'SMS is permanently denied. Open app settings to fix it.',
            primaryText:   'Open Settings',
            secondaryText: 'Cancel',
            onConfirm:     () => { setConfirm(null); Linking.openSettings(); },
          });
          setStatus(STATUS.error);
          return;
        } else {
          addLog('error', 'Permission denied. Grant SMS permission and run again.');
          setStatus(STATUS.error);
          return;
        }
      }

      // ── Step 4: Read inbox (last 90 days / 3 months) ────────────────────
      // Uses the same 3-month window as the retention policy so the diagnostic
      // backfills exactly the data the app is meant to track.
      const now3 = new Date();
      const since3mo = new Date(now3.getFullYear(), now3.getMonth() - 3, 1).getTime();
      addLog('info', `Reading SMS inbox from ${new Date(since3mo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}…`);
      const inbox = await readInbox(since3mo);
      addLog('info', `Raw messages returned: ${inbox.length}`);

      if (inbox.length === 0) {
        addLog('warn', 'Inbox returned 0 messages. Possible causes:');
        addLog('warn', '  • No SMS in the last 90 days');
        addLog('warn', '  • Play Protect blocking native module at runtime');
        addLog('warn', '  • Device stores SMS in a non-standard location');
        addLog('info', 'Try: Settings → Apps → ePurse → 3-dot menu → Allow restricted settings, then retry.');
        setStatus(STATUS.done);
        return;
      }

      // ── Step 5: Show first 10 raw messages ──────────────────────────────
      const preview = inbox.slice(0, 10).map((m) => {
        const parsed = parseMessageDetailed(m.body || '', { sender: m.address });
        const parserDebug = parsed?.ok
          ? `Parsed ${parsed.debug?.inferredType || '?'} · ₹${parsed.debug?.pickedAmount || 0} (${parsed.debug?.amountReason || 'n/a'}${parsed.debug?.amountKeyword ? ` · keyword: ${parsed.debug.amountKeyword}` : ''})`
          : `Rejected · ${parsed?.error?.code || 'unknown_error'}`;
        return {
          from: m.address || '?',
          body: m.body || '',
          date: m.date ? new Date(m.date).toLocaleDateString() : '?',
          parserDebug,
        };
      });
      setRawMessages(preview);

      // ── Step 6: Parse all messages ──────────────────────────────────────
      addLog('info', 'Running parser on all messages…');
      let parsed = 0;
      let imported = 0;
      let maxSmsDate = 0;

      const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));
      sorted.forEach((m) => {
        const result = parseMessageDetailed(m.body || '', { sender: m.address });
        if (result?.ok) {
          parsed++;
          const ingested = ingestMessage(m.body || '', {
            sender:     m.address,
            receivedAt: new Date(m.date).toISOString(),
            smsId:      String(m._id),   // dedup key — prevents double-counting
          });
          if (ingested) imported++;
        }
        // Advance cursor past every message we've seen, parsed or not
        if ((m.date || 0) > maxSmsDate) maxSmsDate = m.date;
      });

      setParsedCount(parsed);
      setImportedCount(imported);
      if (maxSmsDate > 0) setLastSmsDate(maxSmsDate);  // update date cursor
      setLastSmsSync(Date.now());

      addLog('info', `Messages matched as financial: ${parsed} / ${inbox.length}`);
      addLog('info', `New transactions added to store: ${imported}`);

      if (parsed === 0) {
        addLog('warn', 'Parser matched 0 messages. Your bank SMS format may not be recognised yet.');
        addLog('warn', 'Check the "Raw messages" section below and share a sample so we can add support.');
      } else {
        addLog('info', `✅ Done! ${imported} new transaction(s) imported.`);
      }

      setStatus(STATUS.done);
    } catch (e) {
      addLog('error', `Unexpected error: ${e?.message || e}`);
      setStatus(STATUS.error);
    }
  }, [addLog, ingestMessage, setSmsPermissionGranted, setLastSmsSync, setLastSmsDate]);

  const levelColor = (level) => {
    if (level === 'error') return '#EF4444';
    if (level === 'warn')  return '#F59E0B';
    return colors.textSecondary;
  };

  return (
    <View style={styles.root}>
      <CollapsingHeaderScreen
        collapsible={false}
        gradientColors={gradient}
        onBack={() => navigation.goBack()}
        title="SMS Diagnostic"
      >
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>
            This screen reads your SMS inbox directly and shows exactly what the app can see.
            Run it to diagnose why transactions aren't being imported.
          </Text>
        </View>

        {/* Run button */}
        <TouchableOpacity
          style={[styles.runBtn, status === STATUS.running && styles.runBtnDisabled]}
          activeOpacity={0.85}
          onPress={runDiagnostic}
          disabled={status === STATUS.running}
        >
          <LinearGradient
            colors={['#FF9F46', '#FF5A1F']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.runBtnGradient}
          >
            {status === STATUS.running
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.runBtnText}>
                  {status === STATUS.idle ? '▶  Run Diagnostic' : '↻  Run Again'}
                </Text>
            }
          </LinearGradient>
        </TouchableOpacity>

        {/* Log output */}
        {log.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📋  Log</Text>
            {log.map((entry, i) => (
              <View key={i} style={styles.logRow}>
                <Text style={styles.logTs}>{entry.ts}</Text>
                <Text style={[styles.logText, { color: levelColor(entry.level) }]}>
                  {entry.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats */}
        {status === STATUS.done && (
          <View style={styles.statsRow}>
            <StatCard label="Raw messages" value={rawMessages.length > 0 ? '≥ 10 shown' : '0'} color="#6366F1" />
            <StatCard label="Parsed" value={parsedCount} color="#10B981" />
            <StatCard label="Imported" value={importedCount} color="#FF5A1F" />
          </View>
        )}

        {/* Raw messages preview */}
        {rawMessages.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📨  First 10 raw messages</Text>
            <Text style={styles.cardSub}>
              These are the actual SMS bodies the app can read.
              Check if your bank messages appear here.
            </Text>
            {rawMessages.map((m, i) => (
              <View key={i} style={styles.msgCard}>
                <View style={styles.msgHeader}>
                  <Text style={styles.msgFrom}>{m.from}</Text>
                  <Text style={styles.msgDate}>{m.date}</Text>
                </View>
                <Text style={styles.msgBody}>{m.body}</Text>
                <Text style={styles.msgDebug}>{m.parserDebug}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Help section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔧  Troubleshooting</Text>

          <HelpItem
            title="App stuck on permission screen"
            body="On sideloaded APKs, go to: Settings → Apps → ePurse → three-dot menu → Allow restricted settings. Then restart the app."
          />
          <HelpItem
            title="0 messages returned"
            body="Play Protect may be blocking SMS access at runtime. Disable Play Protect temporarily, run the diagnostic, then re-enable it."
          />
          <HelpItem
            title="Messages shown but 0 parsed"
            body="Your bank uses a format the parser doesn't recognise yet. Copy one of the raw message bodies above and share it — we can add support."
          />
          <HelpItem
            title="Transactions imported but not showing"
            body="Go back to Dashboard and pull down to refresh. Transactions are sorted newest-first."
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </CollapsingHeaderScreen>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        onSecondary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      />
    </View>
  );
}

// ── Small components ──────────────────────────────────────────────────────────
const StatCard = ({ label, value, color }) => (
  <View style={[statStyles.card, { borderTopColor: color }]}>
    <Text style={[statStyles.value, { color }]}>{value}</Text>
    <Text style={statStyles.label}>{label}</Text>
  </View>
);

const HelpItem = ({ title, body }) => (
  <View style={helpStyles.item}>
    <Text style={helpStyles.title}>{title}</Text>
    <Text style={helpStyles.body}>{body}</Text>
  </View>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.lg },

  infoBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  infoText: { color: '#1D4ED8', ...typography.small, lineHeight: 18 },

  runBtn: { borderRadius: radius.lg, overflow: 'hidden', ...shadows.card },
  runBtnDisabled: { opacity: 0.6 },
  runBtnGradient: {
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  runBtnText: { color: '#fff', ...typography.body, fontWeight: '800', fontSize: 16 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardSub: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.xs },

  logRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  logTs: { ...typography.tiny, color: colors.textSecondary, minWidth: 55 },
  logText: { ...typography.small, flex: 1 },

  statsRow: { flexDirection: 'row', gap: spacing.md },

  msgCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  msgFrom: { ...typography.small, fontWeight: '700', color: colors.primary },
  msgDate: { ...typography.tiny, color: colors.textSecondary },
  msgBody: { ...typography.small, color: colors.textPrimary, lineHeight: 18 },
  msgDebug: { ...typography.tiny, color: colors.textSecondary, marginTop: 6 },
});

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderTopWidth: 3,
    ...shadows.card,
  },
  value: { fontSize: 22, fontWeight: '800' },
  label: { ...typography.tiny, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
});

const helpStyles = StyleSheet.create({
  item: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: { ...typography.small, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  body: { ...typography.small, color: colors.textSecondary, lineHeight: 18 },
});
