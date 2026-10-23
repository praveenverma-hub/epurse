// "Always for <payee>" — one row for both category sheets (Manage, Choose Category).
import React from 'react';
import { FormSwitchRow, FormValueCard } from './FormField';

export default function RememberPayeeRow({ name, value, onValueChange }: {
  name: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <FormValueCard>
      <FormSwitchRow
        icon="repeat-outline"
        label={`Always for ${name}`}
        hint="Next time, no need to pick it again."
        value={value}
        onValueChange={onValueChange}
      />
    </FormValueCard>
  );
}
