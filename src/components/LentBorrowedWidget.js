import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, shadows, spacing, typography } from '../constants/theme';
import { useLbCard } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';

/**
 * Pair of cards showing money you've lent and money you owe.
 * Pastel fill with coloured ink (Sep-23-26) — replaced the saturated gradient +
 * white text, which never cleared contrast on its light end. Colours: `LB_CARD`.
 */
const LentBorrowedWidget = ({ lent, borrowed, onPressLent, onPressBorrowed }) => {
  const card = useLbCard();

  return (
    <View style={styles.row}>
      <Card
        title="You Lent"
        amount={lent}
        helper="Money to receive"
        palette={card.lent}
        onPress={onPressLent}
      />
      <Card
        title="You Borrowed"
        amount={borrowed}
        helper="Money to return"
        palette={card.borrowed}
        onPress={onPressBorrowed}
      />
    </View>
  );
};

const Card = ({ title, amount, helper, palette, onPress }) => (
  <TouchableOpacity style={styles.cardWrap} activeOpacity={0.9} onPress={onPress}>
    <LinearGradient
      colors={palette.background}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.amount, { color: palette.amount }]}>{formatCompact(amount)}</Text>
      <Text style={[styles.helper, { color: palette.text }]}>{helper}</Text>
    </LinearGradient>
  </TouchableOpacity>
);

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
