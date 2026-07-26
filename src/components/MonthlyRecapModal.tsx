// =============================================================================
// MonthlyRecapModal — the one-time month-end moment.
// -----------------------------------------------------------------------------
// Shows once on the first app-open after a new month begins (driven by the
// store's `pendingMonthlyRecap`, set by maybeQueueMonthlyRecap). Wraps the same
// MonthlyRecapCard used on the Dashboard, under a celebratory header. Closing
// leaves the persistent card behind, so the recap is never lost. This replaces
// the old standalone CelebrationModal at rollover — one popup, not two.
// =============================================================================

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import MonthlyRecapCard from './MonthlyRecapCard';

interface Palette { card: string; primary: string; textPrimary: string; textSecondary: string; textMuted: string; }

const MonthlyRecapModal: React.FC = () => {
  const theme = useTheme() as Palette;
  const insets = useSafeAreaInsets();
  const pendingMonthlyRecap    = useEPurseStore((s) => s.pendingMonthlyRecap);
  const showMonthlyRecap       = useEPurseStore((s) => s.showMonthlyRecap);
  const clearPendingMonthlyRecap = useEPurseStore((s) => s.clearPendingMonthlyRecap);

  const visible = !!pendingMonthlyRecap && showMonthlyRecap;
  const close = () => clearPendingMonthlyRecap();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>Your month is wrapped 🎉</Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>Here's how last month went — download the full report anytime.</Text>

          {pendingMonthlyRecap && (
            <MonthlyRecapCard monthKey={pendingMonthlyRecap} isNew onDownloaded={close} />
          )}

          <Pressable onPress={close} style={styles.later} hitSlop={8}>
            <Text style={[styles.laterText, { color: theme.textMuted }]}>Maybe later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

export default MonthlyRecapModal;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5, 8, 16, 0.6)', justifyContent: 'flex-end' },
  sheet: { paddingHorizontal: 16, paddingTop: 20 },
  heading: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 16, paddingHorizontal: 12 },
  later: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20 },
  laterText: { fontSize: 14, fontWeight: '700' },
});
