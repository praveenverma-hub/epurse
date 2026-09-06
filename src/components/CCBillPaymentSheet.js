// =============================================================================
// CCBillPaymentSheet
// -----------------------------------------------------------------------------
// Opened when the user reclassifies an existing DEBIT as a credit-card bill
// payment (category → 'cc_bill', which drops it out of spend totals). Lets them
// pick WHICH card it paid and how to reconcile that card's outstanding:
//   • True-up to Zero      → clear the card
//   • Settle this payment  → reduce the card by exactly this txn's amount
//   • Don't change balance → leave the card (use when the card's own "payment
//                            received" SMS already reduced it → no double count)
//
// Smart default: if the chosen card is already clear (outstanding ≤ 0), we default
// to "Don't change balance" so a both-SMS case can't double-reduce.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Easing, Pressable,
} from 'react-native';

import { radius, spacing, shadows } from '../constants/theme';
import SheetCloseButton from './SheetCloseButton';
import { ACCOUNT_TYPES } from '../constants/categories';
import { formatCurrency } from '../utils/format';
import { useTheme } from '../hooks/useTheme';
import { useEPurseStore } from '../store/ePurseStore';

const outstandingOf = (acc) => Math.abs(Math.min(acc?.balance ?? 0, 0));

const CCBillPaymentSheet = ({ txn, onClose, onConfirm = () => {} }) => {
  const theme  = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const accounts            = useEPurseStore((s) => s.accounts ?? []);
  const markAsCCBillPayment = useEPurseStore((s) => s.markAsCCBillPayment);

  const ccAccounts = useMemo(
    () => accounts.filter((a) => a.type === ACCOUNT_TYPES.CREDIT_CARD),
    [accounts]
  );

  const [cardId, setCardId] = useState(null);
  const [mode, setMode]     = useState('settle');

  const amount = txn?.amount || 0;

  const slideY = useRef(new Animated.Value(400)).current;
  const fade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (txn) {
      // Default to the first card; pick its smart default mode.
      const first = ccAccounts[0] || null;
      setCardId(first?.id ?? null);
      setMode(first && outstandingOf(first) > 0 ? 'settle' : 'none');
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideY, { toValue: 0, tension: 68, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fade,   { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(slideY, { toValue: 400, duration: 160, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [txn?.id]);

  if (!txn) return null;

  const selectedCard = ccAccounts.find((a) => a.id === cardId) || null;
  const cardOutstanding = selectedCard ? outstandingOf(selectedCard) : 0;

  const pickCard = (id) => {
    setCardId(id);
    const acc = ccAccounts.find((a) => a.id === id);
    setMode(acc && outstandingOf(acc) > 0 ? 'settle' : 'none');
  };

  const MODES = [
    { key: 'trueup', title: 'True-up to Zero',      sub: 'Cleared the full bill',   result: 0 },
    { key: 'settle', title: 'Settle this payment',   sub: `Apply ${formatCurrency(amount)}`, result: Math.max(0, cardOutstanding - amount) },
    { key: 'none',   title: "Don't change balance",  sub: 'Card SMS already recorded it', result: cardOutstanding },
  ];

  const confirm = () => {
    markAsCCBillPayment(txn.id, cardId, cardId ? mode : 'none');
    onConfirm?.();
    onClose?.();
  };

  const cardLabel = (a) =>
    [a.bankName || a.name, a.mask ? `••${a.mask}` : null].filter(Boolean).join(' ');

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]} pointerEvents="box-none">
        <SheetCloseButton onPress={onClose} variant="absolute" />
        <View style={styles.handle} />

        <Text style={styles.title}>Credit card bill payment</Text>
        <Text style={styles.subtitle}>
          {formatCurrency(amount)}  ·  won't count as spend
        </Text>

        {ccAccounts.length === 0 ? (
          <>
            <Text style={styles.note}>
              No credit card on record yet — this payment will just be marked as
              non-spend (excluded from your totals).
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Mark as non-spend</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {/* Which card */}
              <Text style={styles.section}>Which card did this pay?</Text>
              {ccAccounts.map((a) => {
                const active = cardId === a.id;
                const owe = outstandingOf(a);
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => pickCard(a.id)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.rowMid}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{cardLabel(a)}</Text>
                      <Text style={styles.rowSub}>
                        {owe > 0 ? `Owe ${formatCurrency(owe)}` : 'Cleared'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* How to reconcile */}
              <Text style={[styles.section, { marginTop: spacing.md }]}>Adjust the card?</Text>
              {MODES.map((m) => {
                const active = mode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => setMode(m.key)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.rowMid}>
                      <Text style={styles.rowTitle}>{m.title}</Text>
                      <Text style={styles.rowSub}>{m.sub}</Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowResultLabel}>New bal.</Text>
                      <Text style={[styles.rowResult, m.result === 0 && styles.rowResultZero]}>
                        {formatCurrency(m.result)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.primaryBtn} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Mark as CC bill payment</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.View>
    </Modal>
  );
};

export default CCBillPaymentSheet;

const makeStyles = (t) => {
  const ACCENT  = t.primary;
  const SUCCESS = t.success;

  return StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000066' },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius:  radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingBottom: 32,
      paddingTop: spacing.sm,
      maxHeight: '85%',
      ...shadows.elevated,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.divider,
      marginBottom: spacing.md,
    },
    title: {
      color: t.textPrimary,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    subtitle: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '500',
      marginTop: 2,
      marginBottom: spacing.md,
    },
    note: {
      color: t.textSecondary,
      fontSize: 13.5,
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    scroll: { flexGrow: 0 },
    section: {
      color: t.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    rowActive: {
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
    radioActive: { borderColor: ACCENT },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },
    rowMid: { flex: 1, minWidth: 0 },
    rowTitle: { color: t.textPrimary, fontSize: 14.5, fontWeight: '700' },
    rowSub: { color: t.textMuted, fontSize: 12, fontWeight: '500', marginTop: 1 },
    rowRight: { alignItems: 'flex-end', marginLeft: 8 },
    rowResultLabel: { color: t.textMuted, fontSize: 10, fontWeight: '600' },
    rowResult: { color: t.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 1 },
    rowResultZero: { color: SUCCESS },
    primaryBtn: {
      backgroundColor: ACCENT,
      borderRadius: radius.lg,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  });
};
