import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import TransactionItem from '../components/TransactionItem';

const TransactionsScreen = ({ navigation }) => {
  const transactions = useEPurseStore((s) => s.transactions);
  const categories = useEPurseStore((s) => s.categories);
  const toggleSplit = useEPurseStore((s) => s.toggleSplit);
  const deleteTransaction = useEPurseStore((s) => s.deleteTransaction);

  const [filter, setFilter] = useState('all'); // 'all' | category id | 'split'

  const data = useMemo(() => {
    const sorted = [...transactions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    if (filter === 'all') return sorted;
    if (filter === 'split') return sorted.filter((t) => t.isSplit);
    return sorted.filter((t) => t.categoryId === filter);
  }, [transactions, filter]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Transactions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <FilterPill label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterPill label="👥 Split" active={filter === 'split'} onPress={() => setFilter('split')} />
        {categories.map((c) => (
          <FilterPill
            key={c.id}
            label={`${c.emoji} ${c.name}`}
            active={filter === c.id}
            onPress={() => setFilter(c.id)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TransactionItem
            txn={item}
            onPress={() => {
              navigation.navigate('TransactionDetail', { id: item.id });
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🗂️</Text>
            <Text style={styles.emptyTitle}>No transactions</Text>
            <Text style={styles.emptyHelp}>Try changing the filter or adding a new entry.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const FilterPill = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.pill, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
  >
    <Text style={[styles.pillText, active && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  backText: { fontSize: 22, color: colors.textPrimary },
  title: { ...typography.h2, color: colors.textPrimary },

  filterRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing.sm,
  },
  pillText: { ...typography.small, color: colors.textSecondary },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },

  empty: { alignItems: 'center', padding: spacing.xxl },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHelp: { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
});

export default TransactionsScreen;
