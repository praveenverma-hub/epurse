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
// Every row opens ONE sheet (LbEntryDetailSheet), whatever its source; only the
// sheet's button differs. Rows materialised from a group expense (`groupId`) or
// backed by a real transaction (`sourceTxnId`) aren't edited here — changing them
// would contradict the group expense or the balance that transaction moved — so
// their sheet points to the group / transaction instead (see `isLentBorrowedEditable`).
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import Modal from "../components/AppModal";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDate, formatOutstanding, firstName, titleCaseName } from '../utils/format';
import { INPUT_LIMITS, sanitizeAmount, isValidAmount } from '../utils/validation';
import { ENTRY_LABEL, isPositiveEntry } from '../constants/lbEntries';
import { FormField, FormTextInput, FormAmountInput, FormValueCard, FormValueRow } from '../components/FormField';
import DateField from '../components/DateField';
import PrimaryButton from '../components/PrimaryButton';
import SectionHeader from '../components/SectionHeader';
import SheetCloseButton from '../components/SheetCloseButton';
import CenterModal from '../components/CenterModal';
import EmptyState from '../components/EmptyState';
import LbEntryForm from '../components/LbEntryForm';
import AccountPickerSheet from '../components/AccountPickerSheet';
import LbEntryDetailSheet, { lbToneInk } from '../components/LbEntryDetailSheet';
import TxnDetailSheet from '../components/TxnDetailSheet';
import {
  LB_NO_ACCOUNT, lbAccountFieldLabel, lbEffectiveKind, lbEntryMeta, lbEntrySign, lbEntryTitle,
  lbEntryTone, lbLinkedLine, lbMoneyOut, lbNoteText, lbToastTitle,
} from '../utils/lbEntryDisplay';
import { defaultAccountId as pickDefaultAccountId } from '../utils/defaultAccount';
import { txnAccountLabel } from '../utils/txnCardModel';
import { useToast } from '../components/Toast';

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
  const transactions          = useEPurseStore((s) => s.transactions);
  const settlePersonBalance   = useEPurseStore((s) => s.settlePersonBalance);
  const recordLbEntry         = useEPurseStore((s) => s.recordLbEntry);
  const updateLentBorrowedEntry = useEPurseStore((s) => s.updateLentBorrowedEntry);
  const deleteLentBorrowedEntry = useEPurseStore((s) => s.deleteLentBorrowedEntry);
  const isLentBorrowedEditable  = useEPurseStore((s) => s.isLentBorrowedEditable);
  const lentBorrowedAccountId   = useEPurseStore((s) => s.lentBorrowedAccountId);

  const [detailEntry,  setDetailEntry]  = useState(null);  // the row whose sheet is open
  const [editEntry,    setEditEntry]    = useState(null);  // the row being edited
  const [viewTxn,      setViewTxn]      = useState(null);  // the transaction behind a row
  const [addOpen,      setAddOpen]      = useState(false);  // new entry for this person
  const [addKind,      setAddKind]      = useState('lent');  // direction of that new entry
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
        groupId: g.groupId,
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

  // The history behind the hero's net — "how did we get here". One direction
  // shows its round trip (Lent │ Got Back, Borrowed │ Repaid); both directions
  // show the two sides. Null when there's nothing but settle rows.
  const summaryCells = useMemo(() => {
    const sum = { lent: 0, lent_settled: 0, borrowed: 0, borrow_repaid: 0 };
    (person?.entries || []).forEach((e) => { if (e.kind in sum) sum[e.kind] += Number(e.amount) || 0; });
    if (sum.lent && sum.borrowed) return [['YOU LENT', sum.lent], ['YOU BORROWED', sum.borrowed]];
    if (sum.lent) return [['YOU LENT', sum.lent], ['GOT BACK', sum.lent_settled]];
    if (sum.borrowed) return [['YOU BORROWED', sum.borrowed], ['YOU REPAID', sum.borrow_repaid]];
    return null;
  }, [person]);
  // displayEntries is sorted most-recent-first (see above), so its head IS the
  // last activity — no second pass over the raw entries needed.
  const lastActivityDate = displayEntries[0]?.date || null;

  // ── Settle the person's FULL net ────────────────────────────────────────────
  // Either direction asks which account the money moved through (the picker IS the
  // confirmation); "Not from an account" keeps it ledger-only.
  const handleSettlePress = useCallback(() => {
    if (!person || net === 0) return;
    setSettleTarget(person);
  }, [person, net]);

  /** Both committing exits of the settle picker — with an account, or ledger-only. */
  const commitSettle = useCallback((accountId) => {
    const target = settleTarget;
    if (!target) return;
    const res = settlePersonBalance(target.personKey, accountId ? { accountId } : undefined);
    const who = firstName(target.person);
    toast.success(
      lbToastTitle(target.net < 0 ? 'borrow_repaid' : 'lent_settled', Math.abs(target.net), who),
      res?.linkedTxn ? lbLinkedLine(res.linkedTxn) : formatOutstanding(freshNet(), who),
    );
    setSettleTarget(null);
  }, [settleTarget, settlePersonBalance, toast, freshNet]);

  /**
   * Add a new row for THIS person, straight from their ledger — saves bouncing back
   * to the LB tab and re-picking someone you're already looking at. Committed through
   * recordLbEntry, which books (or links) it on the form's account.
   *
   * contactId / phone are carried over deliberately: getPersonBalances groups by
   * those authoritative ids first, so omitting them would file the entry under a
   * name-only key and split one person into two rows on the LB screen.
   */
  const handleAddEntry = useCallback((entry) => {
    if (!person) return;
    const { kind: addKind, alreadySettled, accountId, ...base } = entry;
    const kind = lbEffectiveKind(addKind, alreadySettled);
    const seeded = {
      ...base,
      person:    base.person || person.person,
      contactId: person.contactId ?? null,
      phone:     person.phone ?? null,
    };
    setAddOpen(false);
    const res = recordLbEntry({ ...seeded, kind }, { accountId });
    if (!res) return;
    const who = firstName(seeded.person);
    toast.success(
      lbToastTitle(kind, seeded.amount, who),
      res.linkedTxn ? lbLinkedLine(res.linkedTxn) : formatOutstanding(freshNet(), who),
    );
  }, [person, recordLbEntry, toast, freshNet]);

  // ── Delete a manual row ─────────────────────────────────────────────────────
  const handleDelete = useCallback((entry) => {
    const viaAccount = accounts.find((a) => a.id === lentBorrowedAccountId(entry));
    setConfirm({
      title: 'Delete this entry?',
      message:
        `${ENTRY_LABEL[entry.kind] || entry.kind} · ${formatCurrency(entry.amount)}\n\n` +
        (viaAccount
          ? `Also deletes its transaction and ${lbMoneyOut(entry.kind) ? 'puts' : 'takes'} ${formatCurrency(entry.amount)} ${lbMoneyOut(entry.kind) ? 'back in' : 'back out of'} ${viaAccount.name}. This cannot be undone.`
          : 'Removes it from the ledger and re-nets the balance. This cannot be undone.'),
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
  }, [deleteLentBorrowedEntry, toast, person, freshNet, accounts, lentBorrowedAccountId]);

  // ── Rows ────────────────────────────────────────────────────────────────────
  // A ledger row is coloured from the user's OWN money (see lbEntryTone): Lent and
  // Repaid are your money leaving → LB's coral; Borrowed and Received back stay
  // plain; a group line is a running net, so it keeps the lent/borrowed framing.
  // Every row taps into the same detail sheet; the chevron says so and keeps
  // the amounts in one column.
  const renderEntry = useCallback((entry) => {
    const entryColor = lbToneInk(lbEntryTone(entry), theme);
    return (
      <TouchableOpacity
        key={entry.id}
        style={[styles.entryCard, entry.settledAt && styles.entrySettled]}
        activeOpacity={0.75}
        onPress={() => setDetailEntry(entry)}
        accessibilityRole="button"
        accessibilityHint="Opens details"
      >
        <View style={[styles.entryIconTile, { backgroundColor: entryColor + '18' }]}>
          <Ionicons name={rowIconName(entry)} size={18} color={entryColor} />
        </View>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.entryTitle} numberOfLines={1}>{lbEntryTitle(entry)}</Text>
          <Text style={styles.entrySub} numberOfLines={1}>{lbEntryMeta(entry)}</Text>
        </View>
        <Text style={[styles.entryAmt, { color: entryColor }]} numberOfLines={1}>
          {lbEntrySign(entry)} {formatCurrency(entry.amount)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={styles.entryChevron} />
      </TouchableOpacity>
    );
  }, [theme]);

  const detailTxn = detailEntry?.sourceTxnId ? transactions.find((t) => t.id === detailEntry.sourceTxnId) || null : null;

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
            <Text style={styles.heroHint}>Last activity {formatDate(lastActivityDate)}</Text>
          ) : null}
        </View>

        {/* Same segmented-surface treatment as Home's Income/Refunds card, on a
            white surface here (this screen has no gradient header to sit on). */}
        {summaryCells ? (
          <View style={styles.summaryCardShadow}>
          <View style={styles.summaryCard}>
            {summaryCells.map(([label, value], i) => (
              <React.Fragment key={label}>
                {i > 0 ? <View style={styles.summaryDivider} /> : null}
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>{label}</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>{formatCurrency(value)}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
          </View>
        ) : null}

        <SectionHeader
          icon="time-outline"
          title="Transaction History"
          style={styles.historyHeader}
        />

        <View style={styles.entriesCardShadow}>
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
        </View>
      </ScrollView>

      {/* Both person actions, pinned. With a balance, Settle is THE primary (filled)
          and Add sits beside it outlined; settled, Add is the only action and fills. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PrimaryButton
          title="Add Entry"
          variant={net !== 0 ? 'outline' : 'filled'}
          icon={<Ionicons name="add" size={18} color={net !== 0 ? theme.primary : '#FFFFFF'} />}
          onPress={() => {
            // Pre-pick the likelier direction: if you already owe them, the next
            // entry is usually another borrow. Still one tap to flip.
            setAddKind(net < 0 ? 'borrowed' : 'lent');
            setAddOpen(true);
          }}
          accessibilityLabel={`Add an entry with ${person.person || 'this person'}`}
          style={styles.footerBtn}
        />
        {net !== 0 ? (
          <PrimaryButton
            // Half-width: a lakh-scale figure won't fit beside Add, so it drops to plain "Settle".
            title={formatCurrency(netAbs).length <= 9 ? `Settle ${formatCurrency(netAbs)}` : 'Settle'}
            onPress={handleSettlePress}
            style={styles.footerBtn}
          />
        ) : null}
      </View>

      <LbEntryDetailSheet
        entry={detailEntry}
        person={person.person}
        sourceTxn={detailTxn}
        editable={!!detailEntry && !detailEntry.isGroupLine && isLentBorrowedEditable(detailEntry)}
        accountLabel={detailTxn
          ? txnAccountLabel(detailTxn, accounts.find((a) => a.id === detailTxn.accountId))
          // A row whose transaction is gone (older split, summarised) — account unknown,
          // so no Account row rather than a false "Not From an Account".
          : detailEntry?.sourceTxnId ? '' : LB_NO_ACCOUNT}
        onClose={() => setDetailEntry(null)}
        onEdit={setEditEntry}
        onViewTxn={setViewTxn}
        onOpenGroup={(entry) => navigation.navigate('GroupDetail', { groupId: entry.groupId })}
      />

      {/* A manually-lent txn is lbLocked (its ledger link is fixed), so it's view-only here. */}
      <TxnDetailSheet
        txn={viewTxn}
        onClose={() => setViewTxn(null)}
        onEdit={viewTxn && !viewTxn.lbLocked ? (t) => {
          setViewTxn(null);
          navigation.navigate('AddTransaction', { editTxnId: t.id });
        } : undefined}
      />

      <EditEntrySheet
        entry={editEntry}
        personName={person.person}
        accounts={accounts}
        accountId={editEntry ? lentBorrowedAccountId(editEntry) : null}
        theme={theme}
        onClose={() => setEditEntry(null)}
        onSave={(patch) => {
          const ok = updateLentBorrowedEntry(editEntry.id, patch);
          if (ok) {
            setEditEntry(null);
            toast.success('Entry updated', formatOutstanding(freshNet(), firstName(person?.person)));
          } else toast.info('Could not save', 'Check the amount, then try again.');
        }}
        onDelete={() => handleDelete(editEntry)}
      />

      {/* Add — a thin shell around the SAME form the LB tab uses, so this screen gets
          every section of it (already-settled toggle included) rather than a reduced
          copy that drifts. `lockedPerson` hides the name/phone/contact fields, and
          passing onKindChange is what surfaces the Lent/Borrowed selector, since
          there's no panel here to imply the direction. */}
      {/* NO `statusBarTranslucent` — it disables Android's adjustResize on this
          modal window. AppModal's keyboard boundary relies on the resized window
          to keep this bottom sheet above the keyboard. Only use it on sheets with
          no text input. */}
      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAddOpen(false)} />
          <SheetCloseButton onPress={() => setAddOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, styles.addSheetTitle]} numberOfLines={1}>
              New entry with {firstName(person.person) || 'this person'}
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <LbEntryForm
                kind={addKind}
                onKindChange={setAddKind}
                lockedPerson={{
                  person: person.person,
                  contactId: person.contactId ?? null,
                  phone: person.phone ?? null,
                }}
                accounts={accounts}
                defaultAccountId={pickDefaultAccountId(accounts)}
                onSubmit={handleAddEntry}
                theme={theme}
                submitLabel="Add Entry"
                hideHeading
                // The sheet already provides the card surface + padding.
                style={styles.addFormInSheet}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AccountPickerSheet
        visible={!!settleTarget}
        title={settleTarget?.net < 0 ? 'Repay from which account?' : 'Received in which account?'}
        subtitle={settleTarget
          ? `${titleCaseName(settleTarget.person)} · ${formatCurrency(Math.abs(settleTarget.net))}`
          : undefined}
        accounts={accounts.filter((a) => !a.archived)}
        selectedId={pickDefaultAccountId(accounts)}
        onSelect={(accountId) => commitSettle(accountId)}
        skipLabel={LB_NO_ACCOUNT}
        onSkip={() => commitSettle(null)}
        // Dismissing cancels outright — nothing is committed until a choice is made.
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
const EditEntrySheet = ({ entry, personName, accounts, accountId, theme, onClose, onSave, onDelete }) => {
  if (!entry) return null;
  return (
    <EntrySheetBody
      key={entry.id}
      entry={entry}
      personName={personName}
      accounts={accounts}
      accountId={accountId}
      theme={theme}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
};

/**
 * Edit an existing row. Adding is a different shape entirely — see LbEntryForm.
 * No Person field: this is one person's ledger (Add locks the person too), and a
 * free-text name either respelt one entry or silently MOVED it to another person.
 */
const EntrySheetBody = ({ entry, personName, accounts, accountId: initialAccountId, theme, onClose, onSave, onDelete }) => {
  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  // The account its money moved through (null = ledger-only). Changing it moves the
  // booked transaction, books one for a ledger-only entry, or removes it for "none".
  const [accountId, setAccountId] = useState(initialAccountId);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const liveAccounts = accounts.filter((a) => !a.archived);
  const selectedAccount = liveAccounts.find((a) => a.id === accountId) || null;
  const [note,   setNote]   = useState(() => lbNoteText(entry.note));
  const [date,   setDate]   = useState(() => new Date(entry.date));

  const canSave = isValidAmount(amount);

  // No `statusBarTranslucent` — see the add sheet above; it breaks Android keyboard
  // avoidance for any sheet with a text input.
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            Edit {ENTRY_LABEL[entry.kind] || 'entry'} · {titleCaseName(personName)}
          </Text>

          {/* Same shadow-clipping fix as the add sheet — "Save changes" is a
              PrimaryButton too. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
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

            {/* One row → the account picker sheet, rendered INSIDE this sheet's Modal
                (nested, like DateField's iOS picker), never beside it (§8b). */}
            {liveAccounts.length ? (
              <View style={styles.accountField}>
                <FormValueCard>
                  <FormValueRow
                    icon="wallet-outline"
                    label={lbAccountFieldLabel(entry.kind)}
                    value={selectedAccount?.name || LB_NO_ACCOUNT}
                    isPlaceholder={!selectedAccount}
                    onPress={() => setAccountsOpen(true)}
                    accentColor={theme.primary}
                  />
                </FormValueCard>
              </View>
            ) : null}

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
              <PrimaryButton
                title="Save changes"
                disabled={!canSave}
                onPress={() => onSave({
                  amount: Number(amount),
                  note: note.trim(),
                  // Only when changed — an unchanged account must not re-book anything.
                  ...(accountId !== initialAccountId ? { accountId } : {}),
                  date: date.toISOString(),
                })}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </View>
      <AccountPickerSheet
        visible={accountsOpen}
        title={lbMoneyOut(entry.kind) ? 'Paid from which account?' : 'Received in which account?'}
        accounts={liveAccounts}
        selectedId={selectedAccount?.id}
        onSelect={(id) => { setAccountId(id); setAccountsOpen(false); }}
        skipLabel={LB_NO_ACCOUNT}
        onSkip={() => { setAccountId(null); setAccountsOpen(false); }}
        onClose={() => setAccountsOpen(false)}
      />
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
    borderBottomWidth: DIVIDER_W,
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
  //
  // Shadow lives on this OPAQUE outer shell; the inner `summaryCard` clips the
  // divider's square corners to match — a shadow can't share a view with
  // `overflow:'hidden'`, which erases it (ui-consistency §6b).
  summaryCardShadow: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // Centred like the hero above it — one centred profile block.
  summaryCell: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  summaryDivider: {
    width: DIVIDER_W,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },
  summaryLabel: {
    ...typography.tiny, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.8,
  },
  summaryValue: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', marginTop: 3 },

  historyHeader: { marginBottom: spacing.sm },

  // ── ONE card holding every entry, rows separated by a hairline instead of
  // each row being its own shadowed card — a ledger reads as one list, not as
  // a stack of separate objects.
  //
  // Same shadow/overflow split as `summaryCardShadow` above.
  entriesCardShadow: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  entriesCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  noEntriesText: {
    ...typography.small, color: colors.textMuted, padding: spacing.lg, textAlign: 'center',
  },
  entryDivider: {
    height: DIVIDER_W,
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
  entryChevron: { marginLeft: spacing.xs },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    // paddingBottom is set inline — it's the larger of the home-indicator inset
    // or this same spacing.md, so the button never sits flush against a notch.
    backgroundColor: colors.card,
    borderTopWidth: DIVIDER_W,
    borderTopColor: colors.divider,
  },
  footerBtn:   { flex: 1, paddingHorizontal: spacing.sm },

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
  // Matches LbEntryForm's amountRow — the amount and the date button must not read
  // as one merged field (see the note there).
  amountRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accountField: { marginBottom: spacing.lg }, // same rhythm as a FormField
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
