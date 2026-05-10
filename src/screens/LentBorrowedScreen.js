import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDate, formatDateTime } from '../utils/format';
import GradientButton from '../components/GradientButton';
import { TRANSACTION_TYPES } from '../constants/categories';
import CenterModal from '../components/CenterModal';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const TXN_CATEGORIES_BY_KIND = {
  lent: ['lent', 'lent_settled'],
  borrowed: ['borrowed', 'borrow_repaid'],
};

const EMPTY_TAGGED = { __empty: 'tagged' };
const EMPTY_MANUAL = { __empty: 'manual' };

const LentBorrowedScreen = ({ route, navigation }) => {
  const initialKind = route?.params?.kind || 'lent';
  const [kind, setKind] = useState(initialKind);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(null); // { title, message, primaryText, destructive, onConfirm }

  const all = useEPurseStore((s) => s.lentBorrowed);
  const transactions = useEPurseStore((s) => s.transactions);
  const categories = useEPurseStore((s) => s.categories);
  const addLentBorrowed = useEPurseStore((s) => s.addLentBorrowed);
  const settle = useEPurseStore((s) => s.settleLentBorrowed);

  const catLabel = useCallback(
    (id) => categories.find((c) => c.id === id)?.name || id,
    [categories]
  );

  const taggedTransactions = useMemo(() => {
    const ids = TXN_CATEGORIES_BY_KIND[kind];
    return [...transactions]
      .filter((t) => !t.isIgnored && ids.includes(t.categoryId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [transactions, kind]);

  const manualList = useMemo(() => {
    const cutoff = Date.now() - ONE_YEAR_MS;
    return [...all]
      .filter((l) => l.kind === kind)
      .filter((l) => !l.settledAt || new Date(l.settledAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [all, kind]);

  const total = useMemo(() => {
    const manualTotal = manualList.filter((l) => !l.settledAt).reduce((s, l) => s + l.amount, 0);
    const taggedBase = transactions
      .filter((t) => !t.isIgnored && t.categoryId === kind)
      .reduce((s, t) => s + (t.amount || 0), 0);
    const taggedSettled = transactions
      .filter(
        (t) =>
          !t.isIgnored &&
          t.categoryId === (kind === 'lent' ? 'lent_settled' : 'borrow_repaid')
      )
      .reduce((s, t) => s + (t.amount || 0), 0);
    return manualTotal + taggedBase - taggedSettled;
  }, [manualList, transactions, kind]);

  const sections = useMemo(
    () => [
      {
        key: 'tagged',
        title: 'From transactions',
        hint:
          'Bank/SMS or manual transactions tagged here stay in your history beyond the usual 3-month raw window: open loans until settled; settled/repaid rows up to 1 year.',
        data: taggedTransactions.length > 0 ? taggedTransactions : [EMPTY_TAGGED],
      },
      {
        key: 'manual',
        title: 'Manual notes',
        hint: 'Settled items are kept up to one year, then removed. Open ones stay until you settle.',
        data: manualList.length > 0 ? manualList : [EMPTY_MANUAL],
      },
    ],
    [taggedTransactions, manualList]
  );

  const grad = useMemo(
    () =>
      kind === 'lent'
        ? [colors.gradientGreenStart, colors.gradientGreenEnd]
        : [colors.gradientPurpleStart, colors.gradientPurpleEnd],
    [kind]
  );

  const handleAdd = useCallback(() => {
    const n = parseFloat(amount);
    if (!person.trim() || !n || n <= 0) {
      setConfirm({
        title: 'Missing fields',
        message: 'Add a person and a positive amount.',
        primaryText: 'OK',
        destructive: false,
        secondaryText: undefined,
        onSecondary: undefined,
        onConfirm: () => setConfirm(null),
      });
      return;
    }
    if (n > MAX_ALLOWED_AMOUNT) {
      setConfirm({
        title: 'Amount too large',
        message: 'Maximum allowed amount is ₹10,00,00,000 (10 crore).',
        primaryText: 'OK',
        destructive: false,
        secondaryText: undefined,
        onSecondary: undefined,
        onConfirm: () => setConfirm(null),
      });
      return;
    }
    addLentBorrowed({ kind, person: person.trim(), amount: n, note: note.trim() });
    setPerson('');
    setAmount('');
    setNote('');
  }, [kind, person, amount, note, addLentBorrowed]);

  const listHeaderEl = useMemo(
    () => (
      <View style={styles.formCard}>
        <Text style={styles.formTitle}>{kind === 'lent' ? 'Lend to someone' : 'Note a borrowed amount'}</Text>
        <TextInput
          value={person}
          onChangeText={setPerson}
          placeholder="Person name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="Amount"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional)"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <GradientButton title="Add" onPress={handleAdd} colors={grad} style={{ marginTop: spacing.sm }} />
      </View>
    ),
    [kind, person, amount, note, handleAdd, grad]
  );

  const renderSectionHeader = useCallback(
    ({ section }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionHint}>{section.hint}</Text>
      </View>
    ),
    []
  );

  const keyExtractor = useCallback((item, index) => {
    if (item.__empty) return `empty-${item.__empty}-${index}`;
    return item.id;
  }, []);

  const renderItem = useCallback(
    ({ item, section }) => {
      if (item.__empty === 'tagged') {
        return (
          <Text style={styles.emptyBlock}>
            Nothing tagged yet. Change a transaction’s category on the Transactions tab.
          </Text>
        );
      }
      if (item.__empty === 'manual') {
        return <Text style={styles.emptyBlock}>No manual entries. Add someone in the form above ↑</Text>;
      }
      if (section.key === 'tagged') {
        const t = item;
        const isCredit = t.type === TRANSACTION_TYPES.CREDIT;
        const sign = isCredit ? '+' : '−';
        return (
          <View style={styles.txnRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.txnMerchant} numberOfLines={1}>
                {t.merchant || '—'}
              </Text>
              <Text style={styles.txnMeta} numberOfLines={1}>
                {catLabel(t.categoryId)} · {formatDateTime(t.createdAt)}
              </Text>
            </View>
            <Text style={[styles.txnAmount, { color: isCredit ? colors.success : colors.textPrimary }]}>
              {sign} {formatCurrency(t.amount)}
            </Text>
          </View>
        );
      }
      const rowItem = item;
      return (
        <View style={[styles.row, rowItem.settledAt && styles.rowSettled]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{rowItem.person.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{rowItem.person}</Text>
            <Text style={styles.note}>
              {rowItem.note ? rowItem.note + ' · ' : ''}
              {formatDate(rowItem.date)}
              {rowItem.settledAt ? ` · Settled ${formatDate(rowItem.settledAt)}` : ''}
            </Text>
          </View>
          <Text style={styles.amt}>{formatCurrency(rowItem.amount)}</Text>
          {!rowItem.settledAt ? (
            <TouchableOpacity
              style={styles.settle}
              onPress={() => {
                setConfirm({
                  title: kind === 'lent' ? 'Mark as settled?' : 'Mark as repaid?',
                  message: `${rowItem.person} · ${formatCurrency(rowItem.amount)}\n\nThis will move it to the settled list.`,
                  primaryText: kind === 'lent' ? 'Settle' : 'Mark repaid',
                  destructive: true,
                  secondaryText: 'Cancel',
                  onSecondary: () => setConfirm(null),
                  onConfirm: () => {
                    settle(rowItem.id);
                    setConfirm(null);
                  },
                });
              }}
            >
              <Text style={styles.settleText}>Settle</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.settledPill}>
              <Text style={styles.settledPillText}>Settled</Text>
            </View>
          )}
        </View>
      );
    },
    [catLabel, settle, kind]
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
          <SafeAreaView edges={['top']}>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                <Text style={styles.backText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.title}>{kind === 'lent' ? 'You Lent' : 'You Borrowed'}</Text>
              <View style={{ width: 40 }} />
            </View>

            <Text style={styles.subLabel}>{kind === 'lent' ? 'Money to receive' : 'Money to return'}</Text>
            <Text style={styles.bigAmount}>{formatCurrency(total)}</Text>

            <View style={styles.toggleRow}>
              <Toggle label="Lent" active={kind === 'lent'} onPress={() => setKind('lent')} />
              <Toggle label="Borrowed" active={kind === 'borrowed'} onPress={() => setKind('borrowed')} />
            </View>
          </SafeAreaView>
        </LinearGradient>

        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={listHeaderEl}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
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
      </View>
    </KeyboardAvoidingView>
  );
};

const Toggle = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.toggle, active && { backgroundColor: '#FFFFFF22' }]}
  >
    <Text style={[styles.toggleText, active && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: spacing.xxl * 2 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: 22, color: '#fff' },
  title: { color: '#fff', ...typography.h2 },
  subLabel: { color: '#FFFFFFCC', ...typography.small, marginTop: spacing.lg },
  bigAmount: { color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 4 },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.lg,
  },
  toggle: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill },
  toggleText: { color: '#FFFFFFCC', ...typography.bodyBold },

  formCard: {
    backgroundColor: colors.card,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  formTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },

  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    ...typography.tiny,
    color: colors.textSecondary,
  },
  emptyBlock: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  txnMerchant: { ...typography.bodyBold, color: colors.textPrimary },
  txnMeta: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  txnAmount: { ...typography.bodyBold, fontWeight: '700', marginLeft: spacing.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  rowSettled: { opacity: 0.88 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  note: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  amt: { ...typography.bodyBold, color: colors.textPrimary, marginRight: spacing.sm },
  settle: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary + '15',
    borderRadius: radius.pill,
  },
  settleText: { color: colors.primary, ...typography.tiny, fontWeight: '700' },
  settledPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.textMuted + '22',
    borderRadius: radius.pill,
  },
  settledPillText: { color: colors.textSecondary, ...typography.tiny, fontWeight: '700' },
});

export default LentBorrowedScreen;
