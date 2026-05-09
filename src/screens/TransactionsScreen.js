// =============================================================================
// TransactionsScreen
// -----------------------------------------------------------------------------
// Three filter layers stacked above the list:
//   1. Timeframe segmented control: Week / Month (default) / Year / All
//   2. Quick filter chips: All / Split / by-category
//   3. Advanced filter modal: amount range + merchant/person search
// Active advanced filters render as removable tag chips above the list.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import GradientButton from '../components/GradientButton';
import TransactionItem from '../components/TransactionItem';
import CategoryPickerModal from '../components/CategoryPickerModal';
import { formatCurrency } from '../utils/format';

// Timeframe options for the segmented control at the top of the screen.
// `month` is the default per the product spec.
const TIMEFRAMES = [
  { id: 'week',  label: 'Week'  },
  { id: 'month', label: 'Month' },
  { id: 'year',  label: 'Year'  },
  { id: 'all',   label: 'All'   },
];

const TransactionsScreen = ({ navigation }) => {
  const transactions = useEPurseStore((s) => s.transactions);
  const categories   = useEPurseStore((s) => s.categories);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);

  const [timeframe, setTimeframe] = useState('month'); // default per spec
  const [filter, setFilter] = useState('all');         // 'all' | 'split' | 'hidden' | category id
  const [advanced, setAdvanced] = useState({
    minAmount: '',
    maxAmount: '',
    query: '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);

  // Active filters list — used to render removable tag chips above the list.
  const activeAdvanced = useMemo(() => {
    const out = [];
    if (advanced.minAmount) out.push({ key: 'min', label: `> ${formatCurrency(advanced.minAmount)}` });
    if (advanced.maxAmount) out.push({ key: 'max', label: `< ${formatCurrency(advanced.maxAmount)}` });
    if (advanced.query)     out.push({ key: 'query', label: `“${advanced.query}”` });
    return out;
  }, [advanced]);

  /**
   * Returns the inclusive lower bound (epoch ms) for the selected timeframe.
   * `null` means "no lower bound" (the All segment).
   *
   * Uses calendar-relative bounds where appropriate so "Year" maps to
   * "this calendar year so far", not "last 365 days". Same idea for "Month".
   */
  const timeframeMinMs = useMemo(() => {
    const now = new Date();
    switch (timeframe) {
      case 'week':
        return now.getTime() - 7 * 24 * 60 * 60 * 1000;
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      case 'year':
        return new Date(now.getFullYear(), 0, 1).getTime();
      case 'all':
      default:
        return null;
    }
  }, [timeframe]);

  const data = useMemo(() => {
    const sorted = [...transactions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    let res = sorted;

    // Hidden behavior:
    // - default views show visible transactions only
    // - dedicated "Hidden" chip shows only hidden transactions
    if (filter === 'hidden') {
      res = res.filter((t) => t.isHidden);
    } else {
      res = res.filter((t) => !t.isHidden);
    }

    // 1. Timeframe filter (defaults to current calendar month)
    if (timeframeMinMs != null) {
      res = res.filter((t) => new Date(t.createdAt).getTime() >= timeframeMinMs);
    }

    // 2. Category / split chip
    if (filter === 'split') res = res.filter((t) => t.isSplit);
    else if (filter !== 'all' && filter !== 'hidden') res = res.filter((t) => t.categoryId === filter);

    // 3. Advanced filters
    const min = parseFloat(advanced.minAmount);
    const max = parseFloat(advanced.maxAmount);
    if (!Number.isNaN(min)) res = res.filter((t) => t.amount > min);
    if (!Number.isNaN(max)) res = res.filter((t) => t.amount < max);
    if (advanced.query.trim()) {
      const q = advanced.query.trim().toLowerCase();
      res = res.filter(
        (t) =>
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.note || '').toLowerCase().includes(q)
      );
    }
    return res;
  }, [transactions, timeframeMinMs, filter, advanced]);

  const removeAdvanced = (key) => {
    setAdvanced((p) => ({
      ...p,
      ...(key === 'min'   ? { minAmount: '' }
        : key === 'max'   ? { maxAmount: '' }
        : key === 'query' ? { query: '' }
        : {}),
    }));
  };

  const clearAllAdvanced = () =>
    setAdvanced({ minAmount: '', maxAmount: '', query: '' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ---------- Header ---------- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Transactions</Text>
        <TouchableOpacity onPress={() => setModalOpen(true)} style={styles.filterBtn}>
          <Text style={styles.filterBtnText}>+ Filter</Text>
        </TouchableOpacity>
      </View>

      {/* ---------- Timeframe segmented control ---------- */}
      <View style={styles.tfRow}>
        {TIMEFRAMES.map((tf) => {
          const active = timeframe === tf.id;
          return (
            <TouchableOpacity
              key={tf.id}
              activeOpacity={0.85}
              onPress={() => setTimeframe(tf.id)}
              style={styles.tfBtn}
            >
              {active ? (
                <LinearGradient
                  colors={[colors.gradientStart, colors.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tfBtnActiveBg}
                >
                  <Text style={styles.tfBtnTextActive}>{tf.label}</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.tfBtnText}>{tf.label}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ---------- Quick filter chips (single horizontal row) ---------- */}
      <View style={styles.filterScrollWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          <FilterPill label="All"       active={filter === 'all'}   onPress={() => setFilter('all')} />
          <FilterPill label="👥 Split"  active={filter === 'split'} onPress={() => setFilter('split')} />
          {categories.map((c) => (
            <FilterPill
              key={c.id}
              label={`${c.emoji} ${c.name}`}
              active={filter === c.id}
              onPress={() => setFilter(c.id)}
            />
          ))}
          <FilterPill
            label="🙈 Hidden"
            active={filter === 'hidden'}
            onPress={() => setFilter('hidden')}
          />
        </ScrollView>
      </View>

      {/* ---------- Active advanced filter chips ---------- */}
      {activeAdvanced.length > 0 && (
        <View style={styles.advRow}>
          {activeAdvanced.map((f) => (
            <TouchableOpacity key={f.key} style={styles.advChip} onPress={() => removeAdvanced(f.key)}>
              <Text style={styles.advChipText}>{f.label}</Text>
              <Text style={styles.advChipX}> × </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={clearAllAdvanced} style={styles.advClearBtn}>
            <Text style={styles.advClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---------- Transactions list ---------- */}
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TransactionItem
            txn={item}
            onPress={() => navigation.navigate('TransactionDetail', { id: item.id })}
            onPressCategory={() => setActiveTxn(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🗂️</Text>
            <Text style={styles.emptyTitle}>No transactions match</Text>
            <Text style={styles.emptyHelp}>
              Try changing the filter, clearing advanced filters, or adding a new entry.
            </Text>
          </View>
        }
      />

      <FilterModal
        visible={modalOpen}
        initial={advanced}
        onClose={() => setModalOpen(false)}
        onApply={(next) => {
          setAdvanced(next);
          setModalOpen(false);
        }}
      />

      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        selectedCategoryId={activeTxn?.categoryId}
        isHidden={!!activeTxn?.isHidden}
        onClose={() => setActiveTxn(null)}
        onSelectCategory={(categoryId) => {
          if (!activeTxn) return;
          updateTransactionCategory(activeTxn.id, categoryId);
          setActiveTxn(null);
        }}
        onToggleHidden={(hidden) => {
          if (!activeTxn) return;
          setTransactionHidden(activeTxn.id, hidden);
          setActiveTxn(null);
        }}
      />
    </SafeAreaView>
  );
};

// =============================================================================
// Subcomponents
// =============================================================================

const FilterPill = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.pill, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
  >
    <Text
      numberOfLines={1}
      style={[styles.pillText, active && { color: '#fff', fontWeight: '700' }]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

// ---- Filter modal (bottom sheet) -------------------------------------------
const FilterModal = ({ visible, initial, onClose, onApply }) => {
  const [minAmount, setMin] = useState(initial.minAmount);
  const [maxAmount, setMax] = useState(initial.maxAmount);
  const [query, setQuery]   = useState(initial.query);

  // Reset internal state when the modal re-opens with new initial values.
  React.useEffect(() => {
    if (visible) {
      setMin(initial.minAmount);
      setMax(initial.maxAmount);
      setQuery(initial.query);
    }
  }, [visible, initial.minAmount, initial.maxAmount, initial.query]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={mStyles.backdrop}
      >
        <TouchableOpacity style={mStyles.dismissArea} activeOpacity={1} onPress={onClose} />

        <View style={mStyles.sheet}>
          <View style={mStyles.handle} />
          <Text style={mStyles.sheetTitle}>Advanced filters</Text>

          <Text style={mStyles.label}>Amount greater than</Text>
          <TextInput
            value={minAmount}
            onChangeText={setMin}
            placeholder="e.g. 500"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={mStyles.input}
          />

          <Text style={mStyles.label}>Amount less than</Text>
          <TextInput
            value={maxAmount}
            onChangeText={setMax}
            placeholder="e.g. 5000"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={mStyles.input}
          />

          <Text style={mStyles.label}>Merchant or person name</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. Swiggy or Rohit"
            placeholderTextColor={colors.textMuted}
            style={mStyles.input}
          />

          <View style={mStyles.btnRow}>
            <TouchableOpacity
              style={mStyles.clearBtn}
              onPress={() => {
                setMin('');
                setMax('');
                setQuery('');
              }}
            >
              <Text style={mStyles.clearText}>Clear</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <GradientButton
                title="Apply"
                onPress={() => onApply({ minAmount, maxAmount, query })}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// =============================================================================
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  backText: { fontSize: 22, color: colors.textPrimary },
  title: { ...typography.h2, color: colors.textPrimary },

  filterBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  filterBtnText: { color: colors.primary, ...typography.small, fontWeight: '700' },

  // Timeframe segmented control — pill background, gradient on the active button.
  tfRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 4,
    ...shadows.card,
  },
  tfBtn: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  tfBtnActiveBg: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  tfBtnText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  tfBtnTextActive: {
    ...typography.small,
    color: '#fff',
    fontWeight: '800',
  },

  // Quick filter chips — single horizontal scrolling row, never wraps.
  filterScrollWrap: {
    height: 44,
    marginBottom: spacing.xs,
    overflow: 'hidden',   // clips any accidental vertical bleed
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,           // match wrapper so ScrollView measures correctly
  },
  pill: {
    height: 32,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,        // never shrink horizontally — keeps chip on one line
  },
  pillText: { ...typography.small, color: colors.textSecondary },

  // Active advanced-filter chips
  advRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  advChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  advChipText: { color: colors.primary, ...typography.tiny, fontWeight: '700' },
  advChipX:    { color: colors.primary, ...typography.bodyBold, marginLeft: 2 },
  advClearBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  advClearText: { color: colors.textSecondary, ...typography.tiny, textDecorationLine: 'underline' },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },

  empty: { alignItems: 'center', padding: spacing.xxl },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHelp:  { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
});

const mStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },

  label: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },

  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  clearBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  clearText: { color: colors.textSecondary, ...typography.bodyBold, fontWeight: '700' },
});

export default TransactionsScreen;
