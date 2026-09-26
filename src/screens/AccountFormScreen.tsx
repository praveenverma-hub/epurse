// =============================================================================
// AccountFormScreen — the ONE add/edit screen for accounts.
//
// Replaces two bottom sheets: AddAccountModal (create) and ManageAccountModal
// (rename / type change / read-only details / delete). Single pushed screen,
// optional `route.params?.accountId` decides add vs edit — same convention as
// AddTransactionScreen (`editTxnId`) and GoalFormScreen/ReminderFormScreen
// (optional id param). A pushed screen (not a Modal) so its own confirm
// dialogs are never a second stacked native Modal — the exact bug that made
// GoalFormScreen a pushed screen in the first place (see its own header note).
//
// Bank/wallet name + last-4 mask are only COLLECTED at creation, same as
// before — there was no existing action to edit them post-creation, and nothing
// asked for one here. Rename, type change (with confirm, since it resets CC
// balance tracking), primary/include-in-net-worth, and (Credit Card only)
// credit limit / billing day / due day / minimum due are all editable in
// EDIT mode via the new account-revamp store actions.
//
// ── ADD flow for a Credit Card is TWO screens (Sep-2026) ────────────────────
// This screen collects type/bank/mask/name/primary/net-worth as usual, but for
// a NEW Credit Card it does NOT create the account itself — its "Next" button
// hands the collected fields to `AccountCreditCardStepScreen`, which asks for
// the (all-optional) credit limit/billing day/due day/minimum due with a
// Skip-or-Add-Account choice, and is the one that actually calls `addAccount`.
// EDIT mode is unaffected — an existing Credit Card keeps all of this on ONE
// screen, exactly as before (the CC card renders inline, gated on `isEdit`).
//
// Route params:
//   accountId — editing an existing account instead of creating one (optional)
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, shadows, typography as typographyBase, BUTTON_H } from '../constants/theme';
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_EMOJI, ACCOUNT_TYPE_LABEL,
  ACCOUNT_NEEDS_MASK, ACCOUNT_NEEDS_BANK,
} from '../constants/categories';
import { BANK_GRADIENTS as BANK_GRADIENTS_RAW, BANK_GRADIENT_KEYS } from '../constants/accountCardColors';
const BANK_GRADIENTS = BANK_GRADIENTS_RAW as unknown as Record<string, [string, string]>;
import { INPUT_LIMITS, sanitizeName, isValidName, sanitizeAmount, parseAmount, sanitizeDay } from '../utils/validation';
import { validateCardDetails } from '../utils/ccStatement';
import { paymentGapDays, isUnusualPaymentGap } from '../utils/dueDate';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import { FormField, FormAmountInput } from '../components/FormField';
import AppSwitch from '../components/AppSwitch';
import CenterModal from '../components/CenterModal';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from '../components/Toast';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const TYPE_ORDER = [
  ACCOUNT_TYPES.CASH,
  ACCOUNT_TYPES.WALLET,
  ACCOUNT_TYPES.DEBIT_CARD,
  ACCOUNT_TYPES.CREDIT_CARD,
  ACCOUNT_TYPES.BANK,
];

const AccountFormScreen = ({ navigation, route }: any) => {
  const theme = useTheme();
  const toast = useToast();
  const { submit, submitting } = useSubmitGuard();

  const accountId: string | undefined = route?.params?.accountId;
  const accounts = useEPurseStore((s: any) => s.accounts);
  const account = useMemo(
    () => (accountId ? accounts.find((a: any) => a.id === accountId) : null),
    [accountId, accounts],
  );
  const isEdit = !!account;

  const addAccount            = useEPurseStore((s: any) => s.addAccount);
  const renameAccount         = useEPurseStore((s: any) => s.renameAccount);
  const setAccountType        = useEPurseStore((s: any) => s.setAccountType);
  const deleteAccount         = useEPurseStore((s: any) => s.deleteAccount);
  const archiveAccount        = useEPurseStore((s: any) => s.archiveAccount);
  const unarchiveAccount      = useEPurseStore((s: any) => s.unarchiveAccount);
  const setPrimaryAccount     = useEPurseStore((s: any) => s.setPrimaryAccount);
  const setIncludeInNetWorth  = useEPurseStore((s: any) => s.setIncludeInNetWorth);
  const setAccountColorKey    = useEPurseStore((s: any) => s.setAccountColorKey);
  const setCreditLimit        = useEPurseStore((s: any) => s.setCreditLimit);
  const setMinimumDue         = useEPurseStore((s: any) => s.setMinimumDue);
  const setAccountCycleDates  = useEPurseStore((s: any) => s.setAccountCycleDates);

  const [typeDraft, setTypeDraft]   = useState<string>(account?.type ?? ACCOUNT_TYPES.BANK);
  // ADD mode: optional, auto-generated from bank+mask when left blank (same
  // behaviour AddAccountModal always had). EDIT mode: the account's real name,
  // required — matches ManageAccountModal.
  const [customName, setCustomName] = useState(isEdit ? (account?.name ?? '') : '');
  const [bankName, setBankName]     = useState(account?.bankName ?? '');
  const [mask, setMask]             = useState(account?.mask ?? '');
  // ADD mode: the store guarantees exactly one active account is `primary`
  // whenever any exists (see `ensurePrimary` in ePurseStore.js), so the very
  // FIRST account will become primary regardless — default the toggle ON here
  // so the switch doesn't lie about what's about to happen.
  const hasActivePrimary = accounts.some((a: any) => a.primary && !a.archived);
  const [primaryDraft, setPrimaryDraft] = useState(isEdit ? !!account?.primary : !hasActivePrimary);
  const [includeDraft, setIncludeDraft] = useState(account?.includeInNetWorth ?? true);
  const [colorKeyDraft, setColorKeyDraft] = useState<string | null>(account?.colorKey ?? null);
  const [creditLimit, setCreditLimitText]   = useState(account?.creditLimit != null ? String(account.creditLimit) : '');
  const [minimumDue, setMinimumDueText]     = useState(account?.minimumDue != null ? String(account.minimumDue) : '');
  const [statementDay, setStatementDayText] = useState(account?.statementDay != null ? String(account.statementDay) : '');
  const [dueDay, setDueDayText]             = useState(account?.dueDay != null ? String(account.dueDay) : '');

  const [confirmTypeChange, setConfirmTypeChange] = useState(false);
  const [confirmArchive, setConfirmArchive]       = useState(false);
  const [confirmDelete, setConfirmDelete]         = useState(false);

  const needsMask = ACCOUNT_NEEDS_MASK.has(typeDraft);
  const needsBank = ACCOUNT_NEEDS_BANK.has(typeDraft);
  const isCC      = typeDraft === ACCOUNT_TYPES.CREDIT_CARD;
  const typeChanged = isEdit && typeDraft !== account.type;

  const nameValid = isEdit ? isValidName(customName) : true;

  const computedAddName = () => {
    const custom = customName.trim();
    if (custom) return custom;
    if (typeDraft === ACCOUNT_TYPES.CASH) return 'Cash';
    if (mask) return `${bankName.trim() || typeDraft} ··${mask}`;
    return bankName.trim() || typeDraft;
  };

  const applyCreditCardFields = (id: string) => {
    const limitVal = creditLimit ? parseAmount(creditLimit) : null;
    if (limitVal !== (account?.creditLimit ?? null)) setCreditLimit(id, limitVal);
    const minDueVal = minimumDue ? parseAmount(minimumDue) : null;
    if (minDueVal !== (account?.minimumDue ?? null)) setMinimumDue(id, minDueVal);
    const sDay = statementDay ? parseInt(statementDay, 10) : undefined;
    const dDay = dueDay ? parseInt(dueDay, 10) : undefined;
    if (sDay !== account?.statementDay || dDay !== account?.dueDay) {
      setAccountCycleDates(id, { statementDay: sDay, dueDay: dDay });
    }
  };

  const commitEditScalars = () => {
    if (primaryDraft !== !!account.primary) setPrimaryAccount(primaryDraft ? account.id : null);
    if (includeDraft !== (account.includeInNetWorth ?? true)) setIncludeInNetWorth(account.id, includeDraft);
    if (colorKeyDraft !== (account.colorKey ?? null)) setAccountColorKey(account.id, colorKeyDraft);
    if (isCC) applyCreditCardFields(account.id);
  };

  // Warn (never block) when the typed billing → due days put the due date an
  // unusual distance after the statement — usually a mistyped day.
  const gapDays = isCC ? paymentGapDays(parseInt(statementDay, 10) || null, parseInt(dueDay, 10) || null) : null;
  const gapUnusual = isUnusualPaymentGap(gapDays);

  const handleSave = () => {
    if (isEdit) {
      if (!nameValid) return;
      if (isCC) {
        const problem = validateCardDetails({
          creditLimit: creditLimit ? parseAmount(creditLimit) : null,
          minimumDue: minimumDue ? parseAmount(minimumDue) : null,
          statementBalance: account.statementBalance ?? null,
        });
        if (problem) { toast.warning('Check card details', problem); return; }
      }
      const trimmedName = customName.trim();
      if (trimmedName !== account.name) renameAccount(account.id, trimmedName);

      if (typeChanged) {
        setConfirmTypeChange(true);
        return;
      }
      commitEditScalars();
      navigation.goBack();
      return;
    }

    // ADD mode validation — mirrors AddAccountModal.
    if (needsMask && mask.length !== 4) {
      toast.warning('Missing info', 'Please enter the last 4 digits of your card/account.');
      return;
    }
    if (needsBank && !bankName.trim() && !customName.trim()) {
      toast.warning('Missing info', 'Please enter a bank or wallet name.');
      return;
    }

    const baseFields = {
      type: typeDraft,
      name: computedAddName(),
      bankName: bankName.trim() || null,
      mask: mask || '',
      includeInNetWorth: includeDraft,
      primary: primaryDraft,
      colorKey: colorKeyDraft,
    };

    // A new Credit Card hands off to its own step for the (all-optional) limit/
    // billing-day/due-day/minimum-due fields — this screen does not create the
    // account itself in that case (see the header note).
    if (isCC) {
      navigation.navigate('AccountCreditCardStep', baseFields);
      return;
    }

    submit(() => {
      const newId = addAccount(baseFields);
      if (primaryDraft) setPrimaryAccount(newId);
      navigation.goBack();
    });
  };

  const handleConfirmTypeChange = () => {
    setAccountType(account.id, typeDraft);
    commitEditScalars();
    setConfirmTypeChange(false);
    navigation.goBack();
  };

  const linkedMasks = account?.aliasMasks || [];
  // Read-only bank/mask/linked-card reference lines — Bank/Cash/Debit/Wallet only.
  // A Credit Card's Card Details section does NOT repeat this (removed after it
  // showed as a confusing duplicate line sitting above Credit Limit — the
  // editable Account Name field right above already names the same account).
  const hasLinkInfo = isEdit && !!(account.bankName || account.mask || linkedMasks.length > 0);
  const hasReadOnlyDetails = hasLinkInfo && !isCC;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.root, { backgroundColor: theme.card }]} edges={['top']}>
        <PlainScreenHeader
          title={isEdit ? 'Edit Account' : 'Add Account'}
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          bordered
          surfaceColor={theme.card}
          dividerColor={theme.divider}
        />

        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── type ───────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Account Type</Text>
          <View style={styles.typeGrid}>
            {TYPE_ORDER.map((t) => {
              const isSelected = typeDraft === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeChip,
                    { borderColor: theme.divider },
                    isSelected && { backgroundColor: theme.primary + '18', borderColor: theme.primary },
                  ]}
                  onPress={() => { hapticLight(); setTypeDraft(t); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.typeEmoji}>{ACCOUNT_TYPE_EMOJI[t]}</Text>
                  <Text
                    style={[
                      styles.typeLabel,
                      { color: theme.textPrimary },
                      isSelected && { color: theme.primary, fontWeight: '700' },
                    ]}
                  >
                    {ACCOUNT_TYPE_LABEL[t]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── bank/wallet name + mask — creation only ───────────────── */}
          {!isEdit && needsBank ? (
            <FormField label={typeDraft === ACCOUNT_TYPES.WALLET ? 'Wallet / Provider Name' : 'Bank Name'}>
              <TextInput
                value={bankName}
                onChangeText={setBankName}
                placeholder={typeDraft === ACCOUNT_TYPES.WALLET ? 'e.g. Paytm, PhonePe' : 'e.g. HDFC, ICICI, SBI'}
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                autoCapitalize="characters"
              />
            </FormField>
          ) : null}

          {!isEdit && needsMask ? (
            <FormField label="Last 4 Digits">
              <TextInput
                value={mask}
                onChangeText={(v) => setMask(v.replace(/\D/g, '').slice(0, 4))}
                placeholder="e.g. 4567"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                keyboardType="numeric"
                maxLength={4}
              />
            </FormField>
          ) : null}

          {/* ── name ───────────────────────────────────────────────────── */}
          <FormField label={isEdit ? 'Account Name' : 'Custom Name (optional)'}>
            <TextInput
              value={customName}
              onChangeText={(t) => setCustomName(sanitizeName(t))}
              placeholder={isEdit ? 'Account name' : 'Leave blank to auto-generate'}
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  color: theme.textPrimary,
                  borderColor: isEdit && !nameValid ? theme.danger : theme.inputBorder,
                },
              ]}
              maxLength={INPUT_LIMITS.NAME_MAX}
            />
          </FormField>
          {isEdit && !nameValid ? (
            <Text style={[styles.err, { color: theme.danger }]}>
              Give the account a name of at least {INPUT_LIMITS.NAME_MIN} characters.
            </Text>
          ) : null}

          {/* ── read-only details — edit mode only, non-CC ────────────── */}
          {hasReadOnlyDetails ? (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Account details</Text>
              <View style={[styles.detailsCard, { backgroundColor: theme.cardAlt || theme.background, borderColor: theme.divider }]}>
                {account.bankName || account.mask ? (
                  <Text style={[styles.detailLine, { color: theme.textPrimary }]}>
                    {account.bankName || account.type}
                    {account.mask ? `  ··${account.mask}` : ''}
                  </Text>
                ) : null}
                {linkedMasks.length > 0 ? (
                  <Text style={[styles.detailLine, { color: theme.textSecondary }]}>
                    {linkedMasks.length} card{linkedMasks.length > 1 ? 's' : ''} linked: {linkedMasks.map((m: string) => `··${m}`).join(', ')}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          {/* ── credit card only — ONE heading, one bordered card ───────── */}
          {/* EDIT mode only — a NEW Credit Card fills these in on the second
              step (AccountCreditCardStepScreen) instead, per the header note. */}
          {isCC && isEdit ? (
            <>
              {/* "optional" said ONCE here, in the subtitle — not repeated on
                  every field label below. No rule under it: the card border
                  right below is what closes the section, so a second line here
                  would be a redundant edge. */}
              <SectionHeader
                icon="card-outline"
                title="Card Details"
                subtitle="Optional — helps us track your available credit and remind you before payments are due."
                accentColor={theme.primary}
                style={styles.ccSectionHeader}
              />

              <View style={styles.ccCard}>
                <FormField label="Credit Limit">
                  <FormAmountInput
                    value={creditLimit}
                    onChangeText={(t) => setCreditLimitText(sanitizeAmount(t))}
                    placeholder="e.g. 100000"
                    compact
                    style={{ borderColor: theme.inputBorder, color: theme.textPrimary }}
                  />
                </FormField>
                <View style={styles.dayRow}>
                  <FormField label="Billing Day" style={styles.dayField}>
                    <TextInput
                      value={statementDay}
                      onChangeText={(t) => setStatementDayText(sanitizeDay(t))}
                      placeholder="1-31"
                      placeholderTextColor={theme.textMuted}
                      keyboardType="numeric"
                      maxLength={2}
                      style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                    />
                  </FormField>
                  <FormField label="Due Day" style={styles.dayField}>
                    <TextInput
                      value={dueDay}
                      onChangeText={(t) => setDueDayText(sanitizeDay(t))}
                      placeholder="1-31"
                      placeholderTextColor={theme.textMuted}
                      keyboardType="numeric"
                      maxLength={2}
                      style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                    />
                  </FormField>
                </View>
                {gapUnusual ? (
                  <Text style={[styles.gapHint, { color: theme.textSecondary }]}>
                    That's {gapDays} days from statement to due date — unusual, so worth a quick check.
                  </Text>
                ) : null}
                <FormField label="Minimum Due" style={styles.ccLastField}>
                  <FormAmountInput
                    value={minimumDue}
                    onChangeText={(t) => setMinimumDueText(sanitizeAmount(t))}
                    placeholder="e.g. 2500"
                    compact
                    style={{ borderColor: theme.inputBorder, color: theme.textPrimary }}
                  />
                </FormField>
              </View>
            </>
          ) : null}

          {/* ── card color — only AccountDetailsScreen's hero card reads this,
              the Accounts-tab carousel card keeps its own independent color. */}
          <SectionHeader
            icon="color-palette-outline"
            title="Card Color"
            subtitle="Optional — pick a look for this account's detail screen."
            accentColor={theme.primary}
            style={styles.ccSectionHeader}
          />
          <View style={styles.colorSwatchRow}>
            <TouchableOpacity
              style={[styles.colorDot, { backgroundColor: theme.cardAlt }, !colorKeyDraft && styles.colorDotSelected]}
              onPress={() => { hapticLight(); setColorKeyDraft(null); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Automatic color"
            >
              <Ionicons name="shuffle-outline" size={14} color={theme.textMuted} />
            </TouchableOpacity>
            {/* One flat shade per bank, not the full 2-stop gradient — simpler
                to scan as a picker. Same dot/ring/checkmark treatment as every
                other color picker in the app (Group/Category color rows). */}
            {BANK_GRADIENT_KEYS.map((key) => {
              const [shade] = BANK_GRADIENTS[key];
              const selected = colorKeyDraft === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.colorDot, { backgroundColor: shade }, selected && styles.colorDotSelected]}
                  onPress={() => { hapticLight(); setColorKeyDraft(key); }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${key} color`}
                >
                  {selected ? <Text style={styles.colorCheck}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── primary / net worth toggles ────────────────────────────── */}
          <View style={[styles.toggleRow, { borderTopColor: theme.divider }]}>
            <View style={styles.toggleMid}>
              <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>Primary account</Text>
              <Text style={[styles.toggleHint, { color: theme.textSecondary }]}>Your default account, shown first</Text>
            </View>
            <AppSwitch
              value={primaryDraft}
              onValueChange={setPrimaryDraft}
              trackColor={{ true: theme.primary, false: theme.divider }}
              thumbColor="#fff"
              ios_backgroundColor={theme.divider}
            />
          </View>
          <View style={[styles.toggleRow, { borderTopColor: theme.divider }]}>
            <View style={styles.toggleMid}>
              <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>Include in net worth</Text>
              <Text style={[styles.toggleHint, { color: theme.textSecondary }]}>Counts toward your total balance</Text>
            </View>
            <AppSwitch
              value={includeDraft}
              onValueChange={setIncludeDraft}
              trackColor={{ true: theme.primary, false: theme.divider }}
              thumbColor="#fff"
              ios_backgroundColor={theme.divider}
            />
          </View>
        </ScrollView>

        {/* Pinned footer — Archive/Unarchive + Delete ride beside Save in edit
            mode, same 1:1:flex layout GoalFormScreen uses for its own
            discontinue+delete+save trio. */}
        <View style={[styles.footer, { borderTopColor: theme.divider }]}>
          <View style={styles.footerRow}>
            {isEdit ? (
              <TouchableOpacity
                style={[styles.iconBtn, { borderColor: theme.inputBorder }]}
                onPress={() => {
                  hapticLight();
                  if (account.archived) unarchiveAccount(account.id);
                  else setConfirmArchive(true);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={account.archived ? 'Unarchive account' : 'Archive account'}
              >
                <Ionicons
                  name={account.archived ? 'refresh-outline' : 'archive-outline'}
                  size={19}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>
            ) : null}
            {isEdit ? (
              <TouchableOpacity
                style={[styles.iconBtn, { borderColor: theme.danger + '55' }]}
                onPress={() => { hapticLight(); setConfirmDelete(true); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Delete account"
              >
                <Ionicons name="trash-outline" size={19} color={theme.danger} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: (isEdit ? nameValid : true) ? theme.primary : theme.divider }]}
              onPress={handleSave}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={[styles.saveTxt, { color: (isEdit ? nameValid : true) ? '#fff' : theme.textMuted }]}>
                {isEdit ? 'Save changes' : isCC ? 'Next' : 'Add Account'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <CenterModal
        visible={confirmTypeChange}
        title="Change account type?"
        message={
          isEdit
            ? `Change "${account?.name}" from ${ACCOUNT_TYPE_LABEL[account?.type]} to `
              + `${ACCOUNT_TYPE_LABEL[typeDraft]}?`
              + (typeDraft === ACCOUNT_TYPES.CREDIT_CARD
                ? '\n\nIts balance tracking will reset — you\'ll need to confirm the outstanding amount again.'
                : '')
            : ''
        }
        primaryText="Save"
        secondaryText="Cancel"
        onSecondary={() => setConfirmTypeChange(false)}
        onClose={() => setConfirmTypeChange(false)}
        onPrimary={handleConfirmTypeChange}
      />

      <CenterModal
        visible={confirmArchive}
        title="Archive account?"
        message={`"${account?.name}" moves out of your active accounts. Its transactions and history stay untouched — unarchive any time.`}
        primaryText="Archive"
        secondaryText="Cancel"
        onSecondary={() => setConfirmArchive(false)}
        onClose={() => setConfirmArchive(false)}
        onPrimary={() => {
          archiveAccount(account.id);
          setConfirmArchive(false);
          navigation.goBack();
          toast.success('Account archived', account?.name);
        }}
      />

      <CenterModal
        visible={confirmDelete}
        title="Delete account?"
        message={`Delete "${account?.name}"?\n\nTransactions will be kept but unlinked.`}
        primaryText="Delete"
        destructive
        secondaryText="Cancel"
        onSecondary={() => setConfirmDelete(false)}
        onClose={() => setConfirmDelete(false)}
        onPrimary={() => {
          deleteAccount(account.id);
          setConfirmDelete(false);
          navigation.goBack();
          toast.success('Account deleted', account?.name);
        }}
      />
    </View>
  );
};

export default AccountFormScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },

  label: {
    ...typography.small,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },

  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    borderWidth: 1,
  },
  err: { ...typography.tiny, marginTop: -spacing.sm, marginBottom: spacing.sm },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeChip: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  typeEmoji: { fontSize: 18 },
  typeLabel: { ...typography.small, fontWeight: '600' },

  detailsCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  detailLine: { ...typography.small, lineHeight: 18 },

  // Extra top space sets this section header apart from the plain field above
  // it — no rule/border here, since the card right below (`ccCard`) is what
  // visually closes the section; a line here too would be a redundant edge.
  // SectionHeader's OWN subtitle carries a baked-in marginBottom: spacing.md
  // (12px, `components/SectionHeader.tsx`) — shared by every screen that
  // passes it a subtitle, so not something to change globally. The negative
  // marginBottom here claws most of that back for this ONE usage instead.
  ccSectionHeader: {
    marginTop: spacing.md,
    marginBottom: -spacing.sm,
  },
  // No border — matches AccountCreditCardStepScreen's own CC card, which lost
  // its border for the same reason: the section heading right above already
  // marks the boundary, a box under it is redundant chrome. No horizontal
  // padding either — with the border gone there's nothing left to pad away
  // from, and a leftover side inset just left Credit Limit/Billing Day/Due
  // Day/Minimum Due narrower than every other field on this screen (e.g.
  // Account Name), which only ever sits at the screen body's own gutter.
  ccCard: {
    paddingBottom: spacing.sm,
    marginBottom: spacing.lg,
  },
  // The card's own bottom padding already closes the gap — the field's usual
  // marginBottom would double up on top of that.
  ccLastField: { marginBottom: 0 },

  // Same dot/ring/checkmark picker as GroupFormScreen's/CategoriesScreen's own
  // color rows — one visual language for "pick a color" everywhere it appears.
  colorSwatchRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
    marginBottom: spacing.lg,
  },
  colorDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colorDotSelected: {
    borderWidth: 2, borderColor: '#fff',
    transform: [{ scale: 1.18 }],
    ...shadows.pop,
  },
  colorCheck: { color: '#fff', fontWeight: '900', fontSize: 15 },

  dayRow: { flexDirection: 'row', gap: spacing.md },
  // Sits under the day fields (their own marginBottom already spaces them).
  gapHint: { ...typography.tiny, marginTop: -spacing.sm, marginBottom: spacing.md },
  dayField: { flex: 1 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleMid: { flex: 1 },
  toggleLabel: { ...typography.body, fontWeight: '600' },
  toggleHint: { ...typography.tiny, marginTop: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: BUTTON_H,
    minHeight: BUTTON_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  saveBtn: {
    flex: 1,
    minHeight: BUTTON_H,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  saveTxt: { ...typography.bodyBold, fontWeight: '700', fontSize: 16 },
});
