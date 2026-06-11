// =============================================================================
// GroupsScreen — "Groups" tab root.
// Lists all groups. FAB → create new group. Tap row → GroupDetailScreen.
// =============================================================================
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import { debitDisplayAmount } from '../utils/split';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import FAB from '../components/FAB';
import EmptyState from '../components/EmptyState';
import CreateGroupModal, { type CreateGroupData } from '../components/CreateGroupModal';
import CenterModal from '../components/CenterModal';
import InfoSheet from '../components/InfoSheet';
import type { Group } from '../types/group';

interface NavLike {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

interface ConfirmState {
  title?: string;
  message?: string;
  primaryText?: string;
  secondaryText?: string;
  destructive?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export default function GroupsScreen({ navigation }: { navigation: NavLike }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const createGroup = useEPurseStore((s: any) => s.createGroup) as (d: CreateGroupData) => string;
  const updateGroup = useEPurseStore((s: any) => s.updateGroup) as (id: string, patches: Partial<Group>) => void;
  const deleteGroup = useEPurseStore((s: any) => s.deleteGroup) as (id: string) => void;

  const transactions = useEPurseStore((s: any) => s.transactions) as any[];

  const [createVisible, setCreateVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Group | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const scrollProps = useTabBarScroll();

  // Your share per group, derived live from the raw-window transactions:
  // debitDisplayAmount returns your split share for shared expenses, full amount otherwise.
  // (group.totalSpend stays the FULL group figure shown below it.)
  const myShareByGroup = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of transactions) {
      if (!t.groupId || t.isIgnored) continue;
      m[t.groupId] = (m[t.groupId] || 0) + debitDisplayAmount(t);
    }
    return m;
  }, [transactions]);

  const handleSave = (data: CreateGroupData) => {
    if (editTarget) {
      updateGroup(editTarget.id, data);
      setEditTarget(null);
    } else {
      createGroup(data);
    }
    setCreateVisible(false);
  };

  const handleLongPress = (g: Group) => {
    setConfirm({
      title: g.name,
      message: 'What would you like to do with this group?',
      primaryText: 'Edit',
      secondaryText: 'Delete',
      destructive: false,
      onPrimary: () => {
        setConfirm(null);
        setEditTarget(g);
        setCreateVisible(true);
      },
      onSecondary: () => {
        setConfirm({
          title: 'Delete group?',
          message: `"${g.name}" will be removed. Transactions tagged to it won't be deleted — just untagged.`,
          primaryText: 'Delete',
          secondaryText: 'Cancel',
          destructive: true,
          onPrimary: () => { deleteGroup(g.id); setConfirm(null); },
          onSecondary: () => setConfirm(null),
        });
      },
    });
  };

  const renderItem = ({ item: g }: { item: Group }) => {
    const total = g.totalSpend || 0;
    const myShare = myShareByGroup[g.id] || 0;
    const isShared = g.type === 'shared';
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('GroupDetail', { groupId: g.id })}
        onLongPress={() => handleLongPress(g)}
      >
        <View style={[styles.iconBox, { backgroundColor: (g.color || '#6366F1') + '22' }]}>
          <Text style={styles.iconTxt}>{g.emoji || (isShared ? '👥' : '📁')}</Text>
        </View>

        <View style={styles.cardMid}>
          <Text style={styles.cardName}>{g.name}</Text>
          <Text style={styles.cardMeta}>
            {isShared ? `${g.members?.length ?? 0} members` : 'Personal'}
            {g.excludeFromTotals ? ' · excluded from totals' : ''}
          </Text>
        </View>

        <View style={styles.cardRight}>
          {isShared ? (
            <>
              <Text style={styles.cardSpend}>{formatCurrency(myShare)}</Text>
              <Text style={styles.cardSpendLabel} numberOfLines={1}>your share · of {formatCurrency(total)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.cardSpend}>{formatCurrency(total)}</Text>
              <Text style={styles.cardSpendLabel}>total</Text>
            </>
          )}
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Groups</Text>
          <TouchableOpacity onPress={() => setInfoVisible(true)} hitSlop={10} style={styles.infoBtn}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subheading}>Track shared and personal expenses</Text>
      </View>

      {groups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            emoji="🗂"
            title="No groups yet"
            subtitle="Create a personal group to track themed spending (house build, trip) or a shared group to split expenses with friends."
            actionLabel="Create first group"
            onAction={() => { setEditTarget(null); setCreateVisible(true); }}
          />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 72 }]}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}

      <FAB
        onPress={() => { setEditTarget(null); setCreateVisible(true); }}
        icon="+"
        bottomInset={TAB_BAR_HEIGHT + insets.bottom}
      />

      <CreateGroupModal
        visible={createVisible}
        group={editTarget}
        onClose={() => { setCreateVisible(false); setEditTarget(null); }}
        onSave={handleSave}
      />

      <InfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="🗂 About Groups"
        body="Group shared and personal expenses together. Shared-group splits flow into your Lent/Borrowed balances, so a friend across several groups nets to one total you can settle in one place."
        bullets={[
          { label: 'Shared', value: 'Split expenses; balances appear in Lent/Borrowed.' },
          { label: 'Personal', value: 'Track a theme (house, trip); optionally exclude from totals.' },
          { label: 'Auto-cleanup', value: 'Groups you haven’t touched in 6 months are removed once everyone is settled.' },
        ]}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onPrimary || (() => setConfirm(null))}
        onSecondary={confirm?.onSecondary || (() => setConfirm(null))}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  heading:    { ...typography.h1, color: colors.textPrimary },
  infoBtn:    { marginLeft: spacing.xs, padding: 2 },
  subheading: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  list:       { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadows.card,
  },
  iconBox: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconTxt: { fontSize: 22 },
  cardMid: { flex: 1 },
  cardName: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  cardMeta: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  cardRight:      { alignItems: 'flex-end', marginRight: spacing.sm, maxWidth: 150 },
  cardSpend:      { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  cardSpendLabel: { ...typography.tiny, color: colors.textMuted },
  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
});
