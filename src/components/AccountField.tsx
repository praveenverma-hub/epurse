// =============================================================================
// AccountField — the compact "Account" row shared by every add/edit form.
// Shows the chosen account (primary by default) and opens AccountPickerSheet on
// tap, instead of rendering one chip per account.
// =============================================================================
import React, { useState } from 'react';
import { FormValueRow } from './FormField';
import AccountPickerSheetBase from './AccountPickerSheet';

// AccountPickerSheet.js has no TS declarations — its optional props read as required.
const AccountPickerSheet = AccountPickerSheetBase as React.FC<any>;

interface AccountFieldProps {
  accounts: any[];
  /** Selected account id (already resolved to the default by the caller). */
  value: string | null;
  onChange: (id: string) => void;
  accentColor?: string;
  disabled?: boolean;
}

export default function AccountField({ accounts, value, onChange, accentColor, disabled }: AccountFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value) ?? null;
  if (!selected) return null;

  return (
    <>
      <FormValueRow
        icon="wallet-outline"
        label="Account"
        value={selected.name}
        badge={selected.primary ? 'Primary' : undefined}
        accentColor={accentColor}
        disabled={disabled}
        onPress={accounts.length > 1 ? () => setOpen(true) : undefined}
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
        onClose={() => setOpen(false)}
      />
    </>
  );
}
