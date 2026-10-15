// =============================================================================
// GroupHistoryList — who changed what in a shared group, and when (sync/history.ts).
// One list for both places: an expense's own history in TxnDetailSheet, and the whole
// group's from Group Detail's ⋮ → History. Axis `withTitle`: the group list names the
// expense on each row; inside one expense's sheet that would only repeat its title.
// =============================================================================
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography as typographyBase } from '../constants/theme';
import { formatCurrency, formatDateTime, titleCaseName } from '../utils/format';
import type { HistoryChange, HistoryItem } from '../sync/history';

const typography = typographyBase as any;

const ICON = { added: 'add-circle-outline', edited: 'create-outline', deleted: 'trash-outline' } as const;
const VERB = { added: 'Added', edited: 'Edited', deleted: 'Deleted' } as const;
const CHANGE: Record<Exclude<HistoryChange, 'amount'>, string> = {
  payer: 'Who Paid', split: 'Split', title: 'Title', date: 'Date', category: 'Category',
};
const rupees = (paise: number) => formatCurrency(paise / 100);

function detail(it: HistoryItem, withTitle: boolean): string {
  if (it.action !== 'edited') return withTitle && it.amountPaise ? rupees(it.amountPaise) : '';
  return (it.changes ?? []).map((c) => (c === 'amount' && it.prevAmountPaise != null
    ? `${rupees(it.prevAmountPaise)} → ${rupees(it.amountPaise)}`
    : c === 'amount' ? 'Amount' : CHANGE[c])).join(' · ');
}

interface Props {
  items: HistoryItem[];
  /** Name the expense on each row (the whole group's list). */
  withTitle?: boolean;
  accentColor: string;
}

export default function GroupHistoryList({ items, withTitle = false, accentColor }: Props) {
  return (
    <View>
      {items.map((it, i) => {
        const who = it.by === 'You' ? 'You' : titleCaseName(it.by);
        const head = withTitle ? `${who} ${VERB[it.action].toLowerCase()} ${it.title}` : `${VERB[it.action]} by ${who}`;
        const more = detail(it, withTitle);
        return (
          <View key={`${it.entityId}-${it.seq}-${it.action}`} style={[styles.row, i > 0 && styles.divider]}>
            <Ionicons name={ICON[it.action]} size={18} color={it.action === 'deleted' ? colors.danger : accentColor} />
            <View style={styles.body}>
              <Text style={styles.head} numberOfLines={2}>{head}</Text>
              {more ? <Text style={styles.sub} numberOfLines={2}>{more}</Text> : null}
              <Text style={styles.when}>{formatDateTime(it.at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  body: { flex: 1 },
  head: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  sub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  when: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
});
