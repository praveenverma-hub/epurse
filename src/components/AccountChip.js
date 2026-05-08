import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';

const AccountChip = ({ account }) => (
  <View style={[styles.chip, { borderColor: account.color + '44' }]}>
    <View style={[styles.dot, { backgroundColor: account.color }]} />
    <View>
      <Text style={styles.name}>
        {account.name}
        {account.mask ? ` ··${account.mask}` : ''}
      </Text>
      <Text style={styles.amount}>{formatCompact(account.balance)}</Text>
    </View>
  </View>
);

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
