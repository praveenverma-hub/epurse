import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';

/**
 * Pair of horizontally-placed cards showing money you've lent and money you owe.
 * The visual is a Swiggy-style "boxed" layout — soft shadow, gradient fill.
 */
const LentBorrowedWidget = ({ lent, borrowed, onPressLent, onPressBorrowed }) => {
  return (
    <View style={styles.row}>
      <Card
        title="You Lent"
        amount={lent}
        helper="Money to receive"
        gradient={[colors.gradientGreenStart, colors.gradientGreenEnd]}
        onPress={onPressLent}
      />
      <Card
        title="You Borrowed"
        amount={borrowed}
        helper="Money to return"
        gradient={[colors.gradientPurpleStart, colors.gradientPurpleEnd]}
        onPress={onPressBorrowed}
      />
    </View>
  );
};

const Card = ({ title, amount, helper, gradient, onPress }) => (
  <TouchableOpacity style={styles.cardWrap} activeOpacity={0.9} onPress={onPress}>
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.amount}>{formatCompact(amount)}</Text>
      <Text style={styles.helper}>{helper}</Text>
    </LinearGradient>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  cardWrap: { flex: 1, ...shadows.elevated, borderRadius: radius.lg },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.small, color: '#FFFFFFCC', fontWeight: '600' },
  amount: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.sm,
  },
  helper: { ...typography.tiny, color: '#FFFFFFB3', marginTop: 4 },
});

export default LentBorrowedWidget;
