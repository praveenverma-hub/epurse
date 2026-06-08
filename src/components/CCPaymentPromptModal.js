// =============================================================================
// CCPaymentPromptModal
// -----------------------------------------------------------------------------
// Shown once per CC payment SMS detected on a tracked card.
// Works through a queue — if multiple payment SMSes arrive before the user
// responds, each one is shown in turn after the previous is dismissed/confirmed.
// Shows the current outstanding balance so the user knows what they're zeroing.
// =============================================================================

import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, Pressable,
} from 'react-native';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact, formatCurrency } from '../utils/format';
import { useEPurseStore } from '../store/ePurseStore';

const CCPaymentPromptModal = () => {
  const queue                  = useEPurseStore((s) => s.pendingCCPaymentQueue ?? []);
  const accounts               = useEPurseStore((s) => s.accounts ?? []);
  const confirmCCTrueUp        = useEPurseStore((s) => s.confirmCCTrueUp);
  const dismissCCPaymentPrompt = useEPurseStore((s) => s.dismissCCPaymentPrompt);

  const current = queue[0] ?? null;

  const slideY = useRef(new Animated.Value(300)).current;
  const fade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (current) {
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
  }, [!!current]);

  if (!current) return null;

  const { amount, accountMask, bankName, accountId } = current;
  const cardLabel = [bankName, accountMask ? `••${accountMask}` : null]
    .filter(Boolean).join(' ');

  // Current outstanding balance on the CC account (negative = you owe that amount).
  const account      = accounts.find((a) => a.id === accountId);
  const outstanding  = account ? Math.abs(Math.min(account.balance ?? 0, 0)) : 0;
  const hasOutstanding = outstanding > 0;

  // Badge showing queue depth when there's more than one payment waiting.
  const queueCount = queue.length;

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
        {/* Handle + optional queue badge */}
        <View style={styles.handleRow}>
          <View style={styles.handle} />
          {queueCount > 1 && (
            <View style={styles.queueBadge}>
              <Text style={styles.queueBadgeText}>{queueCount} payments</Text>
            </View>
          )}
        </View>

        {/* Card icon + headline */}
        <Text style={styles.icon}>💳</Text>
        <Text style={styles.headline}>Payment received</Text>
        {cardLabel ? (
          <Text style={styles.cardLabel}>{cardLabel}</Text>
        ) : null}

        {/* Summary block — outstanding + payment received in one card */}
        <View style={styles.summaryCard}>
          {hasOutstanding && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Current outstanding</Text>
                <Text style={styles.summaryValueRed}>₹{formatCompact(outstanding)}</Text>
              </View>
              <View style={styles.divider} />
            </>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment received</Text>
            <Text style={styles.summaryValueGreen}>₹{formatCompact(amount)}</Text>
          </View>
        </View>

        {/* Question */}
        <Text style={styles.body}>
          Want to true-up your outstanding balance to zero?
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
  handleRow: {
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.lg,
    position: 'relative',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
  },
  queueBadge: {
    position: 'absolute',
    right: 0,
    top: -2,
    backgroundColor: '#6366F120',
    borderWidth: 1,
    borderColor: '#6366F155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  queueBadgeText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '600',
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
  summaryCard: {
    width: '100%',
    backgroundColor: '#FFFFFF0A',
    borderWidth: 1,
    borderColor: '#FFFFFF18',
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  summaryLabel: {
    color: '#FFFFFF88',
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValueRed: {
    color: '#F87171',
    fontSize: 15,
    fontWeight: '700',
  },
  summaryValueGreen: {
    color: '#6EE7B7',
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#FFFFFF14',
  },
  body: {
    color: '#FFFFFFAA',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
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
