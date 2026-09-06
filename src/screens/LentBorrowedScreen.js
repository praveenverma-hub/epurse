import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { TabView } from 'react-native-tab-view';
import { Ionicons } from '@expo/vector-icons';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

import EmptyState from '../components/EmptyState';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme, useLbGradients } from '../hooks/useTheme';
import { formatCurrency, formatOutstanding, firstName } from '../utils/format';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import AccountPickerSheet from '../components/AccountPickerSheet';
import LbEntryForm from '../components/LbEntryForm';
import InfoIcon from '../components/InfoIcon';
import InfoSheet from '../components/InfoSheet';
import Svg, { Path } from 'react-native-svg';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const LB_ROUTES = [
  { key: 'lent', label: 'Lent' },
  { key: 'borrowed', label: 'Borrowed' },
];

const keyToIndex = (k) => (k === 'borrowed' ? 1 : 0);
const initialLayout = { width: Dimensions.get('window').width };

const LentBorrowedScreen = ({ route, navigation }) => {
  const theme = useTheme();
  const toast = useToast();
  const initialKind = route?.params?.kind || 'lent';
  // Tab index is the source of truth; `kind` is the active route's key. This
  // keeps the existing kind-based logic intact while the native pager drives
  // the real swipe between the Lent and Borrowed panels.
  const [index, setIndex] = useState(() => keyToIndex(initialKind));
  const kind = LB_ROUTES[index].key;
  const setKind = useCallback((k) => setIndex(keyToIndex(k)), []);
  const [pendingSettledAdd, setPendingSettledAdd] = useState(null); // already-repaid borrow awaiting account pick
  const [confirm, setConfirm] = useState(null);
  const [infoVisible, setInfoVisible] = useState(false);

  const all = useEPurseStore((s) => s.lentBorrowed);
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const addLentBorrowed      = useEPurseStore((s) => s.addLentBorrowed);
  const addAlreadySettledLentBorrowed = useEPurseStore((s) => s.addAlreadySettledLentBorrowed);
  const getPersonBalances    = useEPurseStore((s) => s.getPersonBalances);
  // "Does this person already have a reminder?" now comes from the reminder
  // REGISTRY (keyed by personKey in `sourceKey`), which is also what the
  // Reminders screen lists — one source, so the bell and that list can't disagree.
  const reminders = useEPurseStore((s) => s.reminders);
  const remindedKeys = useMemo(
    () => new Set((reminders || []).map((r) => r.sourceKey).filter(Boolean)),
    [reminders],
  );
  /**
   * The person's signed net (> 0 = they owe you) as it stands NOW — call after the
   * store write so a toast can report the resulting position. Matches on the
   * strongest id available, mirroring how getPersonBalances groups entries
   * (contactId / phone are authoritative; name is the fallback).
   * Returns null when the person can't be resolved, so callers just omit the line.
   */
  const netWithPerson = useCallback((entry) => {
    const rows = getPersonBalances();
    const name = (entry.person || '').trim().toLowerCase();
    const match = rows.find((p) =>
      (entry.contactId && p.contactId === entry.contactId) ||
      (entry.phone && p.phone === entry.phone) ||
      (p.person || '').trim().toLowerCase() === name
    );
    return match ? match.net : null;
  }, [getPersonBalances]);

  /**
   * Commit a validated entry from LbEntryForm. Validation + field state live in the
   * form now; this owns only what the STORE should do with the result — including
   * the one branch that can't just write and finish: an already-repaid BORROW books
   * a real Repayment expense, so it needs an account before it can commit.
   */
  const handleAdd = useCallback((entry) => {
    const { kind: addKind, alreadySettled: settled, ...baseEntry } = entry;
    const n = baseEntry.amount;

    if (settled) {
      // A borrow's counterpart (borrow_repaid) is a real expense — pick which
      // account it left before committing (same as the Settle flow). No toast on
      // this branch: the account picker below is the actual commit point.
      if (addKind === 'borrowed') {
        setPendingSettledAdd({ ...baseEntry, kind: 'borrowed' });
        return;
      }
      addAlreadySettledLentBorrowed({ ...baseEntry, kind: 'lent' });
      const settledWho = firstName(baseEntry.person);
      toast.success(
        `Settled ${formatCurrency(n)} with ${settledWho}`,
        formatOutstanding(netWithPerson(baseEntry), settledWho),
      );
      return;
    }

    addLentBorrowed({ ...baseEntry, kind: addKind });
    const who = firstName(baseEntry.person);
    const net = netWithPerson(baseEntry);
    toast.success(
      addKind === 'lent'
        ? `Lent ${formatCurrency(n)} to ${who}`
        : `Borrowed ${formatCurrency(n)} from ${who}`,
      // Only worth a second line when the running total says something the title
      // doesn't — on a first entry the two are identical.
      net != null && Math.abs(Math.abs(net) - n) > 0.01
        ? formatOutstanding(net, who)
        : undefined,
    );
  }, [addLentBorrowed, addAlreadySettledLentBorrowed, toast, netWithPerson]);

  /**
   * Commit an "already repaid" BORROW. All three exits of the account picker land
   * here — pick an account (books the Repayment expense), skip, or dismiss — since
   * the entry itself is committed either way; only the account question differs.
   */
  const commitSettledBorrow = useCallback((accountId) => {
    const entry = pendingSettledAdd;
    if (!entry) return;
    addAlreadySettledLentBorrowed(entry, accountId ? { accountId } : undefined);
    const who = firstName(entry.person);
    toast.success(
      `Repaid ${formatCurrency(entry.amount)} to ${who}`,
      formatOutstanding(netWithPerson(entry), who),
    );
    setPendingSettledAdd(null);
  }, [pendingSettledAdd, addAlreadySettledLentBorrowed, toast, netWithPerson]);

  // Per-person balances for BOTH panels (both scenes are mounted by the pager).
  // lent panel shows net > 0, borrowed panel shows net < 0. Also include
  // recently-settled (net === 0) persons for up to 3 months.
  const balancesByKind = useMemo(() => {
    const nowMs = Date.now();
    const allBalances = getPersonBalances();
    const build = (k) => {
      const active = allBalances.filter((p) => (k === 'lent' ? p.net > 0 : p.net < 0));
      const recentlySettled = allBalances.filter((p) => {
        if (p.net !== 0 || !p.entries.length) return false;
        // Recency includes `createdAt` (when the row was recorded), not just `date`,
        // which the user can backdate. Without it, settling a months-old debt today
        // dropped the person off BOTH panels the instant they hit zero — the entry
        // was saved, but nothing on this screen showed it.
        const mostRecent = Math.max(
          ...p.entries.map((e) => {
            const d = new Date(e.date).getTime() || 0;
            const c = e.createdAt ? new Date(e.createdAt).getTime() || 0 : 0;
            const s = e.settledAt ? new Date(e.settledAt).getTime() || 0 : 0;
            return Math.max(d, c, s);
          })
        );
        if (nowMs - mostRecent > THREE_MONTHS_MS) return false;
        const hasLent = p.entries.some((e) => e.kind === 'lent');
        const hasBorrowed = p.entries.some((e) => e.kind === 'borrowed');
        return k === 'lent' ? hasLent : (hasBorrowed && !hasLent);
      });
      return [...active, ...recentlySettled];
    };
    return { lent: build('lent'), borrowed: build('borrowed') };
  }, [getPersonBalances, all]);

  // Totals for the header (per panel).
  const totalByKind = useMemo(() => {
    const allBalances = getPersonBalances();
    return {
      lent: allBalances.filter((p) => p.net > 0).reduce((s, p) => s + p.net, 0),
      borrowed: allBalances
        .filter((p) => p.net < 0)
        .reduce((s, p) => s + Math.abs(p.net), 0),
    };
  }, [getPersonBalances, all]);
  const total = totalByKind[kind];

  // Theme-derived, shared with the Dashboard widget and LbPersonScreen.
  const lbGradients = useLbGradients();
  const gradFor = useCallback(
    (k) => (k === 'lent' ? lbGradients.lent : lbGradients.borrowed),
    [lbGradients]
  );
  const grad = gradFor(kind);

  const renderPersonCard = useCallback(
    ({ item: pb }) => {
      const isFullySettled = pb.net === 0;
      const netAbs = Math.abs(pb.net);
      const netLabel = pb.net > 0 ? 'owes you' : 'you owe';
      const netColor = pb.net > 0 ? colors.success : '#EF4444';

      // The card is a pure summary now — tapping it opens this person's own ledger
      // screen (LbPersonScreen), which owns the entry list, the per-entry edit and
      // the net Settle action that all used to live in an inline accordion here.
      const openPerson = () => navigation.navigate('LbPerson', { personKey: pb.personKey });

      return (
        <View style={[styles.personCard, isFullySettled && styles.personCardSettled]}>
          <TouchableOpacity
            style={styles.personCardHeader}
            onPress={openPerson}
            activeOpacity={0.85}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.primary + '22' },
                isFullySettled && styles.avatarSettled,
              ]}
            >
              <Text
                style={[
                  styles.avatarText,
                  { color: theme.primary },
                  isFullySettled && styles.avatarTextSettled,
                ]}
              >
                {(pb.person || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text
                style={[styles.name, isFullySettled && styles.nameSettled]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {pb.person || 'Unknown'}
              </Text>
              {pb.phone ? (
                <Text style={styles.personPhone} numberOfLines={1}>{pb.phone}</Text>
              ) : null}
            </View>
            {isFullySettled ? (
              <View style={styles.settledBadge}>
                <Text style={styles.settledBadgeText}>✓ Settled</Text>
              </View>
            ) : (
              <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <Text style={[styles.netAmount, { color: netColor }]} numberOfLines={1}>
                  {formatCurrency(netAbs)}
                </Text>
                <Text style={[styles.netLabel, { color: netColor }]}>
                  {netLabel}
                </Text>
              </View>
            )}
            {!isFullySettled && pb.net > 0 ? (
              <TouchableOpacity
                style={styles.waBtn}
                onPress={(e) => {
                  e.stopPropagation?.();
                  navigation.navigate('WhatsAppReminder', {
                    person: pb.person, phone: pb.phone, amount: pb.net,
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <WAIcon />
              </TouchableOpacity>
            ) : null}
            {/* Schedule a reminder — BORROW side only, by design. The two
                directions need different things: money you owe is YOUR task, so
                you schedule a nudge to yourself; money owed TO you is someone
                else's task, so the action is to message them (the WhatsApp
                button above), not to set your own alarm. */}
            {!isFullySettled && pb.net < 0 ? (
              <TouchableOpacity
                style={[styles.bellBtn, remindedKeys.has(pb.personKey) && styles.bellBtnActive]}
                onPress={(e) => {
                  e.stopPropagation?.();
                  // Amount + person go over STRUCTURED so the form can emphasise
                  // them in its "Remind yourself to pay ₹X to Y" line and compose
                  // the notification body from the same values.
                  navigation.navigate('ReminderForm', {
                    kind: 'lb_borrow',
                    sourceKey: pb.personKey,
                    presetTitle: `Pay ${pb.person}`,
                    presetAmount: Math.abs(pb.net),
                    presetPerson: pb.person,
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Set a reminder to pay ${pb.person}`}
              >
                <Ionicons
                  name={remindedKeys.has(pb.personKey) ? 'notifications' : 'notifications-outline'}
                  size={16}
                  color={remindedKeys.has(pb.personKey) ? theme.primary : colors.textMuted}
                />
              </TouchableOpacity>
            ) : null}
            {/* No edit affordance here on purpose: the whole card already opens this
                person's ledger, and editing happens per-entry there. A pencil implied
                the card itself was editable and duplicated the card's own tap. */}
          </TouchableOpacity>
        </View>
      );
    },
    [navigation, remindedKeys, theme.primary]
  );

  // Form + empty state are rendered per panel (both scenes are mounted). They
  // take the panel's kind `k` so the offscreen page shows the correct copy.
  const renderForm = (k) => (
    <LbEntryForm
      // `kind` comes from the panel, so no direction selector here.
      kind={k}
      onSubmit={handleAdd}
      theme={theme}
      submitColors={gradFor(k)}
    />
  );

  const renderEmpty = (k) => (
    <EmptyState
      icon={k === 'lent' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
      title={k === 'lent' ? 'Nothing lent out' : 'Nothing borrowed'}
      subtitle={
        k === 'lent'
          ? 'Money you lend will show here so you can track what to collect.'
          : 'Money you borrow will show here so you can track what to repay.'
      }
    />
  );

  const headerComponent = (
    <CollapsingHeaderScreen
      collapsible={false}
      gradientColors={grad}
      onBack={() => navigation.goBack()}
      title={kind === 'lent' ? 'You Lent' : 'You Borrowed'}
      headerRight={
        <TouchableOpacity
          onPress={() => setInfoVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="About lent and borrowed"
        >
          <InfoIcon size={22} color={colors.textOnGradient} />
        </TouchableOpacity>
      }
      renderHero={() => (
        <>
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
        </>
      )}
    />
  );

  const renderScene = ({ route: r }) => {
    const k = r.key;
    return (
      <View style={styles.container}>
        <FlatList
          data={balancesByKind[k]}
          keyExtractor={(item) => item.personKey}
          renderItem={renderPersonCard}
          ListHeaderComponent={renderForm(k)}
          ListEmptyComponent={renderEmpty(k)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={7}
        />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TabView
        navigationState={{ index, routes: LB_ROUTES }}
        renderScene={renderScene}
        renderTabBar={() => headerComponent}
        onIndexChange={setIndex}
        initialLayout={initialLayout}
        swipeEnabled
      />

        {/* Explains the FOUR categories an entry can land in, because the form
            only surfaces two ("Lend to someone" / "Borrow from someone") — the
            settled pair is reachable via the "already settled" toggle, which
            isn't self-explanatory. */}
        <InfoSheet
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          title="Lent & Borrowed"
          eyebrow="Four kinds of entry"
          body="Every IOU is one of four kinds. Add the two open ones from the form below, or tick “already settled” to log one that's already closed."
          icon={<Ionicons name="swap-horizontal" size={28} color={theme.primary} />}
          bullets={[
            { emoji: '📤', label: 'Lent',          value: 'You gave money out — they owe you. Shows under “You Lent”.' },
            { emoji: '📥', label: 'Borrowed',      value: 'You took money — you owe them. Shows under “You Borrowed”.' },
            { emoji: '✅', label: 'Lent settled',  value: 'They paid you back. Tick “as Lent settled” to log a loan that is already closed.' },
            { emoji: '🤝', label: 'Borrow repaid', value: 'You paid them back. Tick “as Borrow repaid”; you can also book it as a real Repayment expense on an account.' },
            { emoji: '📱', label: 'From an SMS',   value: 'You can also re-tag any bank transaction into one of these four from its category picker.' },
            { emoji: '🧮', label: 'Not spending',  value: 'None of these count towards your monthly spend — only a Repayment expense does. Balances still move.' },
          ]}
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

        {/* The net-settle account picker moved to LbPersonScreen along with the
            Settle button. The one below is a different flow — the add form's
            "already settled" toggle, which still lives on this screen. */}
        <AccountPickerSheet
          visible={!!pendingSettledAdd}
          title="Repaid from which account?"
          subtitle={pendingSettledAdd
            ? `${pendingSettledAdd.person} · ${formatCurrency(pendingSettledAdd.amount)} — records a Repayment expense`
            : undefined}
          accounts={accounts}
          onSelect={(accountId) => commitSettledBorrow(accountId)}
          skipLabel="Just mark repaid (no expense)"
          onSkip={() => commitSettledBorrow(null)}
          // Dismissing the backdrop still logs the entry (ledger-only) — the user
          // already committed to adding it by tapping "Add"; only the account
          // question was left open, so declining it shouldn't discard the entry.
          onClose={() => commitSettledBorrow(null)}
        />

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, flexGrow: 1 },

  // Hero text is centred to match the centred screen title above it (pushed
  // screens centre their header — see ui-consistency §2).
  // Hero label + amount are LEFT-aligned (the screen TITLE above them stays centred —
  // that's the pushed-screen header convention, ui-consistency §2; this is body-style
  // hero content inside the header, and it lines up with the cards below).
  subLabel: {
    color: '#FFFFFFCC',
    ...typography.small,
    marginTop: spacing.lg,
    textAlign: 'left',
  },
  bigAmount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'left',
  },
  toggleRow: {
    flexDirection: 'row',
    alignSelf: 'center',
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


  // Per-person card
  personCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
    overflow: 'hidden',
  },
  personCardSettled: {
    opacity: 0.72,
    borderWidth: 1,
    borderColor: colors.success + '33',
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
  avatarSettled: { backgroundColor: colors.success + '18' },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  avatarTextSettled: { color: colors.success },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  nameSettled: { color: colors.textSecondary },
  personPhone: {
    ...typography.tiny,
    color: colors.textSecondary,
    marginTop: 1,
  },
  netAmount: { ...typography.bodyBold, fontWeight: '800' },
  netLabel: { ...typography.tiny, fontWeight: '600', marginTop: 1 },
  // waBtn / bellBtn are a matched pair of 28×28 tinted circles — the trailing
  // affordances on a person card must read as one set.
  //
  // Glyph sizes are 16 (bell) / 17 (WhatsApp) — NOT identical on purpose. The
  // WhatsApp mark is a filled disc, so at an equal nominal size it reads larger
  // than a thin line glyph; the extra px evens them out optically.
  waBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#25D36618',
    borderWidth: 1,
    borderColor: '#25D36633',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  bellBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#6366F112',
    borderWidth: 1,
    borderColor: '#6366F130',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  bellBtnActive: {
    backgroundColor: '#6366F128',
    borderColor: '#6366F166',
  },
  settledBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    backgroundColor: colors.success + '18',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success + '44',
  },
  settledBadgeText: {
    color: colors.success,
    ...typography.tiny,
    fontWeight: '700',
  },



});

const ContactPickIcon = ({ size = 18, color = colors.primary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
      fill={color}
    />
  </Svg>
);

const WAIcon = ({ size = 17 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
      fill="#25D366"
    />
    <Path
      d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.304A9.96 9.96 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.958 7.958 0 0 1-4.078-1.117l-.292-.173-3.03.794.808-2.951-.19-.303A7.96 7.96 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"
      fill="#25D366"
    />
  </Svg>
);

export default LentBorrowedScreen;
