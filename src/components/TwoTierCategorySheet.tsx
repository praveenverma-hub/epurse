// =============================================================================
// TwoTierCategorySheet.tsx — Custom two-step category bottom sheet
// Step 1: Parent category grid.  Step 2: animated child chip expansion.
// Drag handle + pan gesture to dismiss. No external bottom-sheet library.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  PARENT_CATEGORIES,
  ParentCat,
  ChildCat,
  findParentByLabel,
} from '../constants/twoTierCategories';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = SCREEN_H * 0.62;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** Displayed in the sheet header. */
  merchant: string;
  /** Pre-select if the transaction already has a category. */
  currentParent?: string;
  currentChild?: string;
  onClose: () => void;
  onSave: (parentCategory: string, childCategory: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TwoTierCategorySheet: React.FC<Props> = ({
  visible,
  merchant,
  currentParent,
  currentChild,
  onClose,
  onSave,
}) => {
  const [selectedParent, setSelectedParent] = useState<ParentCat | null>(null);
  const [selectedChild, setSelectedChild] = useState<ChildCat | null>(null);

  const sheetY = useSharedValue(SHEET_H);
  const backdropAlpha = useSharedValue(0);

  // ── Open / close animation ───────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      sheetY.value = withSpring(0, { damping: 24, stiffness: 220 });
      backdropAlpha.value = withTiming(0.48, { duration: 280 });

      // Pre-select current categories when editing a known transaction
      if (currentParent) {
        const parent = findParentByLabel(currentParent);
        setSelectedParent(parent ?? null);
        if (parent && currentChild) {
          setSelectedChild(parent.children.find((c) => c.label === currentChild) ?? null);
        }
      }
    } else {
      sheetY.value = withTiming(SHEET_H, { duration: 240 });
      backdropAlpha.value = withTiming(0, { duration: 240 });
    }
  }, [visible]);

  // Reset selection when closed
  useEffect(() => {
    if (!visible) {
      const timer = setTimeout(() => {
        setSelectedParent(null);
        setSelectedChild(null);
      }, 260);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // ── Drag-down to dismiss ─────────────────────────────────────────────────
  const dismissSheet = () => {
    sheetY.value = withTiming(SHEET_H, { duration: 220 });
    backdropAlpha.value = withTiming(0, { duration: 220 });
    onClose();
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY([8, Infinity])
    .onUpdate((e) => {
      if (e.translationY > 0) sheetY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 700) {
        sheetY.value = withTiming(SHEET_H, { duration: 220 });
        backdropAlpha.value = withTiming(0, { duration: 220 });
        runOnJS(onClose)();
      } else {
        sheetY.value = withSpring(0, { damping: 24, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropAlpha.value,
  }));

  const canSave = selectedParent !== null && selectedChild !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissSheet}
    >
      {/* Backdrop — tap to close */}
      <TouchableWithoutFeedback onPress={dismissSheet}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.sheet, sheetStyle]}>

          {/* Drag handle */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerLabel}>Categorise</Text>
            <Text style={styles.merchantName} numberOfLines={1}>
              {merchant}
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Step 1: Parent categories ─────────────────────────── */}
            <Text style={styles.stepLabel}>1 — What type of spend?</Text>
            <View style={styles.parentGrid}>
              {PARENT_CATEGORIES.map((parent) => {
                const active = selectedParent?.id === parent.id;
                return (
                  <TouchableOpacity
                    key={parent.id}
                    style={[
                      styles.parentChip,
                      active && { backgroundColor: parent.color, borderColor: parent.color },
                    ]}
                    onPress={() => {
                      setSelectedParent(parent);
                      setSelectedChild(null);
                    }}
                    activeOpacity={0.72}
                  >
                    <Text style={styles.chipEmoji}>{parent.emoji}</Text>
                    <Text
                      style={[
                        styles.parentChipLabel,
                        active && styles.chipLabelActive,
                      ]}
                      numberOfLines={2}
                    >
                      {parent.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Step 2: Child categories (animated reveal) ────────── */}
            {selectedParent && (
              <Animated.View
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(100)}
                layout={LinearTransition.springify().damping(22).stiffness(220)}
              >
                <Text style={[styles.stepLabel, styles.stepLabelSpaced]}>
                  2 — Be specific:
                </Text>
                <View style={styles.childGrid}>
                  {selectedParent.children.map((child) => {
                    const active = selectedChild?.id === child.id;
                    return (
                      <TouchableOpacity
                        key={child.id}
                        style={[
                          styles.childChip,
                          active && {
                            backgroundColor: selectedParent.color,
                            borderColor: selectedParent.color,
                          },
                        ]}
                        onPress={() => setSelectedChild(child)}
                        activeOpacity={0.72}
                      >
                        <Text style={styles.chipEmoji}>{child.emoji}</Text>
                        <Text
                          style={[
                            styles.childChipLabel,
                            active && styles.chipLabelActive,
                          ]}
                        >
                          {child.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Animated.View>
            )}
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={() => {
                if (canSave) onSave(selectedParent!.label, selectedChild!.label);
              }}
              disabled={!canSave}
              activeOpacity={0.85}
            >
              <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
                {canSave
                  ? `${selectedParent!.emoji}  Save: ${selectedChild!.label}`
                  : 'Select a category above'}
              </Text>
            </TouchableOpacity>
          </View>

        </Animated.View>
      </GestureDetector>
    </Modal>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_H,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 22,
  },
  handleRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 2 },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F4F5F7',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  merchantName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 18,
    marginBottom: 10,
  },
  stepLabelSpaced: { marginTop: 22 },
  parentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  parentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EAECEE',
    backgroundColor: '#F4F5F7',
    // ~3 chips per row on most devices
    minWidth: '30%',
    flexShrink: 1,
  },
  chipEmoji: { fontSize: 15 },
  parentChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1C1C1E',
    flexShrink: 1,
  },
  chipLabelActive: { color: '#FFFFFF' },
  childGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#EAECEE',
    backgroundColor: '#F4F5F7',
  },
  childChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#F4F5F7',
  },
  saveBtn: {
    backgroundColor: '#FF5A1F',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#F4F5F7' },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  saveBtnTextDisabled: { color: '#9CA3AF' },
});
