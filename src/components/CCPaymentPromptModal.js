// =============================================================================
// CCPaymentPromptModal
// -----------------------------------------------------------------------------
// Shown once when a credit-card payment SMS is detected on a card that has
// never had its outstanding balance tracked. Asks the user whether to zero out
// the card's balance (true-up) or skip.
// =============================================================================

import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, Pressable,
} from 'react-native';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';
import { useEPurseStore } from '../store/ePurseStore';

const CCPaymentPromptModal = () => {
  const pendingCCPayment    = useEPurseStore((s) => s.pendingCCPayment);
  const confirmCCTrueUp     = useEPurseStore((s) => s.confirmCCTrueUp);
  const dismissCCPaymentPrompt = useEPurseStore((s) => s.dismissCCPaymentPrompt);

  const slideY = useRef(new Animated.Value(300)).current;
  const fade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pendingCCPayment) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1, duration: 220, useNativeDriver: true,
        }),
        Animated.spring(slideY, {
          toValue: 0, tension: 68, friction: 12, useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fade,   { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(slideY, { toValue: 300, duration: 180, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [!!pendingCCPayment]);

  if (!pendingCCPayment) return null;

  const { amount, accountMask, bankName } = pendingCCPayment;
  const cardLabel = [bankName, accountMask ? `••${accountMask}` : null]
    .filter(Boolean).join(' ');

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissCCPaymentPrompt}
    >
      {/* Scrim */}
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissCCPaymentPrompt} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideY }] }]}
        pointerEvents="box-none"
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Card icon + headline */}
        <Text style={styles.icon}>💳</Text>
        <Text style={styles.headline}>Payment received</Text>
        {cardLabel ? (
          <Text style={styles.cardLabel}>{cardLabel}</Text>
        ) : null}

        {/* Amount pill */}
        <View style={styles.amountPill}>
          <Text style={styles.amountText}>₹{formatCompact(amount)}</Text>
        </View>

        {/* Body copy */}
        <Text style={styles.body}>
          Looks like you may have fully settled your card. Would you like to
          true-up your outstanding balance to zero?
        </Text>

        {/* CTA row */}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={confirmCCTrueUp}
          activeOpacity={0.82}
        >
          <Text style={styles.primaryBtnText}>True-up to Zero</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={dismissCCPaymentPrompt}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryBtnText}>Skip</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

export default CCPaymentPromptModal;

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000066',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: 36,
    paddingTop: spacing.sm,
    alignItems: 'center',
    ...shadows.elevated,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  cardLabel: {
    color: '#FFFFFF88',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.6,
    marginBottom: spacing.md,
  },
  amountPill: {
    backgroundColor: '#10B98120',
    borderWidth: 1,
    borderColor: '#10B98144',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: spacing.md,
  },
  amountText: {
    color: '#6EE7B7',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  body: {
    color: '#FFFFFFAA',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#10B981',
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF12',
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#FFFFFFBB',
    fontSize: 15,
    fontWeight: '600',
  },
});
