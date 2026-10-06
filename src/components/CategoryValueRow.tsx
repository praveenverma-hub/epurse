// =============================================================================
// CategoryValueRow — the Category row of the entry forms' value card. Shows the
// chosen parent's own emoji + colour (a category's emoji is data, not chrome),
// the child label, and the "Auto" badge when it was filled from the merchant.
// Shared by AddTransactionScreen and GroupExpenseForm so both look identical.
// =============================================================================
import React from 'react';
import { FormValueRow } from './FormField';
import { useCategoryTree } from '../hooks/useCategoryTree';

interface Props {
  parentCategory?: string | null;
  childCategory?: string | null;
  isAuto?: boolean;
  onPress: () => void;
  /** Used until a category is chosen. */
  accentColor: string;
}

export default function CategoryValueRow({ parentCategory, childCategory, isAuto, onPress, accentColor }: Props) {
  const tree = useCategoryTree();
  const parent = parentCategory ? tree.find((p) => p.label === parentCategory) : undefined;
  return (
    <FormValueRow
      leading={parent?.emoji ?? '📌'}
      label="Category"
      value={childCategory || 'Select'}
      badge={isAuto ? 'Auto' : undefined}
      isPlaceholder={!childCategory}
      accentColor={parent?.color ?? accentColor}
      onPress={onPress}
    />
  );
}
