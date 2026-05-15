import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';

const AccountChip = ({ account, onPress }) => {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={[styles.chip, { borderColor: account.color + '44' }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.dot, { backgroundColor: account.color }]} />
      <View>
        <Text style={styles.name}>{account.name}</Text>
        <Text style={styles.amount}>{formatCompact(account.balance)}</Text>
      </View>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    marginRight: spacing.sm,
    ...shadows.card,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  name: { ...typography.tiny, color: colors.textSecondary },
  amount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
});

export default AccountChip;
