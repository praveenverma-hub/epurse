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
// reports one shape upward via onSubmit and holds no store dependency, so both
// shells stay free to commit it differently (the LB tab routes an already-repaid
// borrow through an account picker first).
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
  normalizePhone,
  sanitizeAmount,
} from '../utils/validation';
import { formatCompact } from '../utils/format';
import GradientButton from './GradientButton';
import CenterModal from './CenterModal';
import SheetCloseButton from './SheetCloseButton';
import DateField from './DateField';
import { FormChipRow, FormChip } from './FormField';

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
 * @param onSubmit       (entry) => void, entry =
 *                       { person, phone, contactId, amount, date, note, kind, alreadySettled }.
 *                       Only called once the form has validated.
 * @param hideHeading    Suppress the form's own title (the shell already has one).
 *                       The "already settled" toggle stays either way.
 */
const LbEntryForm = ({
  kind,
  onKindChange,
  lockedPerson = null,
  onSubmit,
  theme,
  submitColors,
  submitLabel = 'Add',
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
  const [formErr, setFormErr] = useState(null); // { person?, amount?, text }
  const [confirm, setConfirm] = useState(null);

  // ── Contact picker ─────────────────────────────────────────────────────────
  // Lives here, not in a shell: linking a contact to the person you're naming is
  // this form's own concern, and only the unlocked shell ever shows it.
  const [contactSheetVisible, setContactSheetVisible] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [allContacts, setAllContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const pickContact = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      setConfirm({
        title: 'Permission needed',
        message: 'Allow contacts access so you can pick a phone number from your list.',
        primaryText: 'OK',
      });
      return;
    }
    setContactQuery('');
    setContactSheetVisible(true);
    setContactsLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      setAllContacts(data.filter((c) => c.name && c.phoneNumbers?.length > 0));
    } catch {
      // permission revoked mid-flow or contacts unavailable
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const base = q
      ? allContacts.filter(
          (c) =>
            c.name?.toLowerCase().includes(q) ||
            c.phoneNumbers?.some((p) => p.number?.includes(q)),
        )
      : allContacts;
    return base.slice(0, 60);
  }, [allContacts, contactQuery]);

  const handleSelectContact = useCallback((c) => {
    if (c.phoneNumbers?.length) {
      // Contacts hand back "+91 98765 43210" — normalise to the local 10 digits or
      // the field's maxLength would clip the tail off the real number.
      setPhone(normalizePhone(c.phoneNumbers[0].number));
      setContactId(c.id ?? null);
    }
    if (!person.trim() && c.name) setPerson(c.name);
    setContactSheetVisible(false);
  }, [person]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const n = parseFloat(amount);
    // Flag every bad field at once, so fixing one doesn't just reveal the next.
    const badPerson   = !person.trim();
    const amountBlank = !amount.trim();
    const badAmount   = !n || n <= 0;
    const tooLarge    = !badAmount && n > MAX_ALLOWED_AMOUNT;
    if (badPerson || badAmount || tooLarge) {
      // One short, imperative line that names what to DO. The red borders already
      // point at the field, so the text adds the instruction, not a restatement —
      // and each case is distinct, because "check your details" makes the user
      // re-examine input that was fine.
      let text;
      if (tooLarge) text = `Amount can't exceed ${formatCompact(MAX_ALLOWED_AMOUNT)}`;
      else if (badPerson && badAmount) text = 'Add a name and an amount';
      else if (badPerson) text = 'Add a name';
      else if (amountBlank) text = 'Add an amount';
      else text = 'Amount must be more than ₹0';
      setFormErr({ person: badPerson, amount: badAmount || tooLarge, text });
      return;
    }
    setFormErr(null);
    onSubmit({
      person: person.trim(),
      amount: n,
      date: date.toISOString(),
      note: note.trim(),
      contactId: contactId ?? null,
      phone: phone.trim() || null,
      kind,
      alreadySettled,
    });
    // Clear for the next entry. The form owns its fields, so this has to happen
    // here: the inline panel shell stays mounted after a commit and would otherwise
    // keep the last entry on screen. (The sheet shell unmounts, so it's moot there.)
    // A locked person is a property of the shell, not the entry — keep it seeded.
    setAmount('');
    setNote('');
    setDate(new Date());
    setAlreadySettled(false);
    if (!locked) {
      setPerson('');
      setPhone('');
      setContactId(null);
    }
  }, [person, amount, date, note, contactId, phone, kind, alreadySettled, onSubmit, locked]);

  // Heading + chip reflect the resulting category when "already settled" is on:
  // lent → Lent Settled, borrowed → Borrow Repaid.
  const settledChipLabel = kind === 'lent' ? 'as Lent settled' : 'as Borrow repaid';
  // Both headings are verb-first and parallel ("Lend to someone" / "Borrow from
  // someone"), matching LinkContactModal's "Who did you lend to?" / "…borrow from?".
  const heading = alreadySettled
    ? (kind === 'lent' ? 'Lent settled' : 'Borrow repaid')
    : (kind === 'lent' ? 'Lend to someone' : 'Borrow from someone');

  return (
    <View style={[styles.formCard, style]}>
      <View style={styles.formHeaderRow}>
        {hideHeading ? (
          <View style={styles.formTitleInline} />
        ) : (
          <Text style={[styles.formTitle, styles.formTitleInline]}>{heading}</Text>
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
            label="↑ I lent"
            active={kind === 'lent'}
            onPress={() => onKindChange('lent')}
            accentColor={theme.primary}
          />
          <FormChip
            label="↓ I borrowed"
            active={kind === 'borrowed'}
            onPress={() => onKindChange('borrowed')}
            accentColor={theme.primary}
          />
        </FormChipRow>
      ) : null}

      {/* Person + phone + contact link — hidden when the shell already knows who
          this is (you can't retarget an entry from inside their own ledger). */}
      {locked ? null : (
        <>
          <View style={styles.phoneRow}>
            <TextInput
              value={phone}
              onChangeText={(t) => { setPhone(sanitizePhone(t)); setContactId(null); }}
              placeholder="Phone number (optional)"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              style={[styles.input, styles.phoneInput]}
              maxLength={INPUT_LIMITS.PHONE_LEN}
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
          <TextInput
            value={person}
            onChangeText={(t) => {
              setPerson(sanitizeName(t));
              // Clear as soon as they start fixing it — a red border that outlives
              // the problem trains people to ignore red borders.
              if (formErr?.person) setFormErr(null);
            }}
            placeholder="Person name *"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, formErr?.person && styles.inputError]}
            maxLength={INPUT_LIMITS.NAME_MAX}
          />
        </>
      )}

      {/* Amount + date. The calendar sits beside the amount (not on its own row)
          to keep this card compact; it always shows the date it will file under. */}
      <View style={styles.amountRow}>
        <TextInput
          value={amount}
          onChangeText={(t) => {
            setAmount(sanitizeAmount(t));
            if (formErr?.amount) setFormErr(null);
          }}
          keyboardType="decimal-pad"
          placeholder="Amount *"
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
      <TextInput
        value={note}
        onChangeText={(t) => setNote(t.slice(0, INPUT_LIMITS.NOTE_MAX))}
        placeholder="Note (optional)"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={INPUT_LIMITS.NOTE_MAX}
      />
      {formErr ? <Text style={styles.formErrText}>{formErr.text}</Text> : null}
      <GradientButton
        title={submitLabel}
        onPress={handleSubmit}
        colors={submitColors}
        style={{ marginTop: spacing.sm }}
      />

      {/* ── Contact search sheet ── */}
      <Modal
        visible={contactSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setContactSheetVisible(false)}
      >
        <View style={styles.contactBackdrop}>
          <TouchableOpacity
            style={styles.contactDismiss}
            activeOpacity={1}
            onPress={() => setContactSheetVisible(false)}
          />
          <View style={styles.contactSheet}>
            <SheetCloseButton onPress={() => setContactSheetVisible(false)} variant="absolute" />
            <View style={styles.contactHandle} />
            <Text style={styles.contactTitle}>Pick a contact</Text>
            <TextInput
              autoFocus
              value={contactQuery}
              onChangeText={setContactQuery}
              placeholder="Search name or number…"
              placeholderTextColor={colors.textMuted}
              style={styles.contactSearch}
            />
            {contactsLoading ? (
              <ActivityIndicator style={{ marginVertical: 32 }} color={theme.primary} />
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                style={styles.contactList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => handleSelectContact(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactPhone}>{item.phoneNumbers[0].number}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.contactEmpty}>No contacts found.</Text>}
              />
            )}
          </View>
        </View>
      </Modal>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        onPrimary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
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
  formErrText: {
    ...typography.small,
    color: colors.danger,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  // gap is `sm`, not `xs`: the input and its trailing square button share the same
  // grey fill, so at 4px they merged into one block that read as a single field —
  // especially once the date button grew from icon-only to icon + date text.
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  phoneInput: {
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
  // Same gap as phoneRow above — these two rows are the form's matched pair.
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

  // ── Contact search sheet ──
  contactBackdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  contactDismiss: { flex: 1 },
  contactSheet: {
    backgroundColor:      colors.card,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingHorizontal:    20,
    paddingBottom:        32,
    maxHeight:            '75%',
  },
  contactHandle: {
    width:           36,
    height:          4,
    borderRadius:    2,
    backgroundColor: colors.divider,
    alignSelf:       'center',
    marginTop:       10,
    marginBottom:    14,
  },
  contactTitle: {
    ...typography.h2,
    fontWeight:   '700',
    color:        colors.textPrimary,
    marginBottom: spacing.sm,
  },
  contactSearch: {
    ...typography.body,
    color:           colors.textPrimary,
    borderWidth:     1.5,
    borderColor:     colors.divider,
    borderRadius:    radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   10,
    marginBottom:    spacing.sm,
    backgroundColor: colors.background,
  },
  contactList: { maxHeight: 380 },
  contactRow: {
    paddingVertical:   12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  contactName: {
    ...typography.bodyBold,
    fontWeight: '600',
    color:      colors.textPrimary,
  },
  contactPhone: {
    ...typography.small,
    color:     colors.textSecondary,
    marginTop: 2,
  },
  contactEmpty: {
    ...typography.body,
    color:     colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

export default LbEntryForm;
