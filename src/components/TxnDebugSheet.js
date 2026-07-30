// =============================================================================
// TxnDebugSheet — preview-only bottom sheet
// Long-press any transaction to open this. Shows the raw SMS that produced it
// and all the fields the parser extracted + the merchantEnricher overlay.
// Gate at call site with IS_PREVIEW_BUILD before rendering.
// =============================================================================

import React, { useRef, useEffect } from 'react';
import {
  Modal, View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Animated, Easing, Pressable, Clipboard,
} from 'react-native';

import { radius, spacing, typography } from '../constants/theme';
import SheetCloseButton from './SheetCloseButton';
import { formatCurrency } from '../utils/format';

const TxnDebugSheet = ({ txn, onClose }) => {
  const slideY = useRef(new Animated.Value(400)).current;
  const fade   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (txn) {
      Animated.parallel([
        Animated.timing(fade,   { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideY, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fade,   { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(slideY, { toValue: 400, duration: 160, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [!!txn]);

  if (!txn) return null;

  const loc = txn.location;
  const locStr = loc && typeof loc.latitude === 'number'
    ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`
    : '—';

  const rows = [
    ['type',        txn.type],
    ['amount',      formatCurrency(txn.amount)],
    ['accountType', txn.accountType],
    ['accountMask', txn.accountMask || '—'],
    ['rawMerchant', txn.rawMerchant || '—'],
    ['merchant',    txn.merchant || '—'],
    ['parentCat',   txn.parentCategory || '—'],
    ['childCat',    txn.childCategory  || '—'],
    ['categoryId',  txn.categoryId || '—'],
    ['isSubscr.',   txn.isSubscription ? 'yes' : 'no'],
    ['selfDualLeg', txn.selfDualLeg ? 'yes' : 'no'],
    ['transferRef', txn.transferRef || '—'],
    ['location',    locStr],
    ['smsId',       txn.smsId || '—'],
    ['sender',      txn.rawSender || '—'],
  ];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]}>
        <SheetCloseButton onPress={onClose} variant="absolute" />
        <View style={styles.handleRow}>
          <View style={styles.handle} />
          <Text style={styles.badge}>🔬 DEBUG</Text>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Raw SMS */}
          <Text style={styles.sectionLabel}>RAW SMS</Text>
          <View style={styles.rawBox}>
            <Text style={styles.rawText} selectable>{txn.rawSms || '(not stored)'}</Text>
          </View>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => { Clipboard.setString(txn.rawSms || ''); }}
            activeOpacity={0.7}
          >
            <Text style={styles.copyBtnText}>Copy SMS</Text>
          </TouchableOpacity>

          {/* Parsed fields */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>PARSED FIELDS</Text>
          <View style={styles.table}>
            {rows.map(([key, val]) => (
              <View key={key} style={styles.tableRow}>
                <Text style={styles.tableKey}>{key}</Text>
                <Text style={styles.tableVal} selectable numberOfLines={1}>{String(val)}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

export default TxnDebugSheet;

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000070',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: '#16161A',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 36,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#FFFFFF33',
  },
  badge: {
    position: 'absolute',
    right: 0,
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scroll: { flex: 1 },
  sectionLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  rawBox: {
    backgroundColor: '#0D0D10',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FFFFFF14',
    padding: 12,
  },
  rawText: {
    color: '#D1FAE5',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  copyBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF10',
    borderWidth: 1,
    borderColor: '#FFFFFF18',
  },
  copyBtnText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  table: {
    backgroundColor: '#0D0D10',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FFFFFF14',
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF0A',
  },
  tableKey: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '600',
    width: 90,
    fontFamily: 'monospace',
  },
  tableVal: {
    color: '#E5E7EB',
    fontSize: 12,
    flex: 1,
    fontFamily: 'monospace',
  },
  closeBtn: {
    marginTop: spacing.md,
    backgroundColor: '#FFFFFF12',
    borderRadius: radius.lg,
    paddingVertical: 13,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFFBB',
    fontSize: 15,
    fontWeight: '600',
  },
});
