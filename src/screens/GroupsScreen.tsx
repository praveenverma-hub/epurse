// =============================================================================
// GroupsScreen — "Groups" tab, level 1: an overall summary built from real
// shared-group balances (never a personal group's own tracked spend), an
// All/Owed-to-you/You-owe filter, and one balance card per group. Tapping a
// card pushes GroupDetailScreen (level 2: hero, actions, Transactions/Members/
// Summary tabs). The FAB creates a new group — adding an EXPENSE now lives
// inside a group's own detail screen.
// =============================================================================
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme, useGradient } from '../hooks/useTheme';
import { useHeaderStatusBar } from '../hooks/useHeaderStatusBar';
import { formatCurrency, monthKey } from '../utils/format';
import { countsForSpend, spendContribution } from '../utils/split';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import FAB from '../components/FAB';
import EmptyState from '../components/EmptyState';
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';
import SectionHeader from '../components/SectionHeader';
import type { Group } from '../types/group';

type Filter = 'all' | 'owed' | 'owe';

function GroupListCardRow({
  group, net, personalMonth, onPress,
}: { group: Group; net: number; personalMonth: number; onPress: () => void }) {
  const isShared = group.type === 'shared';
  const accent = group.color || '#6366F1';
  const settled = Math.abs(net) < 0.005;
  // Shared groups read their state at a glance — a faded wash + thin border of
  // the SAME colour the balance is printed in (lent/borrowed/settled), the same
  // fill+border ratio the settled badge elsewhere in the app already uses.
  // Personal groups have no such state, so they keep the flat card.
  const stateColor = !isShared ? null : settled ? colors.success : net > 0 ? colors.lent : colors.borrowed;
  return (
    // The shadow needs its own OPAQUE shell — Android's `elevation` under a
    // translucent fill (the state wash) renders as a muddy grey/olive box
    // instead of a real shadow, which is what a see-through backgroundColor
    // directly on an elevated view produced here.
    <View style={styles.groupCardShadow}>
    <TouchableOpacity
      style={[styles.groupCard, stateColor ? { backgroundColor: stateColor + '14', borderColor: stateColor + '44' } : null]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.groupIconTile, { backgroundColor: accent + '22' }]}>
        <Text style={styles.groupIconEmoji}>{group.emoji || (isShared ? '👥' : '📁')}</Text>
      </View>
      <View style={{ flex: 1, marginRight: spacing.sm }}>
        <Text style={styles.groupCardName} numberOfLines={1}>{group.name}</Text>
        <Text style={styles.groupCardMeta} numberOfLines={1}>
          {isShared ? `${group.members?.length ?? 0} members` : 'Personal'}
          {group.excludeFromTotals ? ' · excluded' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {isShared ? (
          settled ? (
            <Text style={[styles.groupCardBalance, { color: colors.success }]}>Settled up</Text>
          ) : (
            <>
              <Text style={[styles.groupCardBalance, { color: net > 0 ? colors.lent : colors.borrowed }]} numberOfLines={1}>
                {formatCurrency(Math.abs(net))}
              </Text>
              <Text style={[styles.groupCardBalanceLabel, { color: net > 0 ? colors.lent : colors.borrowed }]}>
                {net > 0 ? 'lent' : 'borrowed'}
              </Text>
            </>
          )
        ) : (
          <>
            <Text style={styles.groupCardBalance} numberOfLines={1}>{formatCurrency(personalMonth)}</Text>
            <Text style={styles.groupCardBalanceLabel}>this month</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
    </View>
  );
}

export default function GroupsScreen({ navigation }: { navigation: any }) {
  const theme = useTheme();
  const gradient = useGradient();
  const insets = useSafeAreaInsets();
  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const transactions = useEPurseStore((s: any) => s.transactions) as any[];
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed) as any[];
  const { onScroll } = useTabBarScroll();

  const [infoVisible, setInfoVisible] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // Reported by CollapsingHeaderScreen once the header has gone light (pinned) —
  // drives both the status-bar glyph colour and the bar row's own ink.
  const [headerPinned, setHeaderPinned] = useState(false);
  useHeaderStatusBar(headerPinned);

  const orderedGroups = useMemo(
    () => [...groups].sort(
      (a, b) => new Date(b.lastActivityAt || b.createdAt || 0).getTime()
              - new Date(a.lastActivityAt || a.createdAt || 0).getTime(),
    ),
    [groups],
  );

  const hasSharedGroups = useMemo(() => groups.some((g) => g.type === 'shared'), [groups]);

  // Net per GROUP (not per person) — a straight sum of every group-tagged LB
  // row, regardless of who it's with. This is what makes the top summary and
  // the chips reflect REAL shared-group balances, never a personal group's own
  // (unrelated) tracked spend, which never produces a group-tagged LB row.
  const groupNetById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of lentBorrowed) {
      if (!e.groupId) continue;
      const delta = e.kind === 'lent' ? e.amount
        : e.kind === 'lent_settled' ? -e.amount
        : e.kind === 'borrowed' ? -e.amount
        : e.kind === 'borrow_repaid' ? e.amount : 0;
      m[e.groupId] = (m[e.groupId] || 0) + delta;
    }
    return m;
  }, [lentBorrowed]);

  const totals = useMemo(() => {
    let owed = 0, owe = 0;
    for (const g of groups) {
      const n = groupNetById[g.id] || 0;
      if (n > 0.005) owed += n; else if (n < -0.005) owe += -n;
    }
    return { owed, owe, net: owed - owe };
  }, [groups, groupNetById]);

  // Personal groups' CURRENT-month total (they're tracked monthly, not all-time).
  const personalMonthTotalById = useMemo(() => {
    const now = monthKey(new Date());
    const m: Record<string, number> = {};
    for (const t of transactions) {
      if (!t.groupId || t.isIgnored || !countsForSpend(t)) continue;
      if (monthKey(t.createdAt) !== now) continue;
      m[t.groupId] = (m[t.groupId] || 0) + spendContribution(t);
    }
    for (const k of Object.keys(m)) if (m[k] < 0) m[k] = 0;
    return m;
  }, [transactions]);

  const filteredGroups = useMemo(() => {
    if (filter === 'owed') return orderedGroups.filter((g) => (groupNetById[g.id] || 0) > 0.005);
    if (filter === 'owe') return orderedGroups.filter((g) => (groupNetById[g.id] || 0) < -0.005);
    return orderedGroups;
  }, [orderedGroups, groupNetById, filter]);

  const openCreate = () => navigation.navigate('GroupForm');

  const CHIPS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'owed', label: 'Owed to You' },
    { key: 'owe', label: 'You Owe' },
  ];

  const isEmpty = groups.length === 0;

  // ONE function for both bar states (ui-consistency §2 rule 2) — `onLight`
  // decides ink only; the row itself, the handler and the a11y contract never
  // fork. Expanded = on-gradient (white); pinned = on `theme.card` (dark).
  const groupsBar = (onLight: boolean) => (
    <View style={styles.barRow}>
      <Text
        style={[styles.barTitle, { color: onLight ? colors.textPrimary : '#fff' }]}
        numberOfLines={1}
      >
        Groups
      </Text>
      <TouchableOpacity onPress={() => setInfoVisible(true)} hitSlop={10} style={styles.infoBtn}>
        <InfoIcon size={22} color={onLight ? colors.textSecondary : '#FFFFFFCC'} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <CollapsingHeaderScreen
        gradientColors={gradient}
        onCollapseChange={setHeaderPinned}
        renderBar={() => groupsBar(false)}
        renderCollapsedBar={() => groupsBar(true)}
        // The hero is two stacked text/card blocks whose height depends on
        // whether there's a shared-group summary to show — never pin a real
        // heroHeight for that (ui-consistency §2a), just estimate the first frame.
        estimatedHeroHeight={hasSharedGroups ? 170 : 40}
        renderHero={() => (
          <>
            <Text style={styles.subheading}>Track shared and personal transactions</Text>
            {/* The overall summary now lives IN the header — it fades and slides
                away with the rest of the hero as the header collapses, exactly
                like Home's Income/Refunds card, rather than sitting as the
                first card in the scrollable body. */}
            {hasSharedGroups && (
              <View style={styles.heroSummaryCard}>
                <View style={styles.heroSummaryCell}>
                  <Text style={styles.heroSummaryValue} numberOfLines={1}>{formatCurrency(totals.owed)}</Text>
                  <Text style={styles.heroSummaryLabel}>YOU ARE OWED</Text>
                </View>
                <View style={styles.heroSummaryDivider} />
                <View style={styles.heroSummaryCell}>
                  <Text style={styles.heroSummaryValue} numberOfLines={1}>{formatCurrency(totals.owe)}</Text>
                  <Text style={styles.heroSummaryLabel}>YOU OWE</Text>
                </View>
                <View style={styles.heroSummaryDivider} />
                <View style={styles.heroSummaryCell}>
                  <Text style={styles.heroSummaryValue} numberOfLines={1}>{formatCurrency(Math.abs(totals.net))}</Text>
                  <Text style={styles.heroSummaryLabel}>{totals.net >= 0 ? 'NET TO RECEIVE' : 'NET TO PAY'}</Text>
                </View>
              </View>
            )}
          </>
        )}
        contentContainerStyle={isEmpty
          ? styles.emptyContainer
          : [styles.list, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 96 }]}
        onScroll={onScroll}
      >
        {isEmpty ? (
          <EmptyState
            icon="people-outline"
            title="No groups yet"
            subtitle="Create a personal group to track themed spending (house build, trip) or a shared group to split expenses with friends."
            actionLabel="Create first group"
            onAction={openCreate}
          />
        ) : (
          <>
            {hasSharedGroups && (
              <View style={styles.chipRow}>
                {CHIPS.map((c) => {
                  const active = filter === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.chip, active && { backgroundColor: theme.primary + '18', borderColor: theme.primary }]}
                      onPress={() => setFilter(c.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipTxt, active && { color: theme.primary, fontWeight: '700' }]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* <SectionHeader
              icon="people-outline"
              title={`Your Groups (${filteredGroups.length})`}
              accentColor={theme.primary}
              style={styles.sectionHeading}
            /> */}

            {filteredGroups.length === 0 ? (
              <EmptyState
                compact
                icon="funnel-outline"
                title="No groups match this filter"
                subtitle="Try a different filter, or create a new group."
              />
            ) : (
              filteredGroups.map((g) => (
                <GroupListCardRow
                  key={g.id}
                  group={g}
                  net={groupNetById[g.id] || 0}
                  personalMonth={personalMonthTotalById[g.id] || 0}
                  onPress={() => navigation.navigate('GroupDetail', { groupId: g.id })}
                />
              ))
            )}
          </>
        )}
      </CollapsingHeaderScreen>

      <FAB onPress={openCreate} icon="+" bottomInset={TAB_BAR_HEIGHT + insets.bottom} accessibilityLabel="Add group" />

      <InfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        icon={<Ionicons name="people" size={36} color="#6366F1" />}
        title="About Groups"
        body="Group shared and personal expenses together. Shared-group splits flow into your Lent/Borrowed balances, so a friend across several groups nets to one total you can settle in one place."
        bullets={[
          { label: 'Shared', value: 'Split expenses; balances appear in Lent/Borrowed and in the summary above.' },
          { label: 'Personal', value: 'Track a theme (house, trip); optionally exclude from totals. The total resets each month.' },
          { label: 'Auto-cleanup', value: 'Groups you haven’t touched in 6 months are removed once everyone is settled.' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  infoBtn: { marginLeft: spacing.xs, padding: 2 },
  subheading: { ...typography.small, color: '#FFFFFFCC', marginTop: 2 },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  // Root-screen bar row (no back chevron) — mirrors CollapsingHeaderScreen's
  // own StandardBar layout, since a custom renderBar/renderCollapsedBar pair
  // replaced it (needed so the info icon's ink can flip with `onLight`, which
  // a single static `headerRight` node can't do).
  barRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  barTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, flex: 1 },

  // The aggregate summary now lives IN THE HERO — translucent-white-on-gradient,
  // same treatment as Home's Income/Refunds card (no shadow: it's part of the
  // header's own surface, not a card floating on the page).
  heroSummaryCard: {
    flexDirection: 'row',
    marginTop: spacing.md,
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  heroSummaryCell: { flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.md, alignItems: 'center' },
  heroSummaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#FFFFFF3D', marginVertical: spacing.sm },
  // Plain white, no icon — direction reads from the label text alone
  // ("YOU ARE OWED"/"YOU OWE"); a coloured green/coral read too loud sitting
  // on the translucent card over the gradient, and an icon was tried too.
  // Same colour/weight-family as Home's Income/Refunds hero stat (DashboardScreen's
  // statValue), sized one step up (h3, not bodyBold) — this figure is the card's
  // own headline number, not a secondary stat beside a bigger one like Home's.
  heroSummaryValue: { ...typography.h3, fontWeight: '800', color: '#fff', textAlign: 'center' },
  heroSummaryLabel: { ...typography.tiny, color: '#FFFFFFCC', fontWeight: '800', letterSpacing: 0.9, textAlign: 'center', marginTop: spacing.xs },

  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.card,
  },
  chipTxt: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },

  sectionHeading: { marginBottom: spacing.sm },

  // Shadow lives on this OPAQUE outer shell; the inner `groupCard` carries the
  // (possibly translucent) state wash + border. Elevation under a see-through
  // fill renders as a muddy grey box on Android, so the two must not share a
  // view (same rule as the summary/stat card shells above).
  groupCardShadow: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  groupCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: 'transparent',
    padding: spacing.lg,
  },
  groupIconTile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  groupIconEmoji: { fontSize: 24 },
  groupCardName: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  groupCardMeta: { ...typography.small, color: colors.textSecondary, marginTop: 3 },
  groupCardBalance: { ...typography.h3, fontWeight: '800' },
  groupCardBalanceLabel: { ...typography.small, color: colors.textMuted, marginTop: 2 },

  // This is now the ScrollView's own `contentContainerStyle` (collapsing mode
  // owns the scroll view), so it needs `flexGrow`, not `flex`, to centre the
  // EmptyState within at least the visible height.
  emptyContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
});
