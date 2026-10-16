// =============================================================================
// GroupHistoryScreen — who added and changed what in a shared group (sync/history.ts),
// newest first. Axis `entityId`: one expense's full history under what it is now (the
// detail sheet's View All), or without it the whole group's (Group Detail's ⋮ → History).
// =============================================================================
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, shadows, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDate, titleCaseName } from '../utils/format';
import PlainScreenHeader from '../components/PlainScreenHeader';
import GroupHistoryList from '../components/GroupHistoryList';
import EmptyState from '../components/EmptyState';
import { entryHistory, entrySummary, groupHistory } from '../sync/history';
import type { Group } from '../types/group';

const typography = typographyBase as unknown as Record<string, TextStyle>;

interface Props {
  navigation: { goBack: () => void };
  route: { params: { groupId: string; entityId?: string } };
}

export default function GroupHistoryScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { groupId, entityId } = route.params;
  const group = useEPurseStore((s: any) => s.groups.find((g: Group) => g.id === groupId)) as Group | undefined;
  const shared = group?.shared;

  const items = useMemo(() => (entityId ? entryHistory(shared, entityId) : groupHistory(shared)), [shared, entityId]);
  const summary = useMemo(() => (entityId ? entrySummary(shared, entityId) : null), [shared, entityId]);

  const payer = summary && summary.kind === 'expense'
    ? `${summary.paidBy === 'You' ? 'You' : titleCaseName(summary.paidBy)} paid · `
    : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="History"
        onBack={() => navigation.goBack()}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <ScrollView
        style={[styles.scrollBody, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {summary ? (
          <View style={[styles.card, styles.summary]}>
            <View style={styles.summaryRow}>
              <Text style={styles.title} numberOfLines={2}>{summary.title}</Text>
              <Text style={styles.amount}>{formatCurrency(summary.amountPaise / 100)}</Text>
            </View>
            <Text style={styles.sub}>
              {payer}{formatDate(summary.date)}
              {summary.deleted ? <Text style={{ color: colors.danger }}> · Deleted</Text> : null}
            </Text>
          </View>
        ) : null}

        {items.length ? (
          <View style={styles.card}>
            <GroupHistoryList items={items} withTitle={!entityId} accentColor={theme.primary} />
          </View>
        ) : (
          <EmptyState compact icon="time-outline" title="Nothing has been added or changed yet." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, ...shadows.card,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  summary: { paddingVertical: spacing.md, gap: 4 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  title: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sub: { ...typography.small, color: colors.textSecondary },
});
