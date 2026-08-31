// =============================================================================
// SheetCloseButton — the app's ONE close affordance for bottom sheets.
//
// A circular ✕ that floats on the BACKDROP just above the sheet's top-right
// corner, so it never eats space inside the sheet and sits in the same place on
// every sheet.
//
// Usage — render it as the sibling immediately BEFORE the sheet view, inside the
// backdrop's flex-end container:
//
//   <View style={styles.backdrop}>                 // flex:1, justifyContent:'flex-end'
//     <TouchableOpacity style={styles.dismiss} onPress={onClose} />  // tap-away area
//     <SheetCloseButton onPress={onClose} />
//     <View style={styles.sheet}>…</View>
//   </View>
//
// Because it's outside the sheet, a sheet needs NO bottom "Close" button — drop
// those. Keep buttons that do real work (Save / Add / Done / Got it / Claim).
// =============================================================================
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';

interface SheetCloseButtonProps {
  onPress: () => void;
  /**
   * Horizontal inset of the button from the screen edge. Match the sheet's own
   * horizontal padding so the ✕ lines up with the sheet's content column.
   */
  gutter?: number;
  /** Set on dark/bespoke sheets (Profile / Shop, debug) for a legible contrast. */
  dark?: boolean;
  /**
   * `flow` (default) — render as the sibling immediately BEFORE the sheet, inside
   *   a flex-end backdrop. Preferred: it can never be clipped.
   * `absolute` — render as the FIRST CHILD of the sheet, lifted above its top edge
   *   with a negative offset. Use for sheets whose container is
   *   `position:'absolute'; bottom:0` (no flex-end parent to insert into).
   *   The sheet must NOT set `overflow:'hidden'`, or the ✕ gets clipped.
   */
  variant?: 'flow' | 'absolute';
}

const SheetCloseButton: React.FC<SheetCloseButtonProps> = ({
  onPress,
  gutter = spacing.lg,
  dark,
  variant = 'flow',
}) => (
  // pointerEvents box-none so the row itself stays tap-through to the backdrop —
  // only the circle is tappable, not the empty space beside it.
  <View
    style={
      variant === 'absolute'
        ? [styles.absolute, { right: gutter }]
        : [styles.row, { paddingHorizontal: gutter }]
    }
    pointerEvents="box-none"
  >
    <TouchableOpacity
      style={[styles.btn, dark && styles.btnDark]}
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <Ionicons name="close" size={20} color={dark ? '#fff' : colors.textPrimary} />
    </TouchableOpacity>
  </View>
);

export default SheetCloseButton;

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', marginBottom: spacing.sm },
  // Lifted just above the sheet's top edge: 36px button + 8px gap.
  absolute: { position: 'absolute', top: -44, zIndex: 20 },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18, // circle
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifts the circle off the dimmed backdrop.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  btnDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
});
