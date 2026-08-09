import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, shadows, spacing, typography } from '../constants/theme';
import { useLbGradients } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';

/**
 * Pair of cards showing money you've lent and money you owe.
 *
 * The app's ORIGINAL look: fixed emerald / violet with white text. Theme-derived
 * and theme-tinted versions were both built and reverted at the user's call —
 * these read as semantic colours (like success/danger), learned once and
 * constant, rather than as part of the accent.
 *
 * KNOWN, ACCEPTED: white on the light end of the emerald measures 2.54:1, under
 * the 4.5:1 minimum for the small helper line. Fixing it means darkening the
 * green, flipping to dark text, or laying a scrim over it — all three were tried
 * and all three lose the look this is deliberately keeping. Recorded in
 * ui-consistency §7 rather than silently "fixed"; the 26px amount is large text
 * and clears the 3:1 bar that applies to it.
 */
const LentBorrowedWidget = ({ lent, borrowed, onPressLent, onPressBorrowed }) => {
  const { lent: lentStops, borrowed: borrowedStops } = useLbGradients();

  return (
    <View style={styles.row}>
      <Card
        title="You Lent"
        amount={lent}
        helper="Money to receive"
        gradient={lentStops}
        onPress={onPressLent}
      />
      <Card
        title="You Borrowed"
        amount={borrowed}
        helper="Money to return"
        gradient={borrowedStops}
        onPress={onPressBorrowed}
      />
    </View>
  );
};

const Card = ({ title, amount, helper, gradient, onPress }) => {
  // White, flat, no scrim — the original treatment. See the note above for why
  // this deliberately isn't routed through gradientTextPlan.
  const ink = '#FFFFFF';
  // Nudged up from the original 0.80 / 0.70: on the lighter end of the emerald
  // these are the least legible text in the app, and opacity is the one lever
  // that costs the look nothing.
  const soft = 'rgba(255,255,255,0.92)';
  const faint = 'rgba(255,255,255,0.86)';

  return (
    <TouchableOpacity style={styles.cardWrap} activeOpacity={0.9} onPress={onPress}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Text style={[styles.title, { color: soft }]}>{title}</Text>
        <Text style={[styles.amount, { color: ink }]}>{formatCompact(amount)}</Text>
        <Text style={[styles.helper, { color: faint }]}>{helper}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cardWrap: { flex: 1, ...shadows.elevated, borderRadius: radius.lg },
  card: { borderRadius: radius.lg, padding: spacing.lg, overflow: 'hidden' },
  title: { ...typography.small, fontWeight: '600' },
  amount: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.sm,
  },
  helper: { ...typography.tiny, marginTop: 4 },
});

export default LentBorrowedWidget;
