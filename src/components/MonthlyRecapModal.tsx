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

interface Palette { textSecondary: string; textMuted: string; }

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
          {/* No separate heading here — the card's own header ("{month} recap")
              already says what this is; a second title outside its background
              just floated oddly over the backdrop. */}
          {pendingMonthlyRecap && (
            <MonthlyRecapCard monthKey={pendingMonthlyRecap} isNew onDownloaded={close} />
          )}

          <Pressable
            onPress={close}
            style={[styles.later, { backgroundColor: `${theme.textMuted}1F` }]}
            hitSlop={8}
          >
            <Text style={[styles.laterText, { color: theme.textSecondary }]}>Maybe later</Text>
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
  later: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 16,   // radius.lg — pill is for chips only
  },
  laterText: { fontSize: 14, fontWeight: '700' },
});
