// =============================================================================
// AccountField — the compact "Account" row shared by every add/edit form.
// Shows the chosen account (primary by default) and opens AccountPickerSheet on
// tap, instead of rendering one chip per account.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FormValueRow } from './FormField';
import { colors, spacing } from '../constants/theme';
import AccountPickerSheetBase from './AccountPickerSheet';

// AccountPickerSheet.js has no TS declarations — its optional props read as required.
const AccountPickerSheet = AccountPickerSheetBase as React.FC<any>;

interface AccountFieldProps {
  accounts: any[];
  /** Selected account id (already resolved to the default by the caller). */
  value: string | null;
  onChange: (id: string | null) => void;
  accentColor?: string;
  disabled?: boolean;
  /** Allows "no account": shown when `value` is null and offered in the picker. */
  noneLabel?: string;
  /** No live accounts: an "Account · Add" row instead of nothing, ✕ stops offering it.
   *  Accounts are optional — this only offers one, it never blocks. */
  emptyOffer?: { onAdd: () => void; onDismiss: () => void };
}

export default function AccountField({ accounts, value, onChange, accentColor, disabled, noneLabel, emptyOffer }: AccountFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value) ?? null;
  if (emptyOffer && !accounts.some((a) => !a.archived)) {
    return (
      <View style={styles.offerRow}>
        <View style={styles.offerMain}>
          <FormValueRow
            icon="wallet-outline"
            label="Account"
            value="Add"
            isPlaceholder
            accentColor={accentColor}
            onPress={emptyOffer.onAdd}
            trailingIcon={null}
          />
        </View>
        <TouchableOpacity
          style={styles.offerClose}
          onPress={emptyOffer.onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Don't show this again"
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  }
  if (!selected && !noneLabel) return null;

  return (
    <>
      <FormValueRow
        icon="wallet-outline"
        label="Account"
        value={selected ? selected.name : noneLabel!}
        isPlaceholder={!selected}
        badge={selected?.primary ? 'Primary' : undefined}
        accentColor={accentColor}
        disabled={disabled}
        onPress={accounts.length > (noneLabel ? 0 : 1) ? () => setOpen(true) : undefined}
      />
      <AccountPickerSheet
        visible={open}
        title="Select Account"
        accounts={accounts.filter((a) => !a.archived || a.id === value)}
        selectedId={value}
        // Entry forms can be filled in with someone looking over the shoulder.
        showBalance={false}
        onSelect={(id: string) => {
          onChange(id);
          setOpen(false);
        }}
        skipLabel={noneLabel}
        onSkip={noneLabel ? () => { onChange(null); setOpen(false); } : undefined}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  offerRow: { flexDirection: 'row', alignItems: 'center' },
  offerMain: { flex: 1 },
  offerClose: { paddingRight: spacing.md, alignSelf: 'stretch', justifyContent: 'center' },
});
