import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDate } from '../utils/format';
import GradientButton from '../components/GradientButton';
import CenterModal from '../components/CenterModal';

const ENTRY_LABEL = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  lent_settled: 'Received back',
  borrow_repaid: 'Repaid',
};

// +/- direction for net contribution to "they owe me" balance
const isPositiveEntry = (kind) => kind === 'lent' || kind === 'borrow_repaid';

const LentBorrowedScreen = ({ route, navigation }) => {
  const initialKind = route?.params?.kind || 'lent';
  const [kind, setKind] = useState(initialKind);
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [expandedPerson, setExpandedPerson] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const all = useEPurseStore((s) => s.lentBorrowed);
  const addLentBorrowed = useEPurseStore((s) => s.addLentBorrowed);
  const settle = useEPurseStore((s) => s.settleLentBorrowed);
  const getPersonBalances = useEPurseStore((s) => s.getPersonBalances);

  const handleAdd = useCallback(() => {
    const n = parseFloat(amount);
    if (!person.trim()) {
      setConfirm({ title: 'Missing name', message: 'Enter a person name.', primaryText: 'OK' });
      return;
    }
    if (!n || n <= 0) {
      setConfirm({ title: 'Invalid amount', message: 'Enter a positive amount.', primaryText: 'OK' });
      return;
    }
    if (n > MAX_ALLOWED_AMOUNT) {
      setConfirm({ title: 'Amount too large', message: 'Maximum allowed is ₹10,00,00,000.', primaryText: 'OK' });
      return;
    }
    addLentBorrowed({
      kind,
      person: person.trim(),
      amount: n,
      note: note.trim(),
      contactId: null,
      phone: phone.trim() || null,
    });
    setPerson('');
    setPhone('');
    setAmount('');
    setNote('');
  }, [kind, person, phone, amount, note, addLentBorrowed]);

  // Per-person balances: lent tab shows net > 0, borrowed tab shows net < 0
  const personBalances = useMemo(() => {
    const all = getPersonBalances();
    return all.filter((p) => kind === 'lent' ? p.net > 0 : p.net < 0);
  }, [getPersonBalances, all, kind]);

  // Total for the header
  const total = useMemo(() => {
    const all = getPersonBalances();
    return kind === 'lent'
      ? all.filter((p) => p.net > 0).reduce((s, p) => s + p.net, 0)
      : all.filter((p) => p.net < 0).reduce((s, p) => s + Math.abs(p.net), 0);
  }, [getPersonBalances, all, kind]);

  const grad = useMemo(
    () =>
      kind === 'lent'
        ? [colors.gradientGreenStart, colors.gradientGreenEnd]
        : [colors.gradientPurpleStart, colors.gradientPurpleEnd],
    [kind]
  );

  const renderPersonCard = useCallback(
    ({ item: pb }) => {
      const netAbs = Math.abs(pb.net);
      const netLabel = pb.net > 0 ? 'owes you' : 'you owe';
      const netColor = pb.net > 0 ? colors.success : '#EF4444';
      const isExpanded = expandedPerson === pb.personKey;

      const sortedEntries = [...pb.entries].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );

      return (
        <TouchableOpacity
          style={styles.personCard}
          onPress={() => setExpandedPerson(isExpanded ? null : pb.personKey)}
          activeOpacity={0.85}
        >
          <View style={styles.personCardHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(pb.person || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{pb.person || 'Unknown'}</Text>
              {pb.phone ? (
                <Text style={styles.personPhone}>{pb.phone}</Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.netAmount, { color: netColor }]}>
                {formatCurrency(netAbs)}
              </Text>
              <Text style={[styles.netLabel, { color: netColor }]}>
                {netLabel}
              </Text>
            </View>
            <Text style={styles.expandArrow}>{isExpanded ? '▲' : '▼'}</Text>
          </View>

          {isExpanded && (
            <ScrollView
              style={styles.entriesScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {sortedEntries.map((entry) => {
                const positive = isPositiveEntry(entry.kind);
                const entryColor = positive ? colors.success : '#EF4444';
                const entrySign = positive ? '+' : '−';
                const canSettle =
                  !entry.settledAt &&
                  (entry.kind === 'lent' || entry.kind === 'borrowed');

                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.entryRow,
                      entry.settledAt && styles.entrySettled,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryNote}>
                        {entry.note && entry.note !== 'Manual settlement'
                          ? entry.note
                          : ENTRY_LABEL[entry.kind] || entry.kind}
                      </Text>
                      <Text style={styles.entryDate}>
                        {ENTRY_LABEL[entry.kind]} · {formatDate(entry.date)}
                        {entry.settledAt
                          ? ` · Settled ${formatDate(entry.settledAt)}`
                          : ''}
                      </Text>
                    </View>
                    <Text style={[styles.entryAmt, { color: entryColor }]}>
                      {entrySign} {formatCurrency(entry.amount)}
                    </Text>
                    {canSettle ? (
                      <TouchableOpacity
                        style={styles.settle}
                        onPress={() =>
                          setConfirm({
                            title:
                              entry.kind === 'lent'
                                ? 'Mark as settled?'
                                : 'Mark as repaid?',
                            message: `${entry.person} · ${formatCurrency(entry.amount)}\n\nThis creates a full settlement entry and cannot be undone.`,
                            primaryText:
                              entry.kind === 'lent' ? 'Settle' : 'Mark repaid',
                            destructive: true,
                            secondaryText: 'Cancel',
                            onSecondary: () => setConfirm(null),
                            onConfirm: () => {
                              settle(entry.id);
                              setConfirm(null);
                            },
                          })
                        }
                      >
                        <Text style={styles.settleText}>Settle</Text>
                      </TouchableOpacity>
                    ) : entry.settledAt ? (
                      <View style={styles.settledPill}>
                        <Text style={styles.settledPillText}>Settled</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </TouchableOpacity>
      );
    },
    [expandedPerson, settle]
  );

  const ListHeader = useMemo(
    () => (
      <View style={styles.formCard}>
        <Text style={styles.formTitle}>
          {kind === 'lent' ? 'Lend to someone' : 'Note a borrowed amount'}
        </Text>
        <TextInput
          value={person}
          onChangeText={setPerson}
          placeholder="Person name *"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number (optional)"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          style={styles.input}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="Amount *"
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
        <GradientButton
          title="Add"
          onPress={handleAdd}
          colors={grad}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    ),
    [kind, person, phone, amount, note, handleAdd, grad]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>
          {kind === 'lent'
            ? 'No outstanding amounts to receive.'
            : 'No outstanding amounts to repay.'}
        </Text>
      </View>
    ),
    [kind]
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <LinearGradient
          colors={grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']}>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backBtn}
              >
                <Text style={styles.backText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.title}>
                {kind === 'lent' ? 'You Lent' : 'You Borrowed'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <Text style={styles.subLabel}>
              {kind === 'lent' ? 'Money to receive' : 'Money to return'}
            </Text>
            <Text style={styles.bigAmount}>{formatCurrency(total)}</Text>

            <View style={styles.toggleRow}>
              <Toggle
                label="Lent"
                active={kind === 'lent'}
                onPress={() => setKind('lent')}
              />
              <Toggle
                label="Borrowed"
                active={kind === 'borrowed'}
                onPress={() => setKind('borrowed')}
              />
            </View>
          </SafeAreaView>
        </LinearGradient>

        <FlatList
          data={personBalances}
          keyExtractor={(item) => item.personKey}
          renderItem={renderPersonCard}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={7}
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
    <Text
      style={[
        styles.toggleText,
        active && { color: '#fff', fontWeight: '700' },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const ENTRY_ROW_HEIGHT = 58; // approximate height per entry row
const ENTRIES_MAX_VISIBLE = 3.5; // show 3 full + partial 4th

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

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
  subLabel: {
    color: '#FFFFFFCC',
    ...typography.small,
    marginTop: spacing.lg,
  },
  bigAmount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.lg,
  },
  toggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  toggleText: { color: '#FFFFFFCC', ...typography.bodyBold },

  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  formTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },

  // Per-person card
  personCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
    overflow: 'hidden',
  },
  personCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  personPhone: {
    ...typography.tiny,
    color: colors.textSecondary,
    marginTop: 1,
  },
  netAmount: { ...typography.bodyBold, fontWeight: '800' },
  netLabel: { ...typography.tiny, fontWeight: '600', marginTop: 1 },
  expandArrow: { color: colors.textSecondary, fontSize: 10, marginLeft: 4 },

  entriesScroll: {
    maxHeight: ENTRY_ROW_HEIGHT * ENTRIES_MAX_VISIBLE,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  entrySettled: { opacity: 0.55 },
  entryNote: { ...typography.small, color: colors.textPrimary },
  entryDate: { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },
  entryAmt: { ...typography.bodyBold, fontWeight: '700' },

  settle: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary + '15',
    borderRadius: radius.pill,
  },
  settleText: {
    color: colors.primary,
    ...typography.tiny,
    fontWeight: '700',
  },
  settledPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.textMuted + '22',
    borderRadius: radius.pill,
  },
  settledPillText: {
    color: colors.textSecondary,
    ...typography.tiny,
    fontWeight: '700',
  },

  emptyWrap: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default LentBorrowedScreen;
