import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDate } from '../utils/format';
import GradientButton from '../components/GradientButton';

const LentBorrowedScreen = ({ route, navigation }) => {
  const initialKind = route?.params?.kind || 'lent';
  const [kind, setKind] = useState(initialKind);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const all = useEPurseStore((s) => s.lentBorrowed);
  const transactions = useEPurseStore((s) => s.transactions);
  const addLentBorrowed = useEPurseStore((s) => s.addLentBorrowed);
  const settle = useEPurseStore((s) => s.settleLentBorrowed);

  const list = useMemo(() => all.filter((l) => l.kind === kind), [all, kind]);
  const total = useMemo(() => {
    const manualTotal = list.reduce((s, l) => s + l.amount, 0);
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
  }, [list, transactions, kind]);

  const grad =
    kind === 'lent'
      ? [colors.gradientGreenStart, colors.gradientGreenEnd]
      : [colors.gradientPurpleStart, colors.gradientPurpleEnd];

  const handleAdd = () => {
    const n = parseFloat(amount);
    if (!person.trim() || !n || n <= 0) {
      Alert.alert('Missing fields', 'Add a person and a positive amount.');
      return;
    }
    if (n > MAX_ALLOWED_AMOUNT) {
      Alert.alert('Amount too large', 'Maximum allowed amount is ₹10,00,00,000 (10 crore).');
      return;
    }
    addLentBorrowed({ kind, person: person.trim(), amount: n, note: note.trim() });
    setPerson('');
    setAmount('');
    setNote('');
  };

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

        <FlatList
          data={list}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.person.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.person}</Text>
                <Text style={styles.note}>
                  {item.note ? item.note + ' · ' : ''}{formatDate(item.date)}
                </Text>
              </View>
              <Text style={styles.amt}>{formatCurrency(item.amount)}</Text>
              <TouchableOpacity style={styles.settle} onPress={() => settle(item.id)}>
                <Text style={styles.settleText}>Settle</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Nothing here yet. Add an entry above ↑</Text>
          }
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center', justifyContent: 'center',
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

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary + '22',
    alignItems: 'center', justifyContent: 'center',
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

  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
});

export default LentBorrowedScreen;
