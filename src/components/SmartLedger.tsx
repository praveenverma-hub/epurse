// =============================================================================
// SmartLedger.tsx — Interactive "what-if" ledger card for the Analytics screen.
// -----------------------------------------------------------------------------
// A COMBINED CATEGORY-WISE view: each row is a category with its pooled spend.
// Toggle a category in/out to run instant what-if analysis. The adjusted total
// counts up/down smoothly (Reanimated) and the impact metrics update live.
//
// Group expenses contribute only the user's PERSONAL SHARE (debitDisplayAmount)
// to a category's pool — never the full bill — and any category that pools group
// spend is flagged "incl. Group Share" so a fractional total is self-explanatory.
//
// Renders as CARD CONTENT (no outer card / no FlatList) so it drops inside the
// Analytics ScrollView. Theme-aware via useTheme(). Pass `transactions`, or let
// it derive the current month's spend from the store.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore, selectVisibleTransactions } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing } from '../constants/theme';
import { NON_SPEND_CATEGORY_IDS } from '../constants/categories';
import { debitDisplayAmount, spendContribution } from '../utils/split';
import { formatCurrency } from '../utils/format';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface LedgerTxn {
  id: string;
  amount: number;                 // full bill amount
  type?: string;                  // 'debit' | 'credit'
  merchant?: string;
  categoryId?: string;
  createdAt?: number;
  groupId?: string | null;
  groupSplit?: any;
  isSplit?: boolean;
  myShareAmount?: number;
}

interface CategoryRowData {
  categoryId: string;
  name: string;
  emoji: string;
  color: string;
  total: number;     // pooled personal-share spend
  count: number;     // transactions in the category
  hasGroup: boolean; // pool includes group-share spend
}

type Styles = ReturnType<typeof makeStyles>;

export interface SmartLedgerProps {
  /** Rows to analyse. If omitted, the current month's visible debit spends are used. */
  transactions?: LedgerTxn[];
}

// ─── Worklet number formatter (₹ + Indian grouping) — runs on the UI thread ───
function formatINRWorklet(n: number): string {
  'worklet';
  const v = n < 0 ? 0 : Math.round(n);
  const s = String(v);
  if (s.length <= 3) return '₹' + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  let grouped = '';
  while (rest.length > 2) {
    grouped = ',' + rest.slice(-2) + grouped;
    rest = rest.slice(0, -2);
  }
  return '₹' + rest + grouped + ',' + last3;
}

// ─── Animated count-up/down number ────────────────────────────────────────────
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const AnimatedAmount: React.FC<{ value: number; style?: StyleProp<TextStyle> }> = ({ value, style }) => {
  const sv = useSharedValue(value);

  useEffect(() => {
    sv.value = withTiming(value, { duration: 550, easing: Easing.out(Easing.cubic) });
  }, [value, sv]);

  const animatedProps = useAnimatedProps(() => ({ text: formatINRWorklet(sv.value) } as any));

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      pointerEvents="none"
      defaultValue={formatINRWorklet(value)}
      animatedProps={animatedProps}
      style={style}
    />
  );
};

// ─── Impact metric chip ───────────────────────────────────────────────────────
const Metric: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
  styles: Styles;
}> = ({ label, value, valueColor, styles }) => (
  <View style={styles.metric}>
    <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
  </View>
);

// ─── Category row ─────────────────────────────────────────────────────────────
const CategoryLedgerRow: React.FC<{
  row: CategoryRowData;
  active: boolean;
  onToggle: (categoryId: string) => void;
  styles: Styles;
  accent: string;
  checkColor: string;
}> = React.memo(({ row, active, onToggle, styles, accent, checkColor }) => (
  <Pressable
    onPress={() => onToggle(row.categoryId)}
    style={({ pressed }) => [styles.row, !active && styles.rowInactive, pressed && styles.rowPressed]}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: active }}
  >
    {/* Toggle */}
    <View
      style={[
        styles.checkbox,
        active ? { backgroundColor: accent, borderColor: accent } : styles.checkboxInactive,
      ]}
    >
      {active ? <Ionicons name="checkmark" size={15} color={checkColor} /> : null}
    </View>

    {/* Emoji tile — tinted with the category's own colour */}
    <View style={[styles.emojiTile, { backgroundColor: row.color + '22', borderColor: row.color + '55' }]}>
      <Text style={styles.emoji}>{row.emoji}</Text>
    </View>

    {/* Body */}
    <View style={styles.rowBody}>
      <Text style={[styles.catName, !active && styles.textInactive]} numberOfLines={1}>
        {row.name}
      </Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>
          {row.count} {row.count === 1 ? 'txn' : 'txns'}
        </Text>
        {row.hasGroup ? (
          <View style={[styles.groupTag, { backgroundColor: accent + '1A' }]}>
            <Ionicons name="people" size={9} color={accent} style={{ marginRight: 3 }} />
            <Text style={[styles.groupTagText, { color: accent }]}>incl. Group Share</Text>
          </View>
        ) : null}
      </View>
    </View>

    {/* Amount */}
    <Text
      style={[styles.amount, active ? styles.amountActive : styles.amountInactive]}
      numberOfLines={1}
    >
      {formatCurrency(row.total)}
    </Text>
  </Pressable>
));

// ─── Main component (card content) ────────────────────────────────────────────
const SmartLedger: React.FC<SmartLedgerProps> = ({ transactions }) => {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const categories = useEPurseStore((s: any) => s.categories ?? []);
  const storeTxns = useEPurseStore(selectVisibleTransactions);

  // Source rows — the passed list, or the current month's visible debit spends.
  const txns: LedgerTxn[] = useMemo(() => {
    if (transactions) return transactions;
    const now = new Date();
    return (storeTxns as LedgerTxn[]).filter((t) => {
      if (t.type !== 'debit') return false;
      if (t.categoryId && NON_SPEND_CATEGORY_IDS.has(t.categoryId)) return false;
      const d = new Date(t.createdAt ?? 0);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }, [transactions, storeTxns]);

  // Flat category lookup (id → name/emoji/colour), for combined rows.
  const catById = useMemo(() => {
    const m = new Map<string, { name: string; emoji: string; color: string }>();
    categories.forEach((c: any) => m.set(c.id, { name: c.name, emoji: c.emoji, color: c.color }));
    return m;
  }, [categories]);

  // ── Aggregate transactions into category rows (personal share pooled) ───────
  const catRows: CategoryRowData[] = useMemo(() => {
    const map = new Map<string, CategoryRowData>();
    for (const t of txns) {
      const cid = t.categoryId || 'other';
      const meta = catById.get(cid) || { name: 'Uncategorized', emoji: '📌', color: '#6B7280' };
      const personal = spendContribution(t); // +expense share, −refund (nets category)
      const cur = map.get(cid);
      if (cur) {
        cur.total += personal;
        cur.count += 1;
        cur.hasGroup = cur.hasGroup || !!t.groupId;
      } else {
        map.set(cid, {
          categoryId: cid,
          name: meta.name,
          emoji: meta.emoji,
          color: meta.color,
          total: personal,
          count: 1,
          hasGroup: !!t.groupId,
        });
      }
    }
    // A category fully offset by refunds drops out; never show a negative row.
    return Array.from(map.values())
      .map((r) => ({ ...r, total: Math.max(0, r.total) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [txns, catById]);

  // ── State: category ids currently INCLUDED in the total (all on by default) ─
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>(() =>
    catRows.map((r) => r.categoryId),
  );

  // Re-seed to "all active" whenever the underlying category set changes.
  const catSignature = useMemo(() => catRows.map((r) => r.categoryId).join('|'), [catRows]);
  useEffect(() => {
    setActiveCategoryIds(catRows.map((r) => r.categoryId));
  }, [catSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = useCallback((categoryId: string) => {
    setActiveCategoryIds((prev) =>
      prev.includes(categoryId) ? prev.filter((x) => x !== categoryId) : [...prev, categoryId],
    );
  }, []);

  // ── Derived (memoized) ──────────────────────────────────────────────────────
  const activeSet = useMemo(() => new Set(activeCategoryIds), [activeCategoryIds]);

  const baselineTotal = useMemo(() => catRows.reduce((sum, r) => sum + r.total, 0), [catRows]);

  const dynamicTotalSpend = useMemo(
    () => catRows.reduce((sum, r) => (activeSet.has(r.categoryId) ? sum + r.total : sum), 0),
    [catRows, activeSet],
  );

  // Excluded = transactions in toggled-off categories (honours the "txns off" metric).
  const excludedTxnCount = useMemo(
    () => catRows.reduce((n, r) => (activeSet.has(r.categoryId) ? n : n + r.count), 0),
    [catRows, activeSet],
  );
  const excludedCatCount = useMemo(
    () => catRows.reduce((n, r) => (activeSet.has(r.categoryId) ? n : n + 1), 0),
    [catRows, activeSet],
  );

  const savingsDelta = Math.max(0, baselineTotal - dynamicTotalSpend);
  const allActive = excludedCatCount === 0;
  const checkColor = theme.textOnGradient || '#FFFFFF';

  if (catRows.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="pie-chart-outline" size={26} color={theme.textMuted} />
        <Text style={styles.emptyText}>No spends to analyse this month.</Text>
      </View>
    );
  }

  return (
    <View>
      {/* ── Adjusted total ───────────────────────────────────────────────── */}
      <Text style={styles.eyebrow}>ADJUSTED MONTHLY SPEND</Text>
      <AnimatedAmount value={dynamicTotalSpend} style={styles.heroAmount} />

      {/* ── Impact metrics ───────────────────────────────────────────────── */}
      <View style={styles.metricRow}>
        <Metric label="Adjusted" value={formatCurrency(dynamicTotalSpend)} valueColor={theme.primary} styles={styles} />
        <View style={styles.metricDivider} />
        <Metric
          label="Txns excluded"
          value={String(excludedTxnCount)}
          valueColor={excludedTxnCount === 0 ? theme.textMuted : undefined}
          styles={styles}
        />
        <View style={styles.metricDivider} />
        <Metric
          label={savingsDelta > 0 ? 'Saved' : 'No change'}
          value={savingsDelta > 0 ? `+${formatCurrency(savingsDelta)}` : '₹0'}
          valueColor={savingsDelta > 0 ? theme.success : theme.textMuted}
          styles={styles}
        />
      </View>

      <Text style={allActive ? styles.hintDim : styles.hint}>
        {allActive
          ? 'Tap a category to see your month without it'
          : `Excluding ${excludedCatCount} ${excludedCatCount === 1 ? 'category' : 'categories'} · what-if only`}
      </Text>

      {/* ── Category rows ────────────────────────────────────────────────── */}
      <View style={styles.list}>
        {catRows.map((row) => (
          <CategoryLedgerRow
            key={row.categoryId}
            row={row}
            active={activeSet.has(row.categoryId)}
            onToggle={toggleCategory}
            styles={styles}
            accent={theme.primary}
            checkColor={checkColor}
          />
        ))}
      </View>
    </View>
  );
};

export default SmartLedger;

// ─── Theme-aware styles ─────────────────────────────────────────────────────────
const makeStyles = (t: any) =>
  StyleSheet.create({
    eyebrow: { color: t.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2 },
    heroAmount: {
      color: t.textPrimary,
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: -0.8,
      marginTop: 2,
      padding: 0,
      height: 42,
    },

    // Metrics
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: 6,
    },
    metric: { flex: 1, alignItems: 'center', paddingHorizontal: 3 },
    metricValue: { color: t.textPrimary, fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
    metricLabel: { color: t.textMuted, fontSize: 9.5, fontWeight: '600', marginTop: 3, letterSpacing: 0.2 },
    metricDivider: { width: 1, height: 26, backgroundColor: t.divider },

    hint: { color: t.primary, fontSize: 11.5, fontWeight: '600', marginTop: spacing.md, letterSpacing: 0.2 },
    hintDim: { color: t.textMuted, fontSize: 11.5, fontWeight: '600', marginTop: spacing.md, letterSpacing: 0.2 },

    // Rows
    list: { marginTop: spacing.md, gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 12,
    },
    rowInactive: { opacity: 0.55 },
    rowPressed: { opacity: 0.8 },

    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
    },
    checkboxInactive: { backgroundColor: 'transparent', borderColor: t.textMuted },

    emojiTile: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    emoji: { fontSize: 17 },

    rowBody: { flex: 1, minWidth: 0 },
    catName: { color: t.textPrimary, fontSize: 14.5, fontWeight: '700' },
    textInactive: { color: t.textMuted },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
    meta: { color: t.textMuted, fontSize: 11.5, fontWeight: '500' },

    groupTag: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    groupTagText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.2 },

    amount: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
    amountActive: { color: t.textPrimary },
    amountInactive: { color: t.textMuted, textDecorationLine: 'line-through' },

    // Empty
    empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
    emptyText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  });
