// =============================================================================
// GoalCategoryPickerModal — pick which categories fund a goal automatically.
//
// Pulled out of GoalFormScreen (Sep-12-26): a row per top-level category, each
// expandable to its own sub-categories, printed straight into the form grew
// the form's length with however many categories exist — the exact thing the
// form's own header comment warns against (ui-consistency §2b: pick by
// GROWTH). The category TREE is what grows unboundedly here, not the rest of
// the form, so only the category list moves into its own sheet; name / glyph
// / colour / kind / duration / target / monthly stay a normal-length screen.
//
// Selections apply the instant you tap a row — same as `CategoryPickerModal`
// elsewhere in the app ("changes apply on tap, Save just confirms + closes").
// `parentIds`/`categoryIds` are the SAME lifted state `GoalFormScreen` already
// held; this sheet edits them directly rather than keeping its own draft, so
// the form's summary row is never one tap behind what's actually selected.
// =============================================================================

import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, withAlpha, mix, readableOn } from '../constants/theme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import { TILE_FILL_ALPHA } from './NavListRow';
import SheetCloseButton from './SheetCloseButton';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

interface Props {
  visible: boolean;
  onClose: () => void;
  parentIds: string[];
  setParentIds: (ids: string[]) => void;
  categoryIds: string[];
  setCategoryIds: (ids: string[]) => void;
}

const GoalCategoryPickerModal: React.FC<Props> = ({
  visible, onClose, parentIds, setParentIds, categoryIds, setCategoryIds,
}) => {
  const theme = useTheme();
  const tree = useCategoryTree();
  const [expanded, setExpanded] = useState<string | null>(null);

  const countInk = readableOn(mix(theme.primary, TILE_FILL_ALPHA, theme.card), theme.primary, 4.5);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    hapticLight();
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />

        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <View style={[styles.handle, { backgroundColor: theme.divider }]} />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>Fund From</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.6}>
              <Text style={[styles.doneTxt, { color: theme.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Any spend in these categories counts toward this goal automatically.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {tree.map((parent) => {
              const on = parentIds.includes(parent.id);
              const open = expanded === parent.id;
              // Only children with their OWN legacy id can be offered: the rest
              // resolve to the parent's flat category, so picking "Restaurants"
              // would quietly match every Food row. Narrowing you can't actually
              // enforce is worse than not offering it.
              const pickable = parent.children.filter((c: any) => c.legacyId && c.legacyId !== parent.legacyId);
              const childOn = pickable.filter((c: any) => categoryIds.includes(c.legacyId!));
              return (
                <View key={parent.id} style={[styles.ruleRow, { borderColor: theme.divider }]}>
                  {/* The chevron is a SIBLING in this row, not an absolutely
                      positioned overlay. As an overlay it sat on top of the
                      selected-child count, which is the last thing in the row —
                      the two printed over each other. */}
                  <View style={styles.ruleTop}>
                    <TouchableOpacity
                      onPress={() => toggle(parentIds, setParentIds, parent.id)}
                      activeOpacity={0.75}
                      style={styles.ruleMain}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Fund from ${parent.label}`}
                    >
                      <View
                        style={[
                          styles.tick,
                          on
                            ? { backgroundColor: theme.primary, borderColor: theme.primary }
                            : { borderColor: theme.inputBorder },
                        ]}
                      >
                        {on ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
                      </View>
                      <Text style={styles.ruleEmoji} allowFontScaling={false}>{parent.emoji}</Text>
                      <Text style={[styles.ruleName, { color: theme.textPrimary }]} numberOfLines={1}>
                        {parent.label}
                      </Text>
                      {/* A bare digit beside a label read as part of the label.
                          The tinted disc marks it as a count of something. */}
                      {!on && childOn.length > 0 ? (
                        <View style={[styles.ruleCount, { backgroundColor: withAlpha(theme.primary, TILE_FILL_ALPHA) }]}>
                          <Text style={[styles.ruleMeta, { color: countInk }]}>{childOn.length}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>

                    {/* Sub-categories are hidden until asked for: most goals want
                        the whole parent, and every child row open by default would
                        bury the rest of the list. */}
                    {pickable.length > 0 && !on ? (
                      <TouchableOpacity
                        onPress={() => { hapticLight(); setExpanded(open ? null : parent.id); }}
                        hitSlop={8}
                        style={styles.ruleChevron}
                        accessibilityRole="button"
                        accessibilityLabel={
                          open ? `Hide ${parent.label} sub-categories` : `Show ${parent.label} sub-categories`
                        }
                      >
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={theme.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {open && !on ? (
                    <View style={styles.childWrap}>
                      {pickable.map((c: any) => {
                        const legacy = c.legacyId!;
                        const cOn = categoryIds.includes(legacy);
                        return (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => toggle(categoryIds, setCategoryIds, legacy)}
                            activeOpacity={0.75}
                            style={[
                              styles.childChip,
                              {
                                borderColor: cOn ? theme.primary : theme.inputBorder,
                                backgroundColor: cOn ? withAlpha(theme.primary, 0.08) : 'transparent',
                              },
                            ]}
                          >
                            <Text style={styles.childEmoji} allowFontScaling={false}>{c.emoji}</Text>
                            <Text
                              style={[styles.childTxt, { color: cOn ? theme.primary : theme.textSecondary }]}
                              numberOfLines={1}
                            >
                              {c.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '82%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.h2, fontWeight: '700' },
  doneTxt: { ...typography.body, fontWeight: '700' },
  hint: { ...typography.small, marginTop: spacing.xs, marginBottom: spacing.md },

  ruleRow: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  ruleTop: { flexDirection: 'row', alignItems: 'center' },
  ruleMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 30 },
  tick: {
    width: 20, height: 20, borderRadius: radius.sm,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  ruleEmoji: { fontSize: 15 },
  ruleName: { ...typography.small, fontWeight: '600', flex: 1 },
  // Chip, not a disc: same geometry as NavListRow's badge, so a count reads the
  // same wherever it appears. Sized by its padding, so two digits widen it
  // instead of straining a fixed box.
  ruleCount: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleMeta: { ...typography.tiny, fontWeight: '800' },
  ruleChevron: { padding: 6, marginLeft: spacing.xs },
  childWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    marginTop: spacing.sm, paddingLeft: 28,
  },
  childChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  childEmoji: { fontSize: 11 },
  childTxt: { ...typography.tiny, fontWeight: '600' },
});

export default GoalCategoryPickerModal;
