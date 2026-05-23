// =============================================================================
// TransactionsScreen
// -----------------------------------------------------------------------------
// Three filter layers stacked above the list:
//   1. Timeframe segmented control: Week / Month (default) / Year / All
//   2. Quick filter chips: All / Split / by-category / Hidden / Ignored
//   3. Advanced filter modal: amount range + merchant/person search
// Active advanced filters render as removable tag chips above the list.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButton from '../components/GradientButton';
import TransactionItem from '../components/TransactionItem';
import CategoryPickerModal from '../components/CategoryPickerModal';
import LinkContactModal from '../components/LinkContactModal';
import SplitConfigModal from '../components/SplitConfigModal';
import SplitDetailsModal from '../components/SplitDetailsModal';
import CenterModal from '../components/CenterModal';
import { formatCurrency } from '../utils/format';
import { canSplitTransaction, debitDisplayAmount } from '../utils/split';

// Timeframe options for the segmented control at the top of the screen.
// `month` is the default per the product spec.
const TIMEFRAMES = [
  { id: 'week',  label: 'Week'  },
  { id: 'month', label: 'Month' },
  { id: 'year',  label: 'Year'  },
  { id: 'all',   label: 'All'   },
];

// Map Dashboard D/W/M/Y keys to Transactions timeframe ids
const PERIOD_TO_TIMEFRAME = { D: 'week', W: 'week', M: 'month', Y: 'year' };

const TransactionsScreen = ({ navigation, route }) => {
  const theme = useTheme();
  const transactions = useEPurseStore((s) => s.transactions);
  const accounts     = useEPurseStore((s) => s.accounts);
  const categories   = useEPurseStore((s) => s.categories);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const updateTwoTierCategory = useEPurseStore((s) => s.updateTwoTierCategory);
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);
  const deleteTransaction = useEPurseStore((s) => s.deleteTransaction);
  const ignoreTransaction = useEPurseStore((s) => s.ignoreTransaction);
  const unignoreTransaction = useEPurseStore((s) => s.unignoreTransaction);
  const setTransactionSplit = useEPurseStore((s) => s.setTransactionSplit);
  const userName = useEPurseStore((s) => s.userName);

  // Accept initial period from Dashboard D/W/M/Y toggle or account filter
  const routePeriod    = route?.params?.initialPeriod;
  const routeAccountId = route?.params?.accountId || null;

  const initialTimeframe = routePeriod ? (PERIOD_TO_TIMEFRAME[routePeriod] || 'month') : 'month';

  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [searchQuery, setSearchQuery] = useState('');

  // Re-apply account filter each time the tab is navigated with a new accountId param
  useEffect(() => {
    const accountId = route?.params?.accountId;
    if (accountId) {
      setActiveFilters(new Set([`acct:${accountId}`]));
      setTimeframe('all');
    }
  }, [route?.params?.accountId]);

  // Multi-select filters: a Set of active filter keys.
  // Special values: 'split' | 'hidden' | 'ignored' | category ids | 'acct:<accountId>'
  // Empty set = show all (non-hidden, non-ignored) transactions.
  const [activeFilters, setActiveFilters] = useState(() =>
    routeAccountId ? new Set([`acct:${routeAccountId}`]) : new Set()
  );

  const [advanced, setAdvanced] = useState({
    minAmount: '',
    maxAmount: '',
    query: '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [lbLinkTxn, setLbLinkTxn] = useState(null);  // { txn, categoryId }
  const [splitTxn, setSplitTxn] = useState(null);
  const [splitDetailsTxn, setSplitDetailsTxn] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, primaryText, destructive, onConfirm }

  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('dark-content');
      StatusBar.setBackgroundColor('#FFFFFF');
      return () => {
        StatusBar.setBarStyle('light-content');
        StatusBar.setBackgroundColor('transparent');
        // Reset search and filters when leaving the screen so the next visit starts clean.
        setSearchQuery('');
        setActiveFilters(new Set());
        setAdvanced({ minAmount: '', maxAmount: '', query: '' });
      };
    }, []),
  );

  const toggleFilter = (key) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Active filters list — used to render removable tag chips above the list.
  const activeAdvanced = useMemo(() => {
    const out = [];
    if (advanced.minAmount) out.push({ key: 'min', label: `> ${formatCurrency(advanced.minAmount)}` });
    if (advanced.maxAmount) out.push({ key: 'max', label: `< ${formatCurrency(advanced.maxAmount)}` });
    if (advanced.query)     out.push({ key: 'query', label: `”${advanced.query}”` });
    return out;
  }, [advanced]);

  /**
   * Returns the inclusive lower bound (epoch ms) for the selected timeframe.
   * `null` means “no lower bound” (the All segment).
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

  // Derive filter buckets from the active filters Set
  const filterMeta = useMemo(() => {
    const showIgnored  = activeFilters.has('ignored');
    const showHidden   = activeFilters.has('hidden');
    const showSplit    = activeFilters.has('split');
    const catIds       = [...activeFilters].filter((f) => !f.startsWith('acct:') && f !== 'ignored' && f !== 'hidden' && f !== 'split');
    const acctIds      = [...activeFilters].filter((f) => f.startsWith('acct:')).map((f) => f.slice(5));
    return { showIgnored, showHidden, showSplit, catIds, acctIds };
  }, [activeFilters]);

  const data = useMemo(() => {
    const { showIgnored, showHidden, showSplit, catIds, acctIds } = filterMeta;

    let res = [...transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Ignored / visible base
    if (showIgnored) {
      res = res.filter((t) => t.isIgnored);
    } else {
      res = res.filter((t) => !t.isIgnored);
      if (showHidden) {
        res = res.filter((t) => t.isHidden);
      } else {
        res = res.filter((t) => !t.isHidden);
      }
    }

    // 1. Timeframe filter
    if (timeframeMinMs != null) {
      res = res.filter((t) => new Date(t.createdAt).getTime() >= timeframeMinMs);
    }

    // 2. Multi-select: split / category / account (AND logic across filter types, OR within same type)
    if (showSplit) res = res.filter((t) => t.isSplit);
    if (catIds.length > 0) res = res.filter((t) => catIds.includes(t.categoryId));
    if (acctIds.length > 0) res = res.filter((t) => acctIds.includes(t.accountId));

    // 3. Advanced filters
    const min = parseFloat(advanced.minAmount);
    const max = parseFloat(advanced.maxAmount);
    if (!Number.isNaN(min))
      res = res.filter((t) => debitDisplayAmount(t) > min);
    if (!Number.isNaN(max))
      res = res.filter((t) => debitDisplayAmount(t) < max);
    if (advanced.query.trim()) {
      const q = advanced.query.trim().toLowerCase();
      res = res.filter(
        (t) =>
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.note || '').toLowerCase().includes(q)
      );
    }

    // Inline search bar — matches merchant, note, or amount
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const numericQ = q.replace(/[₹,\s]/g, '');
      res = res.filter((t) => {
        if ((t.merchant || '').toLowerCase().includes(q)) return true;
        if ((t.note || '').toLowerCase().includes(q)) return true;
        if (numericQ && String(debitDisplayAmount(t)).startsWith(numericQ)) return true;
        return false;
      });
    }

    return res;
  }, [transactions, timeframeMinMs, filterMeta, advanced, searchQuery]);

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

  // Label for an account filter chip
  const acctLabel = (acctId) => {
    const a = accounts.find((x) => x.id === acctId);
    return a ? a.name : 'Account';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── White top section ── */}
      <View style={styles.topSection}>
        {/* Title row */}
        <Text style={styles.title}>Activity</Text>

        {/* Search bar — icon on the right, Swiggy-style */}
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by merchant or amount"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && Platform.OS === 'android' ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="search" size={18} color={colors.textSecondary} />
          )}
        </View>

        {/* Timeframe + filter button row */}
        <View style={styles.tfFilterRow}>
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
                      colors={[theme.gradientStart, theme.gradientEnd]}
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
          <TouchableOpacity
            onPress={() => setModalOpen(true)}
            style={[styles.filterBtn, { backgroundColor: theme.primary + '15', borderColor: theme.primary + '55' }]}
          >
            <Ionicons name="options-outline" size={14} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>{/* end topSection */}

      {/* ── Gray area: filter chips ── */}
      <View style={styles.filterScrollWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          <FilterPill
            label="All"
            active={activeFilters.size === 0}
            onPress={() => setActiveFilters(new Set())}
          />
          <FilterPill
            label="👥 Split"
            active={activeFilters.has('split')}
            onPress={() => toggleFilter('split')}
          />
          {categories.map((c) => (
            <FilterPill
              key={c.id}
              label={`${c.emoji} ${c.name}`}
              active={activeFilters.has(c.id)}
              onPress={() => toggleFilter(c.id)}
            />
          ))}
          {accounts.map((a) => (
            <FilterPill
              key={`acct:${a.id}`}
              label={`🏦 ${a.name}`}
              active={activeFilters.has(`acct:${a.id}`)}
              onPress={() => toggleFilter(`acct:${a.id}`)}
            />
          ))}
          <FilterPill
            label="🙈 Hidden"
            active={activeFilters.has('hidden')}
            onPress={() => toggleFilter('hidden')}
          />
          <FilterPill
            label="🚫 Ignored"
            active={activeFilters.has('ignored')}
            onPress={() => toggleFilter('ignored')}
          />
        </ScrollView>
      </View>

      {/* Active advanced filter chips */}
      {activeAdvanced.length > 0 && (
        <View style={styles.advRow}>
          {activeAdvanced.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.advChip, { backgroundColor: theme.primary + '15', borderColor: theme.primary + '55' }]}
              onPress={() => removeAdvanced(f.key)}
            >
              <Text style={[styles.advChipText, { color: theme.primary }]}>{f.label}</Text>
              <Text style={[styles.advChipX, { color: theme.primary }]}> × </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={clearAllAdvanced} style={styles.advClearBtn}>
            <Text style={styles.advClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}
      {activeFilters.size > 1 && (
        <View style={styles.advRow}>
          <Text style={styles.advClearText}>{activeFilters.size} filters active · </Text>
          <TouchableOpacity onPress={() => setActiveFilters(new Set())} style={styles.advClearBtn}>
            <Text style={styles.advClearText}>Clear all</Text>
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
            onPressCategory={() => setActiveTxn(item)}
            onPressSplitChip={() => setSplitDetailsTxn(item)}
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
        selectedParent={activeTxn?.parentCategory}
        selectedChild={activeTxn?.childCategory}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        canSplit={!!activeTxn && canSplitTransaction(activeTxn)}
        isSplitTxn={!!activeTxn?.isSplit}
        categoryLocked={!!activeTxn?.lbLocked}
        onPressSplit={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setSplitTxn(t);
        }}
        onClose={() => setActiveTxn(null)}
        onSelectTwoTier={(parentCategory, childCategory) => {
          if (!activeTxn) return;
          updateTwoTierCategory(activeTxn.id, parentCategory, childCategory);
          setActiveTxn(null);
        }}
        onSelectCategory={(categoryId) => {
          if (!activeTxn) return;
          updateTransactionCategory(activeTxn.id, categoryId);
          setActiveTxn(null);
        }}
        onSelectLentBorrow={(categoryId) => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setLbLinkTxn({ txn: t, categoryId });
        }}
        onToggleHidden={(hidden) => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: hidden ? 'Hide transaction?' : 'Show transaction?',
            message: hidden
              ? 'This transaction will be hidden from default views but still counted in totals.'
              : 'This transaction will be visible again in default views.',
            primaryText: hidden ? 'Hide' : 'Show',
            destructive: hidden,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              setTransactionHidden(t.id, hidden);
              setConfirm(null);
            },
          });
        }}
        onDelete={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Delete transaction?',
            message: 'This action cannot be undone.',
            primaryText: 'Delete',
            destructive: true,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              deleteTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
        onIgnore={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Ignore transaction?',
            message:
              'This removes it from your balances and every total and chart. It will be treated as if it never happened.',
            primaryText: 'Ignore',
            destructive: true,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              ignoreTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
        onRestore={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Restore transaction?',
            message: 'This adds it back to balances, totals, and charts.',
            primaryText: 'Restore',
            destructive: false,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              unignoreTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
      />

      <LinkContactModal
        visible={!!lbLinkTxn}
        categoryId={lbLinkTxn?.categoryId}
        onConfirm={(contactInfo) => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, contactInfo);
          setLbLinkTxn(null);
        }}
        onSkip={() => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, { person: 'Unlinked', phone: null, contactId: null });
          setLbLinkTxn(null);
        }}
        onClose={() => setLbLinkTxn(null)}
      />

      <SplitConfigModal
        visible={!!splitTxn}
        transaction={splitTxn}
        onClose={() => setSplitTxn(null)}
        onApply={(others, meta) => {
          if (splitTxn) setTransactionSplit(splitTxn.id, others, meta);
          setSplitTxn(null);
        }}
      />

      <SplitDetailsModal
        visible={!!splitDetailsTxn}
        txn={splitDetailsTxn}
        myName={userName ? `You (${userName})` : 'You'}
        onClose={() => setSplitDetailsTxn(null)}
        onEdit={() => {
          const t = splitDetailsTxn;
          setSplitDetailsTxn(null);
          setSplitTxn(t);
        }}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />
    </SafeAreaView>
  );
};

// =============================================================================
// Subcomponents
// =============================================================================

const FilterPill = ({ label, active, onPress }) => {
  const theme = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.pill, active && { backgroundColor: theme.primary + '15', borderColor: theme.primary + '88' }]}
    >
      <Text
        numberOfLines={1}
        style={[styles.pillText, active && { color: theme.primary, fontWeight: '700' }]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

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

  // White top section
  topSection: {
    backgroundColor: '#FFFFFF',
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },

  title: {
    ...typography.h2,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  // Search bar — icon on right
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  // Timeframe row + filter icon
  tfFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnText: { ...typography.small, fontWeight: '700' },

  // Timeframe segmented control
  tfRow: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.divider,
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

  // Quick filter chips — sits on gray background below the white top section
  filterScrollWrap: {
    height: 52,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
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
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  advChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  advChipText: { ...typography.tiny, fontWeight: '700' },
  advChipX:    { ...typography.bodyBold, marginLeft: 2 },
  advClearBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
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
