// =============================================================================
// RecapModalShell — the one shell both recap popups use.
//
// WeeklyRecapModal and MonthlyRecapModal were separate files repeating the same
// Modal props, the same backdrop colour, the same absolute-fill dismiss
// Pressable and the same dismiss-button styling. The only real differences were
// WHERE the content sits and what the button says — so those are the props, and
// everything else lives here once (ui-consistency §0).
//
// `align` is the named axis of variation, not a caller's name:
//   'center' — a card-sized moment (the weekly recap)
//   'bottom' — a taller sheet that reads better rising from the edge (monthly)
//
// Safe-area handling is the reason the centred variant existed in a broken state:
// `statusBarTranslucent` makes the modal span the FULL screen, behind the status
// bar and the nav bar. Centring against that raw box puts the content off the
// centre of the area the user can actually see, by however much those two bars
// differ. Both variants now pad by the real insets.
//
// The centred variant also scrolls. A card that fits a large phone can overflow
// a small one — or any phone at a large font scale — and a centred View with no
// scroll clips at BOTH ends with no way to reach the content. `flexGrow: 1` +
// `justifyContent: 'center'` keeps it centred when it fits and scrollable when
// it doesn't (the same idiom EmptyState uses, §3).
// =============================================================================

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';

interface Palette { textSecondary: string; textMuted: string; }

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Where the content sits. See the note above — this is the axis, not a flag. */
  align?: 'center' | 'bottom';
  /** Text of the dismiss button ("Done", "Maybe later"). */
  dismissLabel: string;
  children: React.ReactNode;
};

const RecapModalShell: React.FC<Props> = ({
  visible, onClose, align = 'center', dismissLabel, children,
}) => {
  const theme = useTheme() as Palette;
  const insets = useSafeAreaInsets();

  const dismiss = (
    <Pressable
      onPress={onClose}
      style={[styles.dismissBtn, { backgroundColor: `${theme.textMuted}1F` }]}
      hitSlop={8}
      accessibilityRole="button"
    >
      <Text style={[styles.dismissText, { color: theme.textSecondary }]}>{dismissLabel}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {align === 'bottom' ? (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
            <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
              {children}
              {dismiss}
            </View>
          </>
        ) : (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[
              styles.centerContent,
              { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
            ]}
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical={false}
          >
            {/* The dismiss layer lives INSIDE the scroll content, behind the
                sheet. Putting the ScrollView over an outer backdrop Pressable
                would swallow every tap and make tap-outside-to-close dead.
                A plain View sheet consumes its own taps (a touch propagates to
                ANCESTORS, never to a sibling behind), so tapping the card
                doesn't close it. */}
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
            <View style={styles.centerSheet}>
              {children}
              {dismiss}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

export default RecapModalShell;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5, 8, 16, 0.6)' },
  fill: { flex: 1 },
  bottomSheet: { marginTop: 'auto', paddingHorizontal: 16, paddingTop: 20 },
  centerContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  // Capped so the card doesn't stretch edge-to-edge on a tablet.
  centerSheet: { width: '100%', maxWidth: 420 },
  dismissBtn: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 16,   // radius.lg — pill is for chips only
  },
  dismissText: { fontSize: 14, fontWeight: '700' },
});
