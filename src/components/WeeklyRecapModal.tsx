// =============================================================================
// WeeklyRecapModal — the once-a-week "last week" recap.
// -----------------------------------------------------------------------------
// Shows a CENTERED modal on the first app-open after a week ends (driven by the
// store's `pendingWeeklyRecap`, set by maybeQueueWeeklyRecap). Renders the
// WeeklySummaryCard for the just-ended week. No persistent dashboard card — the
// weekly recap lives only here now.
// =============================================================================

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import WeeklySummaryCard from './WeeklySummaryCard';

interface Palette { textPrimary: string; textSecondary: string; textMuted: string; }

const WeeklyRecapModal: React.FC = () => {
  const theme = useTheme() as Palette;
  const pendingWeeklyRecap    = useEPurseStore((s) => s.pendingWeeklyRecap);
  const showWeeklySummary     = useEPurseStore((s) => s.showWeeklySummary);
  const clearPendingWeeklyRecap = useEPurseStore((s) => s.clearPendingWeeklyRecap);

  const visible = pendingWeeklyRecap != null && showWeeklySummary;
  const close = () => clearPendingWeeklyRecap();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <Text style={[styles.heading, { color: theme.textPrimary }]}>Last week, in numbers</Text>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>Here's how the week that just ended went.</Text>

            {pendingWeeklyRecap != null && (
              <WeeklySummaryCard anchorDate={new Date(pendingWeeklyRecap)} />
            )}

            <Pressable onPress={close} style={styles.doneBtn} hitSlop={8}>
              <Text style={[styles.doneText, { color: theme.textMuted }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default WeeklyRecapModal;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5, 8, 16, 0.6)' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420 },
  heading: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 16, paddingHorizontal: 12 },
  doneBtn: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 24, marginTop: 4 },
  doneText: { fontSize: 14, fontWeight: '700' },
});
