// =============================================================================
// SmartRuleModal.tsx — Non-intrusive smart-rule suggestion sheet
// Triggered when the user tags the same merchant with the same two-tier
// category more than once. Offers to automate it for future SMS.
// =============================================================================

import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import SheetCloseButton from './SheetCloseButton';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SmartRuleState {
  /** Human-readable merchant label shown in the prompt. */
  merchant: string;
  parentCategory: string;
  childCategory: string;
  /**
   * UPPERCASE sanitized raw merchant key used as the userCustomRules dict key.
   * Matches what twoTierParser / smsParser write to the store.
   */
  rawMerchantKey: string;
}

interface Props {
  rule: SmartRuleState | null;
  onAutomate: (
    rawMerchantKey: string,
    parentCategory: string,
    childCategory: string,
  ) => void;
  onDismiss: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const SmartRuleModal: React.FC<Props> = ({ rule, onAutomate, onDismiss }) => {
  if (!rule) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Tap-outside to dismiss */}
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <Animated.View
        entering={FadeInDown.springify().damping(20).stiffness(220)}
        exiting={FadeOutDown.duration(200)}
        style={styles.card}
      >
        <SheetCloseButton onPress={onDismiss} variant="absolute" />
        {/* Drag pill */}
        <View style={styles.pillRow}>
          <View style={styles.pill} />
        </View>

        <Text style={styles.eyebrow}>⚡ ePurse Smart Rule</Text>

        <Text style={styles.title}>
          {'We noticed you always tag '}
          <Text style={styles.merchantHighlight}>{rule.merchant}</Text>
          {' as:'}
        </Text>

        <View style={styles.categoryPreview}>
          <Text style={styles.previewParent}>{rule.parentCategory}</Text>
          <Text style={styles.previewArrow}> → </Text>
          <Text style={styles.previewChild}>{rule.childCategory}</Text>
        </View>

        <Text style={styles.subtitle}>
          Automate this for all future SMS from this merchant?
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={onDismiss}
            activeOpacity={0.7}
          >
            <Text style={styles.btnSecondaryText}>No, Ask Every Time</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() =>
              onAutomate(rule.rawMerchantKey, rule.parentCategory, rule.childCategory)
            }
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>✓  Yes, Automate It</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 18,
  },
  pillRow: { alignItems: 'center', paddingVertical: 12 },
  pill: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    lineHeight: 22,
    marginBottom: 14,
  },
  merchantHighlight: {
    color: '#FF5A1F',
    fontWeight: '700',
  },
  categoryPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F5F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  previewParent: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  previewArrow: {
    fontSize: 14,
    color: '#6D28D9',
    fontWeight: '700',
  },
  previewChild: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6D28D9',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 16,   // radius.lg — this file has no theme import
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: '#F4F5F7',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  btnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  btnPrimary: {
    backgroundColor: '#6D28D9',
  },
  btnPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
