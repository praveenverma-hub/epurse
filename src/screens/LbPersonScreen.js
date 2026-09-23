// =============================================================================
// LbPersonScreen — one person's full lent/borrowed ledger.
//
// Replaces the accordion that used to expand inside each person card on
// LentBorrowedScreen (Jul-31). The card keeps its summary role and its pencil
// now pushes here, which buys three things the dropdown couldn't give:
//   • room for the whole entry list instead of a nested 200px ScrollView
//   • per-entry EDIT + DELETE for manual rows (the reason for the change)
//   • one obvious home for the net Settle action
//
// Editability is not uniform, and that's deliberate — see
// `isLentBorrowedEditable` in the store. Rows materialised from a group expense
// (`groupId`) or backed by a real transaction (`sourceTxnId`) are shown read-only
// with the reason, because changing them here would contradict the group expense
// or the account balance that transaction already moved.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme, useLbGradients } from '../hooks/useTheme';
import { formatCurrency, formatDate, formatOutstanding, firstName, titleCaseName } from '../utils/format';
import { INPUT_LIMITS, sanitizeName, sanitizeAmount, isValidAmount } from '../utils/validation';
import { ENTRY_LABEL, isPositiveEntry } from '../constants/lbEntries';
import { FormField, FormTextInput, FormAmountInput } from '../components/FormField';
import DateField from '../components/DateField';
import GradientButton from '../components/GradientButton';
import SectionHeader from '../components/SectionHeader';
import SheetCloseButton from '../components/SheetCloseButton';
import CenterModal from '../components/CenterModal';
import AccountPickerSheet from '../components/AccountPickerSheet';
import EmptyState from '../components/EmptyState';
import EditIcon from '../components/EditIcon';
import LbEntryForm from '../components/LbEntryForm';
import { useToast } from '../components/Toast';

// Why a row can't be edited here — shown inline so the restriction explains itself
// rather than looking like a broken tap.
const LOCK_REASON = {
  group: 'From a group expense — edit it in the group',
  txn:   'From a bank transaction — edit the transaction',
};

// Row icon NAME only — same direction language as the LB tab's toggle/empty-state
// icons (arrow-up = lent, arrow-down = borrowed, checkmark = settled/repaid).
// Colour is NOT decided here: it's whatever colour the row's amount already
// uses, passed in by the caller, so the icon can never disagree with the figure
// beside it (lent_settled/borrow_repaid follow the SIGN, same as the amount —
// not their "family", which is what a separate lookup here used to draw wrong).
const ROW_ICON_NAME = {
  lent: 'arrow-up-right-box-outline',
  borrowed: 'arrow-down-left-box-outline',
  lent_settled: 'checkmark-circle-outline',
  borrow_repaid: 'checkmark-circle-outline',
};
const rowIconName = (entry) =>
  entry.isGroupLine ? 'people-outline' : (ROW_ICON_NAME[entry.kind] || 'swap-horizontal-outline');

const LbPersonScreen = ({ route, navigation }) => {
  const theme = useTheme();
  const lbGradients = useLbGradients();
  const toast = useToast();
  // The SafeAreaView below only claims the TOP edge (its white fill has to match
  // the header bar — see the styles comment), so the pinned Settle footer pays
  // its own bottom inset here, same pattern as BudgetPlanScreen's footer.
  const insets = useSafeAreaInsets();
  const personKey = route.params?.personKey;

  const getPersonBalances     = useEPurseStore((s) => s.getPersonBalances);
  const lentBorrowed          = useEPurseStore((s) => s.lentBorrowed);
  const groups                = useEPurseStore((s) => s.groups);
  const accounts              = useEPurseStore((s) => s.accounts);
  const settlePersonBalance   = useEPurseStore((s) => s.settlePersonBalance);
  const addLentBorrowed       = useEPurseStore((s) => s.addLentBorrowed);
  const addAlreadySettledLentBorrowed = useEPurseStore((s) => s.addAlreadySettledLentBorrowed);
  const updateLentBorrowedEntry = useEPurseStore((s) => s.updateLentBorrowedEntry);
  const deleteLentBorrowedEntry = useEPurseStore((s) => s.deleteLentBorrowedEntry);

  const [editEntry,    setEditEntry]    = useState(null);  // the row being edited
  const [addOpen,      setAddOpen]      = useState(false);  // new entry for this person
  const [addKind,      setAddKind]      = useState('lent');  // direction of that new entry
  const [pendingSettledAdd, setPendingSettledAdd] = useState(null); // already-repaid borrow awaiting account pick
  const [confirm,      setConfirm]      = useState(null);
  const [settleTarget, setSettleTarget] = useState(null);

  // Re-derived from `lentBorrowed` so an edit/delete/settle refreshes this screen
  // immediately — getPersonBalances reads the rows on every call, it caches nothing.
  const person = useMemo(
    () => getPersonBalances().find((p) => p.personKey === personKey) || null,
    [getPersonBalances, lentBorrowed, personKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const groupNameById = useMemo(() => {
    const map = {};
    (groups || []).forEach((g) => { map[g.id] = g.name; });
    return map;
  }, [groups]);

  // Same shaping as the old accordion: every row of one group collapses into a
  // single cumulative line (a person sharing 20 group expenses shouldn't produce
  // 20 rows), while manual IOUs and direct splits stay individual — those are the
  // editable ones, so they must remain addressable one by one.
  const displayEntries = useMemo(() => {
    if (!person) return [];
    const groupAcc = {};
    const singles = [];
    (person.entries || []).forEach((e) => {
      if (e.groupId) {
        if (!groupAcc[e.groupId]) groupAcc[e.groupId] = { groupId: e.groupId, net: 0, date: e.date };
        const g = groupAcc[e.groupId];
        g.net += isPositiveEntry(e.kind) ? e.amount : -e.amount;
        if (new Date(e.date) > new Date(g.date)) g.date = e.date;
      } else {
        singles.push(e);
      }
    });
    const groupLines = Object.values(groupAcc)
      .filter((g) => Math.abs(g.net) > 0.005)
      .map((g) => ({
        id: `grp_${g.groupId}`,
        isGroupLine: true,
        groupName: groupNameById[g.groupId] || 'Group',
        kind: g.net > 0 ? 'lent' : 'borrowed',
        amount: Math.abs(g.net),
        date: g.date,
      }));
    return [...groupLines, ...singles].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [person, groupNameById]);

  const net      = person?.net ?? 0;
  const netAbs   = Math.abs(net);

  /**
   * This person's net AFTER a store write — `person` above is memoised off the
   * previous render, so a callback that just fired an edit/delete would report the
   * stale balance. getPersonBalances caches nothing, so re-reading is exact.
   * Returns 0 once the person has no rows left at all (fully cleared).
   */
  const freshNet = useCallback(
    () => getPersonBalances().find((p) => p.personKey === personKey)?.net ?? 0,
    [getPersonBalances, personKey],
  );
  const isSettled = net === 0;
  const netColor = net > 0 ? theme.lent : net < 0 ? theme.borrowed : theme.success;
  const netLabel = net > 0 ? 'owes you' : net < 0 ? 'you owe' : 'All Settled';

  // Sum of every 'lent' + 'borrowed' entry, once each — the actual loans, not the
  // settle/repaid rows that just clear them. Counting those too would double an
  // amount that's settled (the origin AND its counterpart both add it in), so
  // this is deliberately the simpler, smaller number: "how much have you lent or
  // borrowed with this person, ever" rather than every ledger row summed blind.
  const totalDealt = (person.entries || [])
    .filter((e) => e.kind === 'lent' || e.kind === 'borrowed')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  // displayEntries is sorted most-recent-first (see above), so its head IS the
  // last activity — no second pass over the raw entries needed.
  const lastActivityDate = displayEntries[0]?.date || null;

  // ── Settle the person's FULL net ────────────────────────────────────────────
  const handleSettlePress = useCallback(() => {
    if (!person || net === 0) return;
    if (net < 0) { setSettleTarget(person); return; }
    setConfirm({
      title: 'Mark as settled?',
      message:
        `${person.person} · ${formatCurrency(netAbs)}\n\n` +
        `Settles the FULL net outstanding of ${formatCurrency(netAbs)} ` +
        `across all groups, splits and manual entries.`,
      primaryText: 'Settle',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        settlePersonBalance(person.personKey);
        setConfirm(null);
        const who = firstName(person.person);
        toast.success(
          `Settled ${formatCurrency(netAbs)} with ${who}`,
          formatOutstanding(freshNet(), who),
        );
      },
    });
  }, [person, net, netAbs, settlePersonBalance, toast, freshNet]);

  /**
   * Add a new row for THIS person, straight from their ledger — saves bouncing back
   * to the LB tab and re-picking someone you're already looking at.
   *
   * contactId / phone are carried over deliberately: getPersonBalances groups by
   * those authoritative ids first, so omitting them would file the entry under a
   * name-only key and split one person into two rows on the LB screen.
   */
  const handleAddEntry = useCallback((entry) => {
    if (!person) return;
    const { kind, alreadySettled, ...base } = entry;
    // Always file against THIS person's authoritative ids, whatever the form sent:
    // getPersonBalances groups by contactId / phone first, so a name-only row would
    // split one person into two on the LB screen.
    const seeded = {
      ...base,
      person:    base.person || person.person,
      contactId: person.contactId ?? null,
      phone:     person.phone ?? null,
    };
    const who = firstName(seeded.person);
    setAddOpen(false);

    if (alreadySettled) {
      // Same handoff as the LB tab: an already-repaid BORROW books a real Repayment
      // expense, so it needs an account before it can commit.
      if (kind === 'borrowed') {
        setPendingSettledAdd({ ...seeded, kind: 'borrowed' });
        return;
      }
      addAlreadySettledLentBorrowed({ ...seeded, kind: 'lent' });
      toast.success(
        `Settled ${formatCurrency(seeded.amount)} with ${who}`,
        formatOutstanding(freshNet(), who),
      );
      return;
    }

    addLentBorrowed({ ...seeded, kind: kind === 'borrowed' ? 'borrowed' : 'lent' });
    toast.success(
      kind === 'borrowed'
        ? `Borrowed ${formatCurrency(seeded.amount)} from ${who}`
        : `Lent ${formatCurrency(seeded.amount)} to ${who}`,
      formatOutstanding(freshNet(), who),
    );
  }, [person, addLentBorrowed, addAlreadySettledLentBorrowed, toast, freshNet]);

  /** The already-repaid BORROW added from this screen, after its account question. */
  const commitSettledAdd = useCallback((accountId) => {
    const entry = pendingSettledAdd;
    if (!entry) return;
    addAlreadySettledLentBorrowed(entry, accountId ? { accountId } : undefined);
    const who = firstName(entry.person);
    toast.success(
      `Repaid ${formatCurrency(entry.amount)} to ${who}`,
      formatOutstanding(freshNet(), who),
    );
    setPendingSettledAdd(null);
  }, [pendingSettledAdd, addAlreadySettledLentBorrowed, toast, freshNet]);

  /**
   * Both committing exits of the repay-account picker (a BORROW settle): with an
   * account, which also books the real Repayment expense, or without it.
   */
  const commitBorrowSettle = useCallback((accountId) => {
    const target = settleTarget;
    if (!target) return;
    settlePersonBalance(target.personKey, accountId ? { accountId } : undefined);
    const who = firstName(target.person);
    toast.success(
      `Repaid ${formatCurrency(Math.abs(target.net))} to ${who}`,
      formatOutstanding(freshNet(), who),
    );
    setSettleTarget(null);
  }, [settleTarget, settlePersonBalance, toast, freshNet]);

  // ── Delete a manual row ─────────────────────────────────────────────────────
  const handleDelete = useCallback((entry) => {
    setConfirm({
      title: 'Delete this entry?',
      message:
        `${ENTRY_LABEL[entry.kind] || entry.kind} · ${formatCurrency(entry.amount)}\n\n` +
        'Removes it from the ledger and re-nets the balance. This cannot be undone.',
      primaryText: 'Delete',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        const ok = deleteLentBorrowedEntry(entry.id);
        setConfirm(null);
        setEditEntry(null);
        if (ok) {
          const who = firstName(person?.person);
          toast.success(
            `Deleted ${ENTRY_LABEL[entry.kind]?.toLowerCase() || 'entry'} of ${formatCurrency(entry.amount)}`,
            formatOutstanding(freshNet(), who),
          );
        } else toast.info('Could not delete', 'This entry comes from a group or a transaction.');
      },
    });
  }, [deleteLentBorrowedEntry, toast, person, freshNet]);

  // ── Rows ────────────────────────────────────────────────────────────────────
  const renderEntry = useCallback((entry) => {
    // A ledger row here is a TRANSACTION CARD, coloured from the perspective of
    // the user's OWN money, not the balance it helps or the literal direction
    // alone. LB money is mostly temporary — Borrowed money isn't really yours
    // (you owe it back) and Received-back money is just your own money
    // returning (never a gain) — so both stay PLAIN. Lent and Repaid are the
    // two moments your own real money actually leaves your account, so those
    // are the ones that read as a loss — but the app's generic expense red is
    // the wrong red for it (that's reserved for real spending); this is still
    // an LB row, so it takes LB's OWN "money leaving" colour, `theme.borrowed`
    // (the coral the brand palette picked specifically to avoid danger red).
    // `isPositiveEntry` answers the net-worth question ("is this good for my
    // balance") and stays exactly that for the actual balance math (see the
    // group total above); it's the wrong question here, so this is deliberately
    // its own, separate call. The SIGN still follows literal cash direction
    // (+ arriving, − leaving) regardless.
    //
    // A group line is a running NET for that group, not one movement, so it
    // keeps the balance framing (lent/borrowed colours) instead.
    const isOutflow = entry.kind === 'lent' || entry.kind === 'borrow_repaid'; // your own money leaving
    const entryColor = entry.isGroupLine
      ? (entry.kind === 'lent' ? theme.lent : theme.borrowed)
      : (isOutflow ? theme.borrowed : colors.textPrimary);
    const sign = entry.isGroupLine
      ? (entry.kind === 'lent' ? '+' : '−')
      : (isOutflow ? '−' : '+');
    const editable   = !entry.isGroupLine && !entry.groupId && !entry.sourceTxnId;
    const lockReason = entry.isGroupLine || entry.groupId
      ? LOCK_REASON.group
      : entry.sourceTxnId ? LOCK_REASON.txn : null;
    const iconName = rowIconName(entry);

    const primaryText = entry.isGroupLine
      ? `Group · ${entry.groupName}`
      : (entry.note && entry.note !== 'Manual settlement'
          ? entry.note
          : ENTRY_LABEL[entry.kind] || entry.kind);
    const subText = entry.isGroupLine
      ? 'Group total'
      : `${ENTRY_LABEL[entry.kind]} · ${formatDate(entry.date)}`;

    return (
      <TouchableOpacity
        key={entry.id}
        style={[styles.entryCard, entry.settledAt && styles.entrySettled]}
        activeOpacity={editable ? 0.75 : 1}
        disabled={!editable}
        onPress={() => setEditEntry(entry)}
      >
        <View style={[styles.entryIconTile, { backgroundColor: entryColor + '18' }]}>
          <Ionicons name={iconName} size={18} color={entryColor} />
        </View>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.entryTitle} numberOfLines={1}>{primaryText}</Text>
          <Text style={styles.entrySub} numberOfLines={1}>{subText}</Text>
          {lockReason ? (
            <View style={styles.lockRow}>
              <Ionicons name="lock-closed-outline" size={10} color={colors.textMuted} />
              <Text style={styles.lockText} numberOfLines={1}>{lockReason}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.entryAmt, { color: entryColor }]} numberOfLines={1}>
          {sign} {formatCurrency(entry.amount)}
        </Text>
        {editable ? (
          <View
            style={[
              styles.entryEdit,
              { backgroundColor: theme.primary + '18', borderColor: theme.primary + '33' },
            ]}
          >
            <EditIcon size={16} color={theme.primary} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, [theme]);

  if (!person) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Ledger</Text>
          <View style={styles.backBtn} />
        </View>
        {/* `body` carries the page gray here too, so this branch matches the main
            one instead of showing a white page under the same white header. */}
        <View style={styles.body}>
          <EmptyState
            icon="arrow-up-circle-outline"
            title="Nothing here"
            subtitle="This person has no lent or borrowed entries left."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Light header (static `colors.card`) → DARK glyphs. Hardcoded, not a
          `theme.darkMode` ternary: this screen paints from the static `colors`
          palette, so its bar stays white in dark mode and light glyphs would
          vanish. See the status-bar skill. */}
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{titleCaseName(person.person) || 'Unknown'}</Text>
        {/* Plain spacer — the Add action now lives on "Transaction History" below,
            not up here. Still costs no width, so the title stays truly centred
            (both sides are one backBtn wide). */}
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.avatarRing, { borderColor: netColor }]}>
            <View style={[styles.avatar, { backgroundColor: netColor + '22' }]}>
              <Text style={[styles.avatarText, { color: netColor }]}>
                {(person.person || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
          {isSettled ? (
            <Ionicons
              name="checkmark-circle"
              size={40}
              color={theme.success}
              style={styles.heroTick}
              accessibilityLabel="All settled"
            />
          ) : (
            <Text style={[styles.heroAmt, { color: netColor }]} numberOfLines={1}>
              {formatCurrency(netAbs)}
            </Text>
          )}
          <Text style={[styles.heroLabel, { color: netColor }]}>{netLabel}</Text>
          {person.phone ? <Text style={styles.heroPhone}>{person.phone}</Text> : null}
          {lastActivityDate ? (
            <Text style={styles.heroHint}>
              Last activity {formatDate(lastActivityDate)} · {displayEntries.length}{' '}
              {displayEntries.length === 1 ? 'entry' : 'entries'}
            </Text>
          ) : null}
        </View>

        {/* Same segmented-surface treatment as Home's Income/Refunds card, on a
            white surface here (this screen has no gradient header to sit on). */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>TOTAL INVOLVED</Text>
            <Text style={styles.summaryValue} numberOfLines={1}>{formatCurrency(totalDealt)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>
              {net > 0 ? 'TOTAL LENT' : net < 0 ? 'TOTAL BORROWED' : 'SETTLED'}
            </Text>
            <Text style={[styles.summaryValue, { color: netColor }]} numberOfLines={1}>
              {formatCurrency(netAbs)}
            </Text>
          </View>
        </View>

        <SectionHeader
          icon="time-outline"
          title="Transaction History"
          style={styles.historyHeader}
          right={
            <TouchableOpacity
              onPress={() => {
                // Pre-pick the likelier direction: if you already owe them, the
                // next entry is usually another borrow. Still one tap to flip.
                setAddKind(net < 0 ? 'borrowed' : 'lent');
                setAddOpen(true);
              }}
              hitSlop={10}
              style={[styles.historyAddBtn, { backgroundColor: theme.primary + '18' }]}
              accessibilityRole="button"
              accessibilityLabel={`Add an entry with ${person.person || 'this person'}`}
            >
              <Ionicons name="add" size={16} color={theme.primary} />
              <Text style={[styles.historyAddBtnText, { color: theme.primary }]}>Add</Text>
            </TouchableOpacity>
          }
        />

        <View style={styles.entriesCard}>
          {displayEntries.length === 0 ? (
            <Text style={styles.noEntriesText}>No transactions with this person yet.</Text>
          ) : (
            displayEntries.map((entry, i) => (
              <React.Fragment key={entry.id}>
                {renderEntry(entry)}
                {i < displayEntries.length - 1 ? <View style={styles.entryDivider} /> : null}
              </React.Fragment>
            ))
          )}
        </View>
      </ScrollView>

      {net !== 0 ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={styles.footerLabel} numberOfLines={1}>
              {net > 0 ? 'Total owed to you' : 'Total you owe'}
            </Text>
            <Text style={[styles.footerAmt, { color: netColor }]} numberOfLines={1}>
              {formatCurrency(netAbs)}
            </Text>
          </View>
          <GradientButton title="Settle" onPress={handleSettlePress} style={styles.settleBtn} />
        </View>
      ) : null}

      <EditEntrySheet
        entry={editEntry}
        theme={theme}
        onClose={() => setEditEntry(null)}
        onSave={(patch) => {
          const ok = updateLentBorrowedEntry(editEntry.id, patch);
          if (ok) {
            setEditEntry(null);
            toast.success(
              `Updated to ${formatCurrency(patch.amount)}`,
              formatOutstanding(freshNet(), firstName(patch.person || person?.person)),
            );
          } else toast.info('Could not save', 'Check the amount and name, then try again.');
        }}
        onDelete={() => handleDelete(editEntry)}
      />

      {/* Add — a thin shell around the SAME form the LB tab uses, so this screen gets
          every section of it (already-settled toggle included) rather than a reduced
          copy that drifts. `lockedPerson` hides the name/phone/contact fields, and
          passing onKindChange is what surfaces the Lent/Borrowed selector, since
          there's no panel here to imply the direction. */}
      {/* NO `statusBarTranslucent` — it sets FLAG_LAYOUT_NO_LIMITS on the modal's own
          window, which disables Android's adjustResize. The window then never shrinks
          for the keyboard, and since KeyboardAvoidingView passes `undefined` on Android
          (it RELIES on that resize), a bottom-anchored sheet stays pinned behind the
          keyboard. Every other input-bearing sheet — CreateGroupModal, LinkContactModal,
          GroupExpenseSheet — omits it for the same reason. Only add it to sheets with no
          text input. */}
      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAddOpen(false)} />
          <SheetCloseButton onPress={() => setAddOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, styles.addSheetTitle]} numberOfLines={1}>
              New entry with {firstName(person.person) || 'this person'}
            </Text>
            {/* paddingBottom gives the submit button's OWN elevated shadow (shadows.elevated
                spills ~22px below it) room to render before the ScrollView's scrollable
                bounds clip it — without it, the shadow was cut flat at the button's edge. */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.addSheetScrollContent}
            >
              <LbEntryForm
                kind={addKind}
                onKindChange={setAddKind}
                lockedPerson={{
                  person: person.person,
                  contactId: person.contactId ?? null,
                  phone: person.phone ?? null,
                }}
                onSubmit={handleAddEntry}
                theme={theme}
                submitColors={addKind === 'lent' ? lbGradients.lent : lbGradients.borrowed}
                submitLabel="Add Entry"
                hideHeading
                // The sheet already provides the card surface + padding.
                style={styles.addFormInSheet}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AccountPickerSheet
        visible={!!pendingSettledAdd}
        title="Repaid from which account?"
        subtitle={pendingSettledAdd
          ? `${pendingSettledAdd.person} · ${formatCurrency(pendingSettledAdd.amount)} — records a Repayment expense`
          : undefined}
        accounts={accounts}
        onSelect={(accountId) => commitSettledAdd(accountId)}
        skipLabel="Just mark repaid (no expense)"
        // Dismissing still logs it — the user already committed by tapping Add; only
        // the account question was left open (same rule as the LB tab's picker).
        onSkip={() => commitSettledAdd(null)}
        onClose={() => commitSettledAdd(null)}
      />

      <AccountPickerSheet
        visible={!!settleTarget}
        title="Repay from which account?"
        subtitle={settleTarget
          ? `${settleTarget.person} · ${formatCurrency(Math.abs(settleTarget.net))} — records a Repayment expense`
          : undefined}
        accounts={accounts}
        onSelect={(accountId) => commitBorrowSettle(accountId)}
        skipLabel="Just mark repaid (no expense)"
        onSkip={() => commitBorrowSettle(null)}
        // Dismissing cancels outright — unlike the add form's picker, nothing has
        // been committed yet here; the settle IS the action being chosen.
        onClose={() => setSettleTarget(null)}
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

// ─── Edit sheet ───────────────────────────────────────────────────────────────
// Keyed on the entry id so switching rows remounts it with fresh state — a shared
// instance would keep the previous row's draft in its inputs.
/** Gate + remount: the `key` forces fresh useState seeds each time it opens. */
const EditEntrySheet = ({ entry, theme, onClose, onSave, onDelete }) => {
  if (!entry) return null;
  return (
    <EntrySheetBody
      key={entry.id}
      entry={entry}
      theme={theme}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
};

/** Edit an existing row. Adding is a different shape entirely — see LbEntryForm. */
const EntrySheetBody = ({ entry, theme, onClose, onSave, onDelete }) => {
  const [person, setPerson] = useState(entry.person || '');
  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [note,   setNote]   = useState(entry.note || '');
  const [date,   setDate]   = useState(() => new Date(entry.date));

  const canSave = isValidAmount(amount) && person.trim().length > 0;

  // No `statusBarTranslucent` — see the add sheet above; it breaks Android keyboard
  // avoidance for any sheet with a text input.
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            Edit {ENTRY_LABEL[entry.kind] || 'entry'}
          </Text>

          {/* Same shadow-clipping fix as the add sheet — "Save changes" is a
              GradientButton too. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.addSheetScrollContent}
          >
            {/* Amount + date share a row, matching the LB add form's layout. */}
            <FormField label="Amount">
              <View style={styles.amountRow}>
                <FormAmountInput
                  // Sheet, not a full add screen: the hero 28px made this row a
                  // head taller than Person/Note and the form read as ragged.
                  compact
                  value={amount}
                  onChangeText={(t) => setAmount(sanitizeAmount(t))}
                  placeholder="0"
                  style={styles.amountInput}
                  maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
                />
                <DateField
                  value={date}
                  onChange={setDate}
                  maximumDate={new Date()}
                  variant="icon"
                  // This sheet is built on the outlined FormField primitives, so
                  // the date button is outlined too — the filled default belongs
                  // to the LB *add* form (ui-consistency §3b).
                  surface="outlined"
                  accentColor={theme.primary}
                />
              </View>
            </FormField>

            <FormField label="Person">
              <FormTextInput
                value={person}
                onChangeText={(t) => setPerson(sanitizeName(t))}
                placeholder="Name"
                maxLength={INPUT_LIMITS.NAME_MAX}
              />
            </FormField>

            <FormField label="Note">
              <FormTextInput
                value={note}
                onChangeText={(t) => setNote(t.slice(0, INPUT_LIMITS.NOTE_MAX))}
                placeholder="Optional"
                maxLength={INPUT_LIMITS.NOTE_MAX}
              />
            </FormField>

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
              <GradientButton
                title="Save changes"
                disabled={!canSave}
                onPress={() => onSave({
                  amount: Number(amount),
                  person: person.trim(),
                  note: note.trim(),
                  date: date.toISOString(),
                })}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default LbPersonScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // WHITE, not the page gray: SafeAreaView paints the status-bar inset from this,
  // and a gray strip above a white header bar reads as a rendering glitch. The gray
  // page surface moves to `body` (the list) below.
  root: { flex: 1, backgroundColor: colors.card },
  body: { flex: 1, backgroundColor: colors.background },

  // Pushed screen → centred title (ui-consistency §2).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },

  listContent: { padding: spacing.lg, paddingBottom: spacing.xl },

  // CENTRED — deliberately different from LentBorrowedScreen's LEFT-aligned hero.
  // That screen's hero heads a LIST of people, so it lines up with the cards below it.
  // This one is a single contact's profile (avatar → net → phone), and a centred
  // profile block is the shape that reads as "this person".
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  // Thin halo around the avatar, coloured by direction (lent/borrowed) or by
  // success once settled. The avatar's own fill + initial match the ring colour
  // (set inline) rather than the fixed violet tint, so the two read as one
  // coloured badge instead of a status ring around an unrelated brand colour.
  avatarRing: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '800' },
  heroAmt:   { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  // Same slot as heroAmt when settled — a tick standing in for "₹0", not a
  // number that would just read as "nothing to show".
  heroTick:  { marginTop: 2 },
  heroLabel: { ...typography.small, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  heroPhone: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
  heroHint:  { ...typography.tiny, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },

  // ── Total dealt / current side — same segmented-surface idea as Home's
  // Income/Refunds card, rebuilt on a white surface (this screen has no
  // gradient header for it to sit on).
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  summaryCell: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },
  summaryLabel: {
    ...typography.tiny, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.8,
  },
  summaryValue: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', marginTop: 3 },

  historyHeader: { marginBottom: spacing.sm },
  // Add-entry action, moved here from the top header bar. Icon + label (not an
  // icon alone) — "Add" on its own reads as a stray glyph beside a heading in a
  // way it wouldn't as a lone FAB, where the position already says what it does.
  historyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  historyAddBtnText: { ...typography.tiny, fontWeight: '700' },

  // ── ONE card holding every entry, rows separated by a hairline instead of
  // each row being its own shadowed card — a ledger reads as one list, not as
  // a stack of separate objects.
  entriesCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  noEntriesText: {
    ...typography.small, color: colors.textMuted, padding: spacing.lg, textAlign: 'center',
  },
  entryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.md + 36 + spacing.sm, // clears the icon tile, matches the text column start
  },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  entrySettled: { opacity: 0.6 },
  // Symbol tile — same idea as CategoryIcon, sized to the row rather than a
  // transaction card's larger 44px version.
  entryIconTile: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  entryTitle: { ...typography.bodyBold, color: colors.textPrimary },
  entrySub:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  entryAmt:   { ...typography.bodyBold, fontWeight: '800', flexShrink: 0 },
  // Same 28×28 tinted circle as the pencil on LentBorrowedScreen's person cards
  // (which matches waBtn / bellBtn there) — one edit affordance across both screens.
  entryEdit: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  lockRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  lockText:   { ...typography.tiny, color: colors.textMuted, flexShrink: 1 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    // paddingBottom is set inline — it's the larger of the home-indicator inset
    // or this same spacing.md, so the button never sits flush against a notch.
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  footerLabel: { ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },
  footerAmt:   { ...typography.h3, fontWeight: '800', marginTop: 1 },
  settleBtn:   { minWidth: 120 },

  // ── Edit sheet ──
  sheetBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider, alignSelf: 'center', marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.lg },
  // The add sheet's form opens with its own header row (the "already settled" chip),
  // which carries spacing.md of its own — so the full sheetTitle gap would compound
  // into a hole above the direction chips. The edit sheet starts with a field and
  // keeps the full gap.
  addSheetTitle: { marginBottom: spacing.sm },
  // Room for the submit button's elevated shadow — see the comment at its
  // ScrollView. Shared by both sheets (add + edit); both end on one.
  addSheetScrollContent: { paddingBottom: spacing.lg + spacing.sm },
  // Matches LbEntryForm's amountRow — the amount and the date button must not read
  // as one merged field (see the note there).
  amountRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountInput: { flex: 1 },
  // LbEntryForm renders as a card (fill + shadow + margin). Inside this sheet the
  // sheet IS the surface, so flatten it rather than nesting a card in a card.
  // The shadow must be zeroed EXPLICITLY: dropping the fill doesn't drop the
  // shadow, and `elevation` in particular still paints a hard rectangle on Android
  // around an invisible card. shadowColor too — 'transparent' alone isn't enough on
  // iOS once shadowOpacity is inherited.
  addFormInSheet: {
    backgroundColor: 'transparent',
    padding: 0,
    marginBottom: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.danger + '66',
    backgroundColor: colors.danger + '0D',
  },
  deleteBtnText: { ...typography.bodyBold, color: colors.danger, fontWeight: '700', fontSize: 15 },
});
