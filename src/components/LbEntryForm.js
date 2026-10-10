// =============================================================================
// LbEntryForm — the Lent/Borrowed entry form BODY, shared by two shells.
// -----------------------------------------------------------------------------
// Mirrors the GroupExpenseForm arrangement (one form body, several shells) so a
// change to LB entry capture lands everywhere at once:
//
//   • LentBorrowedScreen — inline in each panel's card. `kind` is fixed by the
//     panel you're on, so no direction selector is shown.
//   • LbPersonScreen     — inside the add sheet, with `lockedPerson` set (you're
//     already in someone's ledger). It passes `onKindChange`, which is what makes
//     the Lent/Borrowed selector appear, since there's no panel to imply it.
//
// The form owns ALL its state, its validation, and the contact-picker sheet. It
// reports one shape upward via onSubmit and holds no store dependency; both shells
// commit through the store's `recordLbEntry`.
//
// Every entry names the ACCOUNT its money moved through (Oct-10-26): one compact
// row, the PRIMARY account preselected, so a quick add stays quick. "Not From an
// Account" keeps an entry ledger-only (an old loan, untracked cash).
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

import { colors, radius, spacing, typography, shadows, BUTTON_H } from '../constants/theme';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import {
  INPUT_LIMITS,
  sanitizeName,
  normalizePhone,
  sanitizeAmount,
} from '../utils/validation';
import { formatCompact, formatCurrency, titleCaseName } from '../utils/format';
import { suggestLbPeople } from '../utils/lbPeopleSearch';
import PrimaryButton from './PrimaryButton';
import ContactPickerSheet from './ContactPickerSheet';
import DateField from './DateField';
import { FormChipRow, FormChip } from './FormField';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { LB_NO_ACCOUNT, lbAccountFieldLabel, lbEffectiveKind, lbMoneyOut } from '../utils/lbEntryDisplay';
import AccountPickerSheet from './AccountPickerSheet';
import EditIcon from './EditIcon';

const EMPTY = [];

const ContactPickIcon = ({ size = 18, color = colors.primary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
      fill={color}
    />
  </Svg>
);

/**
 * @param kind           'lent' | 'borrowed' — what the entry records.
 * @param onKindChange   Provide ONLY when the caller can't imply the direction;
 *                       its presence is what renders the Lent/Borrowed selector.
 * @param lockedPerson   { person, contactId, phone } — hides the name/phone/contact
 *                       fields and files the entry against this person.
 * @param people         People already on the ledger (getPersonBalances) — typing a
 *                       name suggests them, so a repeat entry joins the same person.
 * @param accounts       The user's accounts (archived ones are left out here).
 * @param defaultAccountId Preselected account — the primary (utils/defaultAccount).
 * @param onSubmit       (entry) => void, entry =
 *                       { person, phone, contactId, amount, date, note, kind, alreadySettled,
 *                         accountId } — accountId null = "Not From an Account".
 *                       Only called once the form has validated.
 * @param hideHeading    Suppress the form's own title (the shell already has one).
 *                       The "already settled" toggle stays either way.
 * @param submitOutlined Render the submit button OUTLINED (PrimaryButton variant) —
 *                       the LB tab's inline form uses this; the add SHEET
 *                       (LbPersonScreen) keeps the filled button, since it's the one
 *                       clear action in a focused sheet. Both in theme[kind].
 */
const LbEntryForm = ({
  kind,
  onKindChange,
  lockedPerson = null,
  people = EMPTY,
  accounts = EMPTY,
  defaultAccountId = null,
  onSubmit,
  theme,
  submitLabel = 'Add',
  submitOutlined = false,
  hideHeading = false,
  style,
}) => {
  const locked = !!lockedPerson;
  const [person, setPerson] = useState(lockedPerson?.person || '');
  const [phone, setPhone] = useState(lockedPerson?.phone || '');
  const [contactId, setContactId] = useState(lockedPerson?.contactId ?? null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [alreadySettled, setAlreadySettled] = useState(false);
  // undefined = not picked yet → follow the default (accounts may load after mount).
  const [pickedAccountId, setAccountId] = useState(undefined);
  const accountId = pickedAccountId === undefined ? defaultAccountId : pickedAccountId;
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const liveAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const selectedAccount = liveAccounts.find((a) => a.id === accountId) || null;
  const [formErr, setFormErr] = useState(null); // { person?: msg, amount?: msg } — each under its own field
  // Fixing one field clears only ITS message, not the other's.
  const clearErr = useCallback((field) => setFormErr((e) => (e?.[field] ? { ...e, [field]: null } : e)), []);
  const { submit, submitting } = useSubmitGuard();

  // ── Contact picker ─────────────────────────────────────────────────────────
  // The sheet itself (search, permission, the list) is shared — `ContactPickerSheet`
  // — so this form only owns WHEN it's open and what a pick does to its fields.
  const [contactSheetVisible, setContactSheetVisible] = useState(false);
  // Hidden once a person is chosen (suggestion or contact); typing again reopens it.
  const [personChosen, setPersonChosen] = useState(false);
  const suggestions = useMemo(
    () => (locked || personChosen ? EMPTY : suggestLbPeople(people, person)),
    [locked, personChosen, people, person],
  );
  const pickSuggestion = useCallback((p) => {
    setPerson(p.person);
    setContactId(p.contactId ?? null);
    setPhone(p.phone || '');
    setPersonChosen(true);
    setFormErr((e) => (e?.person ? { ...e, person: null } : e));
  }, []);
  const pickContact = useCallback(() => setContactSheetVisible(true), []);

  // A pick IS the identity: it replaces name, number and link together (the number
  // has no field of its own, so a stale one from an earlier pick would be invisible).
  // Linked even without a number — it used to drop the link silently.
  const handleSelectContact = useCallback((c) => {
    setContactId(c.id ?? null);
    // Contacts hand back "+91 98765 43210" — normalise to the local 10 digits.
    setPhone(c.phones?.length ? normalizePhone(c.phones[0]) : '');
    if (c.name) setPerson(c.name);
    setPersonChosen(true);
    clearErr('person');
    setContactSheetVisible(false);
  }, [clearErr]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const n = parseFloat(amount);
    // Flag every bad field at once, so fixing one doesn't just reveal the next.
    const badPerson   = !person.trim();
    const amountBlank = !amount.trim();
    const badAmount   = !n || n <= 0;
    const tooLarge    = !badAmount && n > MAX_ALLOWED_AMOUNT;
    if (badPerson || badAmount || tooLarge) {
      // One short, imperative line UNDER each bad field (the app's form pattern —
      // Goal / Account forms), naming what to DO; each case distinct, because
      // "check your details" makes the user re-examine input that was fine.
      setFormErr({
        person: badPerson ? 'Add a name' : null,
        amount: tooLarge ? `Amount can't exceed ${formatCompact(MAX_ALLOWED_AMOUNT)}`
          : amountBlank ? 'Add an amount'
          : badAmount ? 'Amount must be more than ₹0'
          : null,
      });
      return;
    }
    setFormErr(null);
    submit(() => onSubmit({
      person: person.trim(),
      amount: n,
      date: date.toISOString(),
      note: note.trim(),
      contactId: contactId ?? null,
      phone: phone.trim() || null,
      kind,
      alreadySettled,
      accountId: selectedAccount?.id ?? null,
    }));
    // Clear for the next entry. The form owns its fields, so this has to happen
    // here: the inline panel shell stays mounted after a commit and would otherwise
    // keep the last entry on screen. (The sheet shell unmounts, so it's moot there.)
    // A locked person is a property of the shell, not the entry — keep it seeded.
    setAmount('');
    setNote('');
    setDate(new Date());
    setAlreadySettled(false);
    setAccountId(undefined);
    setAccountsOpen(false);
    setNoteOpen(false);
    setPersonChosen(false);
    if (!locked) {
      setPerson('');
      setPhone('');
      setContactId(null);
    }
  }, [person, amount, date, note, contactId, phone, kind, alreadySettled, onSubmit, locked, submit, selectedAccount]);

  // Chip + heading use the app's own words (ENTRY_LABEL: Received back / Repaid),
  // kept short so the heading and the chip fit one line together.
  const settledChipLabel = kind === 'lent' ? 'Already Received' : 'Already Repaid';
  const heading = alreadySettled
    ? (kind === 'lent' ? 'Received back' : 'Repaid')
    : (kind === 'lent' ? 'Lend to someone' : 'Borrow from someone');
  const entryKind = lbEffectiveKind(kind, alreadySettled);

  return (
    <View style={[styles.formCard, style]}>
      <View style={styles.formHeaderRow}>
        {hideHeading ? (
          <View style={styles.formTitleInline} />
        ) : (
          <Text style={[styles.formTitle, styles.formTitleInline]} numberOfLines={1}>{heading}</Text>
        )}
        {/* Toggle: log straight into the existing Lent Settled / Borrow Repaid
            categories instead of an open 'lent'/'borrowed' entry you'd have to
            Settle separately later. */}
        <TouchableOpacity
          style={[
            styles.settledChip,
            alreadySettled && { backgroundColor: theme.primary + '14', borderColor: theme.primary + '55' },
          ]}
          onPress={() => setAlreadySettled((v) => !v)}
          activeOpacity={0.75}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: alreadySettled }}
        >
          <View
            style={[
              styles.settledBox,
              alreadySettled && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}
          >
            {alreadySettled ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
          </View>
          <Text style={[styles.settledChipText, alreadySettled && { color: theme.primary }]}>
            {settledChipLabel}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Direction first — it decides what the amount MEANS, so asking after the
          number would be back to front. Only when the shell can't imply it. */}
      {onKindChange ? (
        <FormChipRow style={styles.kindRow}>
          <FormChip
            label="I Lent"
            icon={<Ionicons name="arrow-up-right-box-outline" size={15} color={kind === 'lent' ? theme.primary : colors.textSecondary} />}
            active={kind === 'lent'}
            onPress={() => onKindChange('lent')}
            accentColor={theme.primary}
          />
          <FormChip
            label="I Borrowed"
            icon={<Ionicons name="arrow-down-left-box-outline" size={15} color={kind === 'borrowed' ? theme.primary : colors.textSecondary} />}
            active={kind === 'borrowed'}
            onPress={() => onKindChange('borrowed')}
            accentColor={theme.primary}
          />
        </FormChipRow>
      ) : null}

      {/* Person + contact link — hidden when the shell already knows who this is
          (you can't retarget an entry from inside their own ledger). No phone field:
          the number comes from the picked contact, never typed. */}
      {locked ? null : (
        <>
          <View style={styles.personRow}>
            <TextInput
              value={person}
              onChangeText={(t) => {
                setPerson(sanitizeName(t));
                setPersonChosen(false);
                // Clear as soon as they start fixing it — a red border that outlives
                // the problem trains people to ignore red borders.
                clearErr('person');
              }}
              placeholder="Person name"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.personInput, formErr?.person && styles.inputError]}
              maxLength={INPUT_LIMITS.NAME_MAX}
            />
            {/* Gray at rest, accent wash once a contact is linked. (The date button
                beside the amount deliberately does NOT wash — a date always holds a
                value, so a fill there would be permanent noise; a linked contact is
                a real off/on state worth showing.) */}
            <TouchableOpacity
              style={[styles.contactPickBtn, contactId && { backgroundColor: theme.primary + '1F' }]}
              onPress={pickContact}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Pick a contact"
            >
              <ContactPickIcon size={19} color={theme.primary} />
            </TouchableOpacity>
          </View>
          {formErr?.person ? <Text style={styles.fieldErr}>{formErr.person}</Text> : null}
          {/* People already on the ledger — pick one to file under THEM (contact +
              number come along), instead of starting a duplicate by retyping. */}
          {suggestions.length ? (
            <View style={styles.suggestBox}>
              {suggestions.map((p, i) => (
                <TouchableOpacity
                  key={p.personKey}
                  style={[styles.suggestRow, i > 0 && styles.suggestDivider]}
                  onPress={() => pickSuggestion(p)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${titleCaseName(p.person)}`}
                >
                  <Text style={styles.suggestName} numberOfLines={1}>{titleCaseName(p.person)}</Text>
                  <Text style={styles.suggestMeta} numberOfLines={1}>
                    {p.net > 0 ? `owes you ${formatCurrency(p.net)}` : p.net < 0 ? `you owe ${formatCurrency(-p.net)}` : 'Settled'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </>
      )}

      {/* Amount + date. The calendar sits beside the amount (not on its own row)
          to keep this card compact; it always shows the date it will file under. */}
      <View style={styles.amountRow}>
        <TextInput
          value={amount}
          onChangeText={(t) => {
            setAmount(sanitizeAmount(t));
            clearErr('amount');
          }}
          keyboardType="decimal-pad"
          placeholder="Amount"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.amountInput, formErr?.amount && styles.inputError]}
          maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
        />
        <DateField
          value={date}
          onChange={setDate}
          maximumDate={new Date()}
          variant="icon"
          accentColor={theme.primary}
        />
      </View>
      {formErr?.amount ? <Text style={styles.fieldErr}>{formErr.amount}</Text> : null}

      {/* "+ Note" + account share one row. The note field only appears (below)
          once asked for — most quick adds skip it. The account is primary-preselected;
          tapping it opens the account picker sheet, which renders INSIDE this form — on
          LbPersonScreen it nests in the add sheet's own Modal, like DateField's iOS
          picker, never beside it (§8b). */}
      <View style={styles.amountRow}>
        {/* Toggles the note field below. Closing KEEPS the text (it still saves), so a
            written note shows here as a preview with the canonical pencil; + when there's
            none yet, − while open. Label grey like the placeholders; only the small icon
            carries the theme, like the contact / date icons. */}
        <TouchableOpacity
          style={styles.noteBtn}
          onPress={() => setNoteOpen((v) => !v)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={noteOpen ? 'Hide note' : note.trim() ? `Note: ${note.trim()}` : 'Add a note'}
        >
          {noteOpen
            ? <Ionicons name="remove-circle" size={18} color={theme.primary} />
            : note.trim()
              ? <EditIcon size={15} color={theme.primary} />
              : <Ionicons name="add-circle" size={18} color={theme.primary} />}
          <Text style={[styles.noteBtnText, !noteOpen && note.trim() && styles.noteBtnFilled]} numberOfLines={1}>
            {!noteOpen && note.trim() ? note.trim() : 'Note'}
          </Text>
        </TouchableOpacity>
        {liveAccounts.length ? (
          <TouchableOpacity
            style={styles.accountBtn}
            onPress={() => setAccountsOpen(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`${lbAccountFieldLabel(entryKind)}: ${selectedAccount?.name || LB_NO_ACCOUNT}`}
            accessibilityHint="Opens the account list"
          >
            {/* One line, no icon — the other fields are plain text too. */}
            <Text style={styles.accountText} numberOfLines={1}>
              <Text style={styles.accountLabel}>{lbAccountFieldLabel(entryKind)}  </Text>
              <Text style={styles.accountValue}>{selectedAccount?.name || 'No Account'}</Text>
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {noteOpen ? (
        <TextInput
          value={note}
          onChangeText={(t) => setNote(t.slice(0, INPUT_LIMITS.NOTE_MAX))}
          placeholder="Note"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={INPUT_LIMITS.NOTE_MAX}
          autoFocus
        />
      ) : null}
      <PrimaryButton
        title={submitLabel}
        onPress={handleSubmit}
        loading={submitting}
        variant={submitOutlined ? 'outline' : 'filled'}
        color={theme[kind]}
        style={{ marginTop: spacing.sm }}
      />

      <AccountPickerSheet
        visible={accountsOpen}
        title={lbMoneyOut(entryKind) ? 'Paid from which account?' : 'Received in which account?'}
        accounts={liveAccounts}
        selectedId={selectedAccount?.id}
        onSelect={(id) => { setAccountId(id); setAccountsOpen(false); }}
        skipLabel={LB_NO_ACCOUNT}
        onSkip={() => { setAccountId(null); setAccountsOpen(false); }}
        onClose={() => setAccountsOpen(false)}
      />

      <ContactPickerSheet
        visible={contactSheetVisible}
        onSelect={handleSelectContact}
        onClose={() => setContactSheetVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  formTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  formTitleInline: { flex: 1 },
  kindRow: { marginBottom: spacing.sm },
  // FILLED (gray, borderless) — deliberately NOT the outlined FormField treatment
  // the other add forms use. This form is a compact block inside a white card, so
  // the fill is what separates the inputs from the card; kept on purpose.
  // `DateField variant="icon"` matches it (that variant exists only for the LB forms).
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },
  // Validation state. `input` is a borderless fill, so the error border needs its
  // own width — a borderColor alone would render nothing.
  inputError: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  // Suggestions under the name — a light white list on the grey-filled form, so it
  // reads as options for that field rather than another input.
  suggestBox: {
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  suggestDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  // Softer than typed text — options, not entered values.
  suggestName: { ...typography.body, color: colors.textSecondary, fontWeight: '500', flexShrink: 1 },
  suggestMeta: { ...typography.small, color: colors.textMuted },
  // Under its field, like GoalForm / AccountForm's `err` — tucked up into the row's
  // own bottom gap so it reads as that field's, not the next one's.
  fieldErr: {
    ...typography.tiny,
    color: colors.danger,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  // gap is `sm`, not `xs`: the input and its trailing square button share the same
  // grey fill, so at 4px they merged into one block that read as a single field —
  // especially once the date button grew from icon-only to icon + date text.
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  personInput: {
    flex: 1,
    marginBottom: 0,
  },
  // Must stay pixel-identical to `DateField`'s `iconBtn`: these are the form's two
  // square trailing buttons and any mismatch reads as a misalignment.
  contactPickBtn: {
    minWidth: 48,
    // Matches iconBtn's alignSelf so both trailing buttons take their height from
    // the input they sit beside, rather than from their own (differing) content.
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same gap as personRow above — these two rows are the form's matched pair.
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  amountInput: {
    flex: 1,
    marginBottom: 0,
  },
  // "Already settled" chip — front-of-form toggle beside the title.
  settledChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    flexShrink: 0,
  },
  settledBox: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settledChipText: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  // "+ Note" — sized to its label; the account beside it takes the rest of the
  // row, since a long account name is what needs the room.
  noteBtn: {
    maxWidth: '45%', // a note preview mustn't squeeze the account out
    alignSelf: 'stretch',
    minHeight: BUTTON_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  noteBtnText: { ...typography.body, color: colors.textMuted, flexShrink: 1 },
  noteBtnFilled: { color: colors.textPrimary },
  // Account button beside "+ Note" — same filled box + height, one line
  // "Paid From  HDFC ··1111" so the direction stays named.
  accountBtn: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  accountText: { flex: 1 }, // fills the button, so the chevron sits at its right edge
  accountLabel: { ...typography.small, color: colors.textMuted, fontWeight: '500' },
  accountValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
});

export default LbEntryForm;
