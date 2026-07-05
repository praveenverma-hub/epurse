// =============================================================================
// CategoryPickerModal.tsx — Two-tier category picker bottom sheet
// Parent rows accordion-expand to reveal child chips inline.
// LB (lent/borrowed) children intercept to the contact-link flow.
// lent_settled / borrow_repaid rendered as a flat settlement section below.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import {
  ParentCat,
  ChildCat,
  LB_CHILD_LABEL_TO_ID,
  LB_SETTLEMENT_IDS,
} from '../constants/twoTierCategories';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LegacyCat {
  id: string;
  name: string;
  emoji: string;
}

interface Props {
  visible: boolean;
  /** Full legacy categories list — only used to render settlement rows. */
  categories: LegacyCat[];
  /** Pre-selected legacy categoryId — used for settlement row highlight. */
  selectedCategoryId?: string;
  /** Pre-selected two-tier parent label. */
  selectedParent?: string;
  /** Pre-selected two-tier child label. */
  selectedChild?: string;
  isHidden: boolean;
  isIgnored: boolean;
  canSplit: boolean;
  isSplitTxn: boolean;
  /** When true, hides the category picker and shows a locked notice instead. */
  categoryLocked?: boolean;
  onPressSplit?: () => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectLentBorrow?: (categoryId: string) => void;
  /** Called when a child chip is selected outside the LB flow. */
  onSelectTwoTier?: (parentCategory: string, childCategory: string) => void;
  onToggleHidden?: (hidden: boolean) => void;
  onIgnore?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onClose: () => void;
  /** groupId the transaction currently belongs to (if any). */
  currentGroupId?: string | null;
  onPressAddToGroup?: () => void;
  onPressRemoveFromGroup?: () => void;
  /**
   * Set who-owes / edit the group split. Provided ONLY for shared-group-tagged txns
   * (the parent knows the group type) — opens the group-expense editor. `groupHasSplit`
   * just toggles the button label (set vs edit).
   */
  onPressEditGroup?: () => void;
  groupHasSplit?: boolean;
}

// ─── ParentRow ───────────────────────────────────────────────────────────────

interface ParentRowProps {
  parent: ParentCat;
  isExpanded: boolean;
  selectedParent?: string;
  selectedChild?: string;
  onParentPress: () => void;
  onChildPress: (parent: ParentCat, child: ChildCat) => void;
}

const ParentRow: React.FC<ParentRowProps> = ({
  parent,
  isExpanded,
  selectedParent,
  selectedChild,
  onParentPress,
  onChildPress,
}) => {
  const maxH = useSharedValue(0);
  const childOpacity = useSharedValue(0);
  const isParentSelected = selectedParent === parent.label;

  useEffect(() => {
    if (isExpanded) {
      maxH.value = withTiming(280, { duration: 260, easing: Easing.out(Easing.cubic) });
      childOpacity.value = withTiming(1, { duration: 200 });
    } else {
      maxH.value = withTiming(0, { duration: 200 });
      childOpacity.value = withTiming(0, { duration: 140 });
    }
  }, [isExpanded]);

  const childContainerStyle = useAnimatedStyle(() => ({
    maxHeight: maxH.value,
    opacity: childOpacity.value,
  }));

  return (
    <View>
      <TouchableOpacity
        style={[
          styles.parentRow,
          isParentSelected && {
            borderWidth: 1.5,
            borderColor: parent.color + '55',
            backgroundColor: parent.color + '0D',
          },
          isExpanded && styles.parentRowExpanded,
        ]}
        onPress={onParentPress}
        activeOpacity={0.72}
      >
        <Text style={styles.rowEmoji}>{parent.emoji}</Text>
        <View style={styles.rowMid}>
          <Text
            style={[
              styles.rowLabel,
              isParentSelected && { color: parent.color, fontWeight: '700' },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {parent.label}
          </Text>
          {isParentSelected && selectedChild && !isExpanded && (
            <Text style={[styles.selectedChildHint, { color: parent.color }]}>
              {selectedChild}
            </Text>
          )}
        </View>
        <Text style={[styles.chevron, isExpanded && { color: parent.color }]}>
          {isExpanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      <Animated.View style={[{ overflow: 'hidden' }, childContainerStyle]}>
        <View style={styles.childGrid}>
          {parent.children.map((child) => {
            const isChildSelected = isParentSelected && selectedChild === child.label;
            return (
              <TouchableOpacity
                key={child.id}
                style={[
                  styles.childChip,
                  isChildSelected && {
                    backgroundColor: parent.color,
                    borderColor: parent.color,
                  },
                ]}
                onPress={() => onChildPress(parent, child)}
                activeOpacity={0.72}
              >
                <Text style={styles.chipEmoji}>{child.emoji}</Text>
                <Text
                  style={[
                    styles.childChipLabel,
                    isChildSelected && styles.chipLabelActive,
                  ]}
                >
                  {child.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
};

// ─── CategoryPickerModal ─────────────────────────────────────────────────────

const CategoryPickerModal: React.FC<Props> = ({
  visible,
  categories,
  selectedCategoryId,
  selectedParent,
  selectedChild,
  isHidden,
  isIgnored,
  canSplit,
  isSplitTxn,
  categoryLocked = false,
  onPressSplit,
  onSelectCategory,
  onSelectLentBorrow,
  onSelectTwoTier,
  onToggleHidden,
  onIgnore,
  onRestore,
  onDelete,
  onClose,
  currentGroupId,
  onPressAddToGroup,
  onPressRemoveFromGroup,
  onPressEditGroup,
  groupHasSplit,
}) => {
  const theme = useTheme();
  const categoryTree = useCategoryTree();   // built-ins + user's custom categories
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);

  // Auto-expand the active parent when the sheet opens
  useEffect(() => {
    if (visible && selectedParent) {
      const match = categoryTree.find((p) => p.label === selectedParent);
      setExpandedParentId(match?.id ?? null);
    }
    if (!visible) {
      const t = setTimeout(() => setExpandedParentId(null), 260);
      return () => clearTimeout(t);
    }
  }, [visible, selectedParent]);

  const handleParentPress = (parentId: string) => {
    setExpandedParentId((prev) => (prev === parentId ? null : parentId));
  };

  const handleChildPress = (parent: ParentCat, child: ChildCat) => {
    const lbId = LB_CHILD_LABEL_TO_ID[child.label];
    if (lbId && onSelectLentBorrow) {
      onSelectLentBorrow(lbId);
      return;
    }
    if (onSelectTwoTier) {
      onSelectTwoTier(parent.label, child.label);
    } else {
      onSelectCategory(parent.id);
    }
  };

  const settlementCats = categories.filter((c) => LB_SETTLEMENT_IDS.has(c.id));
  // Fall back to a fixed label so the row shows even if an older persisted category
  // list doesn't yet include cc_bill (it's injected on rehydrate, but don't depend on it).
  const ccBillCat = categories.find((c) => c.id === 'cc_bill')
    ?? { id: 'cc_bill', name: 'Credit Card Bill', color: '#8B5CF6', emoji: '💳' };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Manage transaction</Text>
            {/* Changes apply on tap — Save just confirms + closes the sheet. Plain text button. */}
            <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.6}>
              <Text style={[styles.saveBtnTxt, { color: theme.primary }]}>Save</Text>
            </TouchableOpacity>
          </View>

          {categoryLocked ? (
            <View style={styles.lockedNotice}>
              <Text style={styles.lockedIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.lockedTitle}>Category locked</Text>
                <Text style={styles.lockedBody}>
                  This transaction is linked to a lent/borrow record. Category cannot be changed.
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
            >
              {categoryTree.map((parent) => (
                <ParentRow
                  key={parent.id}
                  parent={parent}
                  isExpanded={expandedParentId === parent.id}
                  selectedParent={selectedParent}
                  selectedChild={selectedChild}
                  onParentPress={() => handleParentPress(parent.id)}
                  onChildPress={handleChildPress}
                />
              ))}

              {/* Settlement categories — lent_settled / borrow_repaid */}
              {settlementCats.length > 0 && (
                <View style={styles.settlementSection}>
                  <Text style={styles.settlementSectionLabel}>SETTLEMENTS</Text>
                  {settlementCats.map((cat) => {
                    const active = selectedCategoryId === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          styles.parentRow,
                          styles.settlementRow,
                          active && {
                            borderWidth: 1.5,
                            borderColor: colors.success + '66',
                            backgroundColor: colors.success + '10',
                          },
                        ]}
                        onPress={() => {
                          if (onSelectLentBorrow) {
                            onSelectLentBorrow(cat.id);
                          } else {
                            onSelectCategory(cat.id);
                          }
                        }}
                        activeOpacity={0.72}
                      >
                        <Text style={styles.rowEmoji}>{cat.emoji}</Text>
                        <View style={styles.rowMid}>
                          <Text
                            style={[
                              styles.rowLabel,
                              active && { color: colors.success, fontWeight: '700' },
                            ]}
                          >
                            {cat.name}
                          </Text>
                          <Text style={styles.lbHint}>Links to person · tracks balance</Text>
                        </View>
                        {active && (
                          <Text style={{ color: colors.success, fontWeight: '800' }}>✓</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Credit-card bill payment — opens the card-picker + reconcile sheet. */}
              {ccBillCat && (
                <View style={styles.settlementSection}>
                  <Text style={styles.settlementSectionLabel}>CARD</Text>
                  <TouchableOpacity
                    style={[
                      styles.parentRow,
                      styles.settlementRow,
                      selectedCategoryId === 'cc_bill' && {
                        borderWidth: 1.5,
                        borderColor: theme.primary + '66',
                        backgroundColor: theme.primary + '10',
                      },
                    ]}
                    onPress={() => onSelectCategory('cc_bill')}
                    activeOpacity={0.72}
                  >
                    <Text style={styles.rowEmoji}>{ccBillCat.emoji}</Text>
                    <View style={styles.rowMid}>
                      <Text
                        style={[
                          styles.rowLabel,
                          selectedCategoryId === 'cc_bill' && { color: theme.primary, fontWeight: '700' },
                        ]}
                      >
                        {ccBillCat.name}
                      </Text>
                      <Text style={styles.lbHint}>Paid a card bill · excluded from spend</Text>
                    </View>
                    {selectedCategoryId === 'cc_bill' && (
                      <Text style={{ color: theme.primary, fontWeight: '800' }}>✓</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}

          {/* Manage actions — Private · Ignore · Split share one row. */}
          {(onToggleHidden || onIgnore || onRestore || (canSplit && !isIgnored && onPressSplit)) ? (
            <View style={styles.actionRow}>
              {onToggleHidden ? (
                <TouchableOpacity
                  style={[styles.actionBtn, isHidden ? styles.unhideHalf : styles.hideHalf]}
                  activeOpacity={0.85}
                  onPress={() => onToggleHidden(!isHidden)}
                >
                  <Text style={[styles.hideIgnoreText, isHidden && styles.unhideText]}>
                    {isHidden ? 'Public' : 'Private'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {(onIgnore || onRestore) ? (
                <TouchableOpacity
                  style={[styles.actionBtn, isIgnored ? styles.restoreHalf : styles.ignoreHalf]}
                  activeOpacity={0.85}
                  onPress={isIgnored ? onRestore : onIgnore}
                >
                  <Text style={isIgnored ? styles.restoreText : styles.ignoreText}>
                    {isIgnored ? 'Restore' : 'Ignore'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {canSplit && !isIgnored && onPressSplit ? (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.splitAction]}
                  activeOpacity={0.85}
                  onPress={onPressSplit}
                >
                  <Text style={styles.splitBillText} numberOfLines={1}>
                    {isSplitTxn ? 'Edit split' : 'Split'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* Shared-group txn → set who owes / edit the split (drives the LB legs). */}
          {!isIgnored && currentGroupId && onPressEditGroup ? (
            <TouchableOpacity
              style={[styles.splitBillBtn, styles.groupSplitBtn]}
              activeOpacity={0.85}
              onPress={onPressEditGroup}
            >
              <Text style={styles.groupSplitText}>
                {groupHasSplit ? '🧮 Edit split · who owes' : '🧮 Set who owes'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Group action (add / remove) + delete. When both show they share one
              row: delete as an icon on the left (~20%), the group action on the
              right (~80%). When only one is present it spans the full width. */}
          {(() => {
            const groupAction =
              !isIgnored && !currentGroupId && onPressAddToGroup ? (
                <TouchableOpacity
                  style={[styles.groupBtnBase, styles.groupAddBtn, styles.groupActionFill]}
                  activeOpacity={0.85}
                  onPress={onPressAddToGroup}
                >
                  <Ionicons name="people-outline" size={18} color={colors.primary} style={styles.groupIcon} />
                  <Text style={styles.groupAddText}>Add to group</Text>
                </TouchableOpacity>
              ) : !isIgnored && currentGroupId && onPressRemoveFromGroup ? (
                <TouchableOpacity
                  style={[styles.groupBtnBase, styles.groupRemoveBtn, styles.groupActionFill]}
                  activeOpacity={0.85}
                  onPress={onPressRemoveFromGroup}
                >
                  <Ionicons name="people-outline" size={18} color={colors.danger} style={styles.groupIcon} />
                  <Text style={styles.groupRemoveText}>Remove from group</Text>
                </TouchableOpacity>
              ) : null;

            if (groupAction && onDelete) {
              // Paired row — delete icon (20%) · group action (80%).
              return (
                <View style={styles.groupDeleteRow}>
                  <TouchableOpacity
                    style={[styles.deleteIconBtn]}
                    activeOpacity={0.85}
                    onPress={onDelete}
                    accessibilityLabel="Delete transaction"
                  >
                    <Ionicons name="trash-outline" size={20} color="#fff" />
                  </TouchableOpacity>
                  {groupAction}
                </View>
              );
            }

            // Otherwise render whichever is present, full width.
            return (
              <>
                {groupAction ? (
                  <View style={{ marginTop: spacing.sm }}>{groupAction}</View>
                ) : null}
                {onDelete ? (
                  <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.85}>
                    <Ionicons name="trash-outline" size={18} color="#fff" style={styles.groupIcon} />
                    <Text style={styles.deleteText}>Delete transaction</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            );
          })()}
        </View>
      </View>
    </Modal>
  );
};

export default CategoryPickerModal;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0006',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '82%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    flex: 1,
  },
  saveBtnTxt: {
    ...typography.bodyBold,
    fontWeight: '700' as const,
    marginLeft: spacing.sm,
  },
  list: { maxHeight: 380 },

  // ── Parent row ─────────────────────────────────────────────────────────────
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  parentRowExpanded: {
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  rowEmoji: { fontSize: 20, marginRight: spacing.sm },
  rowMid: { flex: 1 },
  rowLabel: {
    ...typography.bodyBold,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  selectedChildHint: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  chevron: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },

  // ── Child chips ────────────────────────────────────────────────────────────
  childGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.cardAlt,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    marginBottom: spacing.sm,
  },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.card,
  },
  chipEmoji: { fontSize: 14 },
  childChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipLabelActive: { color: '#FFFFFF' },

  // ── Settlement section ─────────────────────────────────────────────────────
  settlementSection: { marginTop: spacing.sm },
  settlementSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  settlementRow: {
    borderColor: colors.success + '33',
    backgroundColor: colors.success + '06',
  },
  lbHint: {
    ...typography.tiny,
    fontWeight: '500' as const,
    color: colors.success,
    marginTop: 2,
  },

  // ── Action buttons ─────────────────────────────────────────────────────────
  splitBillBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.info + '18',
    borderWidth: 1,
    borderColor: colors.info + '55',
  },
  splitBillText: {
    color: colors.info,
    ...typography.bodyBold,
    fontWeight: '700',
  },
  // Single row: Private · Ignore · Split (equal columns).
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitAction: {
    backgroundColor: colors.info + '18',
    borderWidth: 1,
    borderColor: colors.info + '55',
  },
  // Base for the group action button (icon + label on one row).
  groupBtnBase: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  groupIcon: { marginRight: 6 },
  // Row shared by delete (icon, ~20%) + group action (~80%).
  groupDeleteRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  groupActionFill: { flex: 4 },
  deleteIconBtn: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAddBtn: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary + '55',
  },
  groupAddText: {
    color: colors.primary,
    ...typography.bodyBold,
    fontWeight: '700',
  },
  groupSplitBtn: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary + '55',
  },
  groupSplitText: {
    color: colors.primary,
    ...typography.bodyBold,
    fontWeight: '700',
  },
  groupRemoveBtn: {
    backgroundColor: colors.danger + '12',
    borderColor: colors.danger + '44',
  },
  groupRemoveText: {
    color: colors.danger,
    ...typography.bodyBold,
    fontWeight: '700',
  },
  hideIgnoreRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hideIgnoreHalf: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideHalf: {
    backgroundColor: colors.success + '16',
    borderWidth: 1,
    borderColor: colors.success + '55',
  },
  unhideHalf: {
    backgroundColor: colors.success + '16',
    borderColor: colors.success + '55',
    borderWidth: 1,
  },
  hideIgnoreText: {
    color: colors.success,
    ...typography.small,
    fontWeight: '700',
  },
  unhideText: { color: colors.success },
  ignoreHalf: {
    backgroundColor: colors.warning + '18',
    borderWidth: 1,
    borderColor: colors.warning + '66',
  },
  ignoreText: {
    color: colors.warning,
    ...typography.small,
    fontWeight: '700',
  },
  restoreHalf: {
    backgroundColor: colors.success + '18',
    borderWidth: 1,
    borderColor: colors.success + '66',
  },
  restoreText: {
    color: colors.success,
    ...typography.small,
    fontWeight: '700',
  },
  deleteBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: '#fff', ...typography.bodyBold, fontWeight: '700' },

  // ── Category locked notice ─────────────────────────────────────────────────
  lockedNotice: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing.sm,
    backgroundColor: colors.warning + '14',
    borderWidth:     1,
    borderColor:     colors.warning + '44',
    borderRadius:    radius.md,
    padding:         spacing.md,
    marginBottom:    spacing.sm,
  },
  lockedIcon: { fontSize: 16, marginTop: 1 },
  lockedTitle: {
    ...typography.bodyBold,
    fontWeight: '700' as const,
    color:      colors.warning,
    marginBottom: 2,
  },
  lockedBody: {
    fontSize:   12,
    fontWeight: '500' as const,
    color:      colors.textSecondary,
    lineHeight: 17,
    marginTop:  1,
  },
});
