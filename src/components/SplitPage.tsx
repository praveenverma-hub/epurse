// =============================================================================
// SplitPage — the ONE split editor page, used by the plain add form (as an
// in-screen overlay) and the group add form (inside a Modal). Header, Paid By,
// Method (Equal / Percent / Amount / Full Owed), People with their shares, the
// "left to allocate" line, and Done — all rendered here, so the two flows cannot
// drift. Presentational: callers own the state and map it to `rows`.
// =============================================================================
import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import KeyboardAvoidingView from './AppKeyboardAvoidingView';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography as typographyBase, DIVIDER_W } from '../constants/theme';
import { INPUT_LIMITS } from '../utils/validation';
import { formatCurrency } from '../utils/format';
import GradientButtonBase from './GradientButton';
import SplitTotalHint from './SplitTotalHint';
import { FormField, FormChipRow, FormChip, useFocusBorder } from './FormField';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
const GradientButton = GradientButtonBase as React.FC<{
  title: string; onPress: () => void; flat?: boolean; style?: object;
}>;

export type SplitMode = 'equal' | 'percent' | 'amount' | 'fullOwed';

/** One-line description of each method — the Split row's summary on both forms. */
export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  equal: 'Equally',
  percent: 'By percentage',
  amount: 'By amount',
  fullOwed: 'Full amount owed',
};

export interface SplitPageRow {
  id: string;
  name: string;
  isMe?: boolean;
  isPayer?: boolean;
  /** Current value in BOTH units; the page shows whichever `valueUnit` says. */
  percent: number;
  amount: number;
  /** Input enabled. When false the row shows its ₹ share as plain text. */
  editable: boolean;
  onChange?: (value: number) => void;
  /** Member tick (group equal mode: untick anyone not part of the expense). */
  checked?: boolean;
  onToggle?: () => void;
  /** Remove-from-split (plain flow: people are added/removed explicitly). */
  onRemove?: () => void;
}

interface PayerSpec {
  options: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** When set, the payer can't change — shown as this note instead of chips. */
  lockedNote?: string;
  /** Shown under the chips (e.g. "Rohit paid — your share becomes money you owe"). */
  memoNote?: string;
}

export interface SplitPageProps {
  title?: string;
  onBack: () => void;
  headerRight?: React.ReactNode;
  accentColor: string;

  /** Hidden when there are no people yet (plain flow's empty state). */
  payer?: PayerSpec;
  mode: SplitMode;
  onModeChange: (m: SplitMode) => void;
  /** What the inputs show/edit — independent of the active method chip. */
  valueUnit: 'percent' | 'amount';
  /** Whole bill in ₹. */
  total: number;
  rows: SplitPageRow[];
  /** Right side of the People heading (e.g. "Add Person"). */
  peopleAction?: React.ReactNode;
  /** Under the People card (e.g. the inline contact search). */
  peopleFooter?: React.ReactNode;

  /** Replaces the whole body (no people yet). Footer is hidden. */
  empty?: React.ReactNode;
  onDone: () => void;
}

/** A share input with the shared focus ring (one per row, so each tracks its own focus). */
function ShareInput({ style, ...rest }: React.ComponentProps<typeof TextInput>) {
  const focus = useFocusBorder();
  return <TextInput {...rest} style={[style, focus.focusStyle]} onFocus={focus.onFocus} onBlur={focus.onBlur} />;
}

const METHODS: { key: SplitMode; label: string }[] = [
  { key: 'equal', label: 'Equal' },
  { key: 'percent', label: '% Percent' },
  { key: 'amount', label: '₹ Amount' },
  { key: 'fullOwed', label: 'Full Owed' },
];

export default function SplitPage({
  title = 'Split Expense',
  onBack,
  headerRight,
  accentColor,
  payer,
  mode,
  onModeChange,
  valueUnit,
  total,
  rows,
  peopleAction,
  peopleFooter,
  empty,
  onDone,
}: SplitPageProps) {
  const insets = useSafeAreaInsets();
  const sum = rows.reduce((t, r) => t + (valueUnit === 'percent' ? r.percent : r.amount), 0);
  const anyEditable = rows.some((r) => r.editable);
  const hasTicks = rows.some((r) => r.onToggle);

  return (
    <View style={styles.page}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.headerBtn}>{headerRight}</View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {empty ?? (
            <>
              {payer ? (
                <FormField label="Paid By">
                  {payer.lockedNote ? (
                    <Text style={styles.note}>{payer.lockedNote}</Text>
                  ) : (
                    <>
                      <FormChipRow>
                        {payer.options.map((o) => (
                          <FormChip
                            key={o.id}
                            label={o.label}
                            active={payer.selectedId === o.id}
                            onPress={() => payer.onSelect(o.id)}
                            accentColor={accentColor}
                          />
                        ))}
                      </FormChipRow>
                      {payer.memoNote ? <Text style={[styles.note, { color: colors.info }]}>{payer.memoNote}</Text> : null}
                    </>
                  )}
                </FormField>
              ) : null}

              <FormField
                label="Method"
                hint={mode === 'fullOwed' ? 'The payer covers the whole bill — everyone else owes an equal share.' : undefined}
              >
                <FormChipRow>
                  {METHODS.map((m) => (
                    <FormChip
                      key={m.key}
                      label={m.label}
                      active={mode === m.key}
                      onPress={() => onModeChange(m.key)}
                      accentColor={accentColor}
                      icon={m.key === 'fullOwed' ? (
                        <Ionicons
                          name="hand-left-outline"
                          size={14}
                          color={mode === m.key ? accentColor : colors.textSecondary}
                        />
                      ) : undefined}
                    />
                  ))}
                </FormChipRow>
              </FormField>

              <View style={styles.peopleBlock}>
                <View style={styles.peopleHeader}>
                  <Text style={styles.peopleLabel}>People</Text>
                  {peopleAction}
                </View>

                <View style={styles.card}>
                  {rows.map((r, idx) => {
                    const payerIsMe = rows.some((x) => x.isPayer && x.isMe);
                    // Everyone else owes the payer; the payer's own row says so.
                    const oweLabel = r.isPayer ? '✓ Paid' : r.isMe ? 'You owe' : payerIsMe ? 'Owes you' : 'Owes';
                    return (
                      <View key={r.id} style={[styles.row, idx > 0 && styles.rowDivider]}>
                        {r.onToggle ? (
                          <TouchableOpacity style={styles.tickWrap} onPress={r.onToggle}>
                            <View
                              style={[
                                styles.tick,
                                r.checked && { backgroundColor: accentColor, borderColor: accentColor },
                              ]}
                            >
                              {r.checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        ) : null}

                        <View style={styles.nameWrap}>
                          <Text style={styles.name} numberOfLines={1}>{r.isMe ? 'You' : r.name}</Text>
                          {mode !== 'equal' ? (
                            <Text style={[styles.owe, r.isPayer && styles.paid]} numberOfLines={1}>{oweLabel}</Text>
                          ) : null}
                        </View>

                        {/* Percent mode shows the ₹ each % comes to. */}
                        {valueUnit === 'percent' && r.editable && total > 0 ? (
                          <Text style={styles.rs} numberOfLines={1}>{formatCurrency((total * r.percent) / 100)}</Text>
                        ) : null}

                        <View style={[styles.valueCol, valueUnit === 'percent' && styles.valueColPct]}>
                          {r.editable ? (
                            <>
                              <ShareInput
                                style={[styles.input, valueUnit === 'percent' && styles.inputPct]}
                                value={
                                  valueUnit === 'percent'
                                    ? r.percent ? String(r.percent) : ''
                                    : r.amount ? String(r.amount) : ''
                                }
                                onChangeText={(v) => r.onChange?.(parseFloat(v.replace(/[^\d.]/g, '')) || 0)}
                                keyboardType={valueUnit === 'percent' ? 'number-pad' : 'decimal-pad'}
                                maxLength={valueUnit === 'percent' ? 3 : INPUT_LIMITS.AMOUNT_MAX_LEN}
                                placeholder="0"
                                placeholderTextColor={colors.textMuted}
                              />
                              <Text style={styles.suffix}>{valueUnit === 'percent' ? '%' : '₹'}</Text>
                            </>
                          ) : (
                            <Text style={styles.lockedAmt} numberOfLines={1}>{formatCurrency(r.amount)}</Text>
                          )}
                        </View>

                        {r.onRemove ? (
                          <TouchableOpacity style={styles.removeBtn} onPress={r.onRemove} hitSlop={8}>
                            <Ionicons name="remove-circle-outline" size={24} color={colors.danger} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                {hasTicks && mode === 'equal' ? (
                  <Text style={styles.tickHint}>Untick anyone who isn’t part of this expense.</Text>
                ) : null}
                {anyEditable ? <SplitTotalHint mode={valueUnit} sum={sum} total={total} /> : null}
                {peopleFooter}
              </View>
            </>
          )}
        </ScrollView>

        {empty ? null : (
          <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
            <GradientButton flat title="Done" onPress={onDone} style={{ width: '100%' }} />
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  headerSafe: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.lg },
  note: { ...typography.tiny, fontWeight: '500', color: colors.textSecondary, marginTop: spacing.xs },

  peopleBlock: { marginBottom: spacing.lg },
  peopleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  peopleLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  card: {
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md,
    backgroundColor: 'transparent', paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  rowDivider: { borderTopWidth: DIVIDER_W, borderTopColor: colors.divider },
  tickWrap: { marginRight: spacing.xs },
  tick: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.inputBorder,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center',
  },
  tickHint: { fontSize: 11, fontWeight: '500', color: colors.textMuted, marginTop: spacing.xs },
  // Name fills the space so the owe-label right-aligns into a clean column.
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.body, color: colors.textPrimary, flex: 1 },
  owe: { ...typography.tiny, color: colors.textMuted, fontWeight: '600', marginLeft: spacing.xs, flexShrink: 0, textAlign: 'right' },
  paid: { color: colors.success },
  rs: { width: 78, textAlign: 'right', ...typography.small, color: colors.textMuted },
  // Fixed width so every row's value block lines up whether it's an input or text.
  valueCol: { width: 116, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  input: {
    width: 100, backgroundColor: 'transparent', borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center', color: colors.textPrimary,
    ...typography.bodyBold, fontWeight: '700', borderWidth: 1, borderColor: colors.inputBorder,
  },
  valueColPct: { width: 84 },
  inputPct: { width: 64 },
  suffix: { marginLeft: 4, ...typography.small, color: colors.textSecondary },
  lockedAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', textAlign: 'right' },
  removeBtn: { alignItems: 'center', justifyContent: 'center' },
  footer: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider,
  },
});
