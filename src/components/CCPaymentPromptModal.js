// =============================================================================
// CCPaymentPromptModal
// -----------------------------------------------------------------------------
// Shown once per CC payment SMS detected on a tracked card.
// Works through a queue — if multiple payment SMSes arrive before the user
// responds, each one is shown in turn after the previous is dismissed/confirmed.
// Lets the user choose how to reconcile the payment against the tracked balance:
//   • True-up to Zero    → clear the whole outstanding (paid the full bill)
//   • Settle this payment → reduce outstanding by exactly the payment amount
//   • Skip                → leave the balance untouched
//
// Theme-aware: surfaces/text follow the active (light/dark) palette; green = the
// positive settle accent, red = the amount still owed.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, Pressable,
} from 'react-native';

import { radius, spacing, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import { useTheme } from '../hooks/useTheme';
import { useEPurseStore } from '../store/ePurseStore';

const CCPaymentPromptModal = () => {
  const theme  = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const queue                  = useEPurseStore((s) => s.pendingCCPaymentQueue ?? []);
  const accounts               = useEPurseStore((s) => s.accounts ?? []);
  const confirmCCTrueUp        = useEPurseStore((s) => s.confirmCCTrueUp);
  const settleCCPayment        = useEPurseStore((s) => s.settleCCPayment);
  const dismissCCPaymentPrompt = useEPurseStore((s) => s.dismissCCPaymentPrompt);

  // Which reconciliation the user has picked. Defaults to the full true-up.
  const [choice, setChoice] = useState('trueup');

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

  // Reset the picked option each time a new payment surfaces.
  useEffect(() => { setChoice('trueup'); }, [current?.smsId, current?.accountId]);

  if (!current) return null;

  const { amount, accountMask, bankName, accountId } = current;
  const cardLabel = [bankName, accountMask ? `••${accountMask}` : null]
    .filter(Boolean).join(' ');

  // Current outstanding balance on the CC account (negative = you owe that amount).
  const account        = accounts.find((a) => a.id === accountId);
  const outstanding    = account ? Math.abs(Math.min(account.balance ?? 0, 0)) : 0;
  const hasOutstanding = outstanding > 0;

  // Resulting balance for each choice (what the outstanding becomes).
  const afterSettle = Math.max(0, outstanding - amount);

  const OPTIONS = [
    { key: 'trueup', title: 'True-up to Zero',    sub: 'Cleared the full bill',      result: 0 },
    { key: 'settle', title: 'Settle this payment', sub: `Apply ${formatCurrency(amount)}`, result: afterSettle },
    { key: 'skip',   title: 'Skip for now',        sub: 'Leave balance unchanged',    result: outstanding },
  ];

  const queueCount = queue.length;

  const onDismiss = dismissCCPaymentPrompt;
  const onConfirm = () => {
    if (choice === 'trueup')      confirmCCTrueUp();
    else if (choice === 'settle') settleCCPayment();
    else                          dismissCCPaymentPrompt();
  };

  const confirmLabel =
    choice === 'trueup' ? 'True-up to Zero'
    : choice === 'settle' ? `Settle ${formatCurrency(amount)}`
    : 'Skip';
  const confirmIsMuted = choice === 'skip';

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Scrim */}
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
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

        {/* Success badge — card glyph with a tick */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>💳</Text>
          <View style={styles.checkDot}>
            <Text style={styles.checkDotText}>✓</Text>
          </View>
        </View>

        {/* Hero — the payment amount */}
        <Text style={styles.heroAmount}>{formatCurrency(amount)}</Text>
        <Text style={styles.subtitle}>
          Payment received{cardLabel ? `  ·  ${cardLabel}` : ''}
        </Text>

        {hasOutstanding ? (
          <>
            {/* Current outstanding context */}
            <View style={styles.outstandingChip}>
              <Text style={styles.outstandingLabel}>Tracked outstanding</Text>
              <Text style={styles.outstandingValue}>{formatCurrency(outstanding)}</Text>
            </View>

            <Text style={styles.question}>How should we reconcile it?</Text>

            {/* Radio options */}
            <View style={styles.optionList}>
              {OPTIONS.map((opt) => {
                const active = choice === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => setChoice(opt.key)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.optionMid}>
                      <Text style={styles.optionTitle}>{opt.title}</Text>
                      <Text style={styles.optionSub}>{opt.sub}</Text>
                    </View>
                    <View style={styles.optionRight}>
                      <Text style={styles.optionResultLabel}>New bal.</Text>
                      <Text
                        style={[
                          styles.optionResult,
                          opt.result === 0 ? styles.optionResultZero : null,
                        ]}
                      >
                        {formatCurrency(opt.result)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Confirm */}
            <TouchableOpacity
              style={[styles.primaryBtn, confirmIsMuted && styles.primaryBtnMuted]}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <Text style={[styles.primaryBtnText, confirmIsMuted && styles.primaryBtnTextMuted]}>
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Nothing to reconcile */}
            <Text style={styles.body}>
              Your tracked card balance is already clear — nothing to reconcile.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onDismiss} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.View>
    </Modal>
  );
};

export default CCPaymentPromptModal;

// Theme-aware styles. Green = positive settle accent, red = amount owed; surfaces
// and text come from the active palette so the sheet matches light/dark mode.
const makeStyles = (t) => {
  const ACCENT  = t.primary;   // selected theme accent — interactive (radio + CTA)
  const SUCCESS = t.success;   // green — payment received / cleared (₹0)
  const DANGER  = t.danger;    // red — amount owed

  return StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#00000066',
    },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: t.card,
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
      backgroundColor: t.divider,
    },
    queueBadge: {
      position: 'absolute',
      right: 0,
      top: -2,
      backgroundColor: t.primary + '18',
      borderWidth: 1,
      borderColor: t.primary + '44',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    queueBadgeText: {
      color: t.primaryDark,
      fontSize: 11,
      fontWeight: '600',
    },

    // Icon badge
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: SUCCESS + '18',
      borderWidth: 1,
      borderColor: SUCCESS + '33',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    icon: { fontSize: 28 },
    checkDot: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: SUCCESS,
      borderWidth: 2,
      borderColor: t.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkDotText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '900',
      marginTop: -1,
    },

    // Hero
    heroAmount: {
      color: t.textPrimary,
      fontSize: 32,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    subtitle: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '500',
      letterSpacing: 0.3,
      marginTop: 4,
      marginBottom: spacing.md,
    },

    // Outstanding context chip
    outstandingChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 7,
      marginBottom: spacing.md,
    },
    outstandingLabel: {
      color: t.textSecondary,
      fontSize: 12.5,
      fontWeight: '500',
    },
    outstandingValue: {
      color: DANGER,
      fontSize: 13,
      fontWeight: '700',
    },

    question: {
      alignSelf: 'flex-start',
      color: t.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },

    // Options
    optionList: {
      width: '100%',
      gap: 8,
      marginBottom: spacing.lg,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    optionActive: {
      borderColor: ACCENT,
      backgroundColor: ACCENT + '14',
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: t.textMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    radioActive: {
      borderColor: ACCENT,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: ACCENT,
    },
    optionMid: { flex: 1, minWidth: 0 },
    optionTitle: {
      color: t.textPrimary,
      fontSize: 14.5,
      fontWeight: '700',
    },
    optionSub: {
      color: t.textMuted,
      fontSize: 12,
      fontWeight: '500',
      marginTop: 1,
    },
    optionRight: {
      alignItems: 'flex-end',
      marginLeft: 8,
    },
    optionResultLabel: {
      color: t.textMuted,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    optionResult: {
      color: t.textPrimary,
      fontSize: 14,
      fontWeight: '800',
      marginTop: 1,
    },
    optionResultZero: {
      color: SUCCESS,
    },

    // Body (no-outstanding branch)
    body: {
      color: t.textSecondary,
      fontSize: 13.5,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: spacing.lg,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.xs,
    },

    // Confirm
    primaryBtn: {
      width: '100%',
      backgroundColor: ACCENT,
      borderRadius: radius.md,
      paddingVertical: 15,
      alignItems: 'center',
    },
    primaryBtnMuted: {
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    primaryBtnTextMuted: {
      color: t.textSecondary,
      fontWeight: '600',
    },
  });
};
