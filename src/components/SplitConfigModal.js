import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';
import GradientButton from './GradientButton';
import { formatCurrency } from '../utils/format';
import { canSplitTransaction } from '../utils/split';
import { useToast } from './Toast';
import CenterModal from './CenterModal';
import {
  fetchContactsForPicker,
  getContactsPermissionStatus,
  requestContactsPermissionMeta,
} from '../services/contactsService';

/**
 * Configure split (you + selected contacts).
 * `onApply(others, meta)` where meta = { mode: 'percent'|'amount', myPercent?: number, myAmount?: number }
 */
const SplitConfigModal = ({ visible, transaction, onClose, onApply }) => {
  const toast = useToast();
  const [confirm, setConfirm] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('percent'); // 'percent' | 'amount'
  const [selected, setSelected] = useState(new Map()); // id -> { contactId, name, percent, shareAmount }
  const [myPercent, setMyPercent] = useState(100);
  const [myAmount, setMyAmount] = useState(0);

  const amount = Number(transaction?.amount) || 0;

  const equalisePercents = useCallback((nextSelectedSize) => {
    const n = 1 + nextSelectedSize;
    if (n <= 0) return { my: 100, each: 0 };
    const base = Math.floor(100 / n);
    const rem = 100 - base * n; // distribute to earliest rows: You then contacts
    const my = base + (rem > 0 ? 1 : 0);
    const each = base;
    return { my, each, rem };
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await getContactsPermissionStatus();
      if (!ok) {
        setContacts([]);
        setLoading(false);
        return;
      }
      const list = await fetchContactsForPicker();
      setContacts(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      return;
    }
    const initial = new Map();
    if (transaction?.isSplit && transaction?.splitWith?.length && amount > 0) {
      setMode('percent');
      // restore from existing split amounts
      const myAmt = typeof transaction.myShareAmount === 'number' ? transaction.myShareAmount : null;
      const myP = myAmt != null ? Math.round((myAmt / amount) * 100) : null;
      setMyPercent(myP != null && !Number.isNaN(myP) ? myP : 50);
      setMyAmount(myAmt != null ? Number(myAmt) : 0);

      transaction.splitWith.forEach((p, i) => {
        const id = p.contactId || `legacy_${i}`;
        const pPct = p?.shareAmount != null ? Math.round((Number(p.shareAmount) / amount) * 100) : null;
        initial.set(id, {
          contactId: p.contactId,
          name: p.name,
          percent: pPct != null && !Number.isNaN(pPct) ? pPct : 0,
          shareAmount: Number(p.shareAmount) || 0,
        });
      });
    } else if (transaction?.splitWith?.length) {
      setMode('percent');
      // draft (e.g. AddTransactionScreen preview)
      transaction.splitWith.forEach((p, i) => {
        initial.set(p.contactId || `legacy_${i}`, {
          contactId: p.contactId,
          name: p.name,
          percent: 0,
          shareAmount: 0,
        });
      });
      const { my, each, rem } = equalisePercents(initial.size);
      setMyPercent(my);
      setMyAmount(amount ? (amount * my) / 100 : 0);
      let idx = 0;
      initial.forEach((v, k) => {
        const p = each + (idx + 1 < rem ? 1 : 0);
        initial.set(k, { ...v, percent: p, shareAmount: amount ? (amount * p) / 100 : 0 });
        idx += 1;
      });
    } else {
      setMode('percent');
      setMyPercent(100);
      setMyAmount(amount || 0);
    }

    // If this is a brand-new selection, initialise to equal split.
    if (!transaction?.isSplit) {
      const { my, each, rem } = equalisePercents(initial.size);
      setMyPercent(my);
      setMyAmount(amount ? (amount * my) / 100 : 0);
      let idx = 0;
      initial.forEach((v, k) => {
        const p = each + (idx + 1 < rem ? 1 : 0);
        initial.set(k, { ...v, percent: p, shareAmount: amount ? (amount * p) / 100 : 0 });
        idx += 1;
      });
    }

    setSelected(initial);
    loadContacts();
  }, [visible, transaction?.id, transaction?.amount, transaction?.categoryId, loadContacts, amount, equalisePercents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => ((c.searchText || c.name.toLowerCase()).includes(q)));
  }, [contacts, query]);

  const topSuggestions = useMemo(() => {
    if (!query.trim()) return [];
    return filtered.slice(0, 1);
  }, [filtered, query]);

  const toggleContact = useCallback((c) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, { contactId: c.id, name: c.name, percent: 0, shareAmount: 0 });

      const { my, each, rem } = equalisePercents(next.size);
      setMyPercent(my);
      setMyAmount(amount ? (amount * my) / 100 : 0);
      let idx = 0;
      next.forEach((v, k) => {
        const p = each + (idx + 1 < rem ? 1 : 0);
        next.set(k, { ...v, percent: p, shareAmount: amount ? (amount * p) / 100 : 0 });
        idx += 1;
      });
      return next;
    });
    setQuery('');
  }, [amount, equalisePercents]);

  const selectedList = useMemo(() => Array.from(selected.entries()), [selected]);
  const sumOthers = useMemo(
    () => selectedList.reduce((s, [, v]) => s + (Number(v.percent) || 0), 0),
    [selectedList]
  );
  const sumAll = sumOthers + (Number(myPercent) || 0);
  const sumOthersAmt = useMemo(
    () => selectedList.reduce((s, [, v]) => s + (Number(v.shareAmount) || 0), 0),
    [selectedList]
  );
  const sumAllAmt = sumOthersAmt + (Number(myAmount) || 0);
  const valid =
    selectedList.length > 0 &&
    (mode === 'percent' ? sumAll === 100 : Math.abs(sumAllAmt - amount) <= 0.01);

  const setOtherPercent = useCallback((id, raw) => {
    const v = Math.max(0, Math.min(100, parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0));
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      next.set(id, { ...cur, percent: v, shareAmount: amount ? (amount * v) / 100 : 0 });
      return next;
    });
  }, [amount]);

  const setOtherAmount = useCallback((id, raw) => {
    const v = Math.max(0, parseFloat(String(raw || '').replace(/[^\d.]/g, '')) || 0);
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      next.set(id, { ...cur, shareAmount: v });
      return next;
    });
  }, []);

  const removeSelected = useCallback((id) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      const { my, each, rem } = equalisePercents(next.size);
      setMyPercent(my);
      setMyAmount(amount ? (amount * my) / 100 : 0);
      let idx = 0;
      next.forEach((v, k) => {
        const p = each + (idx + 1 < rem ? 1 : 0);
        next.set(k, { ...v, percent: p, shareAmount: amount ? (amount * p) / 100 : 0 });
        idx += 1;
      });
      return next;
    });
  }, [amount, equalisePercents]);

  const setModeSafe = useCallback(
    (m) => {
      if (m === mode) return;
      setMode(m);
      if (m === 'amount') {
        setMyAmount(amount ? (amount * (Number(myPercent) || 0)) / 100 : 0);
        setSelected((prev) => {
          const next = new Map(prev);
          next.forEach((v, k) => {
            const p = Number(v.percent) || 0;
            next.set(k, { ...v, shareAmount: amount ? (amount * p) / 100 : 0 });
          });
          return next;
        });
      } else {
        const safePct = (a) => (amount > 0 ? Math.round((Number(a || 0) / amount) * 100) : 0);
        setMyPercent(safePct(myAmount));
        setSelected((prev) => {
          const next = new Map(prev);
          next.forEach((v, k) => next.set(k, { ...v, percent: safePct(v.shareAmount) }));
          return next;
        });
      }
    },
    [amount, mode, myAmount, myPercent]
  );

  const handleRequestAccess = async () => {
    const { granted, canAskAgain } = await requestContactsPermissionMeta();
    if (granted) {
      loadContacts();
    } else if (!canAskAgain || Platform.OS === 'ios') {
      setConfirm({
        title:         'Contacts access',
        message:       'Enable Contacts for ePurse in Settings to pick people for splits.',
        primaryText:   'Settings',
        secondaryText: 'Cancel',
        onConfirm:     () => { setConfirm(null); Linking.openSettings(); },
      });
    }
  };

  const handleApply = () => {
    const others = Array.from(selected.values());
    if (others.length === 0) {
      toast.warning('Pick someone', 'Select at least one person to split with.');
      return;
    }
    if (!valid) {
      toast.warning(
        mode === 'percent' ? 'Fix percentages' : 'Fix amounts',
        mode === 'percent'
          ? 'Your % shares must add up to 100.'
          : 'Your ₹ shares must add up to the total amount.',
      );
      return;
    }
    if (mode === 'amount') {
      onApply(
        others.map((o) => ({
          contactId: o.contactId ?? null,
          name: o.name,
          shareAmount: Number(o.shareAmount) || 0,
        })),
        { mode: 'amount', myAmount: Number(myAmount) || 0 }
      );
    } else {
      onApply(
        others.map((o) => ({
          contactId: o.contactId ?? null,
          name: o.name,
          percent: Number(o.percent) || 0,
        })),
        { mode: 'percent', myPercent: Number(myPercent) || 0 }
      );
    }
    onClose();
  };

  const handleClear = () => {
    onApply([]);
    onClose();
  };

  const n = 1 + selected.size;
  const shareHint =
    transaction?.amount != null
      ? `Split: ${n} people · total ${formatCurrency(transaction.amount)}`
      : '';

  const blocked = transaction && !canSplitTransaction(transaction);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          <View style={styles.titleRow}>
            <Text style={styles.title}>Split expense</Text>
            {transaction?.isSplit ? (
              <TouchableOpacity style={styles.clearBtnTop} onPress={handleClear}>
                <Text style={styles.clearText}>Remove split</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {transaction?.merchant ? (
            <Text style={styles.sub} numberOfLines={1}>
              {transaction.merchant} · {formatCurrency(transaction.amount)}
            </Text>
          ) : null}
          {blocked ? (
            <Text style={styles.warn}>Split isn&apos;t available for credits or lend/borrow categories.</Text>
          ) : (
            <Text style={styles.hint}>{shareHint}</Text>
          )}

          {!blocked && (
            <>
              <View style={styles.selectedBox}>
                <View style={styles.selectedHeaderRow}>
                  <Text style={styles.selectedTitle}>Selected</Text>
                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[styles.modeChip, mode === 'percent' && styles.modeChipOn]}
                      onPress={() => setModeSafe('percent')}
                    >
                      <Text style={[styles.modeChipTxt, mode === 'percent' && styles.modeChipTxtOn]}>%</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeChip, mode === 'amount' && styles.modeChipOn]}
                      onPress={() => setModeSafe('amount')}
                    >
                      <Text style={[styles.modeChipTxt, mode === 'amount' && styles.modeChipTxtOn]}>₹</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.selRow}>
                  <View style={styles.selLeft}>
                    <Text style={styles.selName}>You</Text>
                    <Text style={styles.selAmt}>
                      {mode === 'amount'
                        ? (amount ? formatCurrency(myAmount) : '')
                        : (amount ? formatCurrency((amount * (Number(myPercent) || 0)) / 100) : '')}
                    </Text>
                  </View>
                  <View style={styles.pctWrap}>
                    {mode === 'amount' ? (
                      <>
                        <TextInput
                          value={String(myAmount ?? 0)}
                          onChangeText={(t) => {
                            const v = Math.max(0, parseFloat(String(t || '').replace(/[^\d.]/g, '')) || 0);
                            setMyAmount(v);
                          }}
                          keyboardType="decimal-pad"
                          style={[styles.pctInput, styles.valueInputWide]}
                        />
                        <Text style={styles.pctSuffix}>₹</Text>
                      </>
                    ) : (
                      <>
                        <TextInput
                          value={String(myPercent)}
                          onChangeText={(t) => {
                            const v = Math.max(0, Math.min(100, parseInt(String(t || '').replace(/[^\d]/g, ''), 10) || 0));
                            setMyPercent(v);
                          }}
                          keyboardType="number-pad"
                          style={styles.pctInput}
                        />
                        <Text style={styles.pctSuffix}>%</Text>
                      </>
                    )}
                  </View>
                </View>

                {selectedList.length === 0 ? (
                  <Text style={styles.selectedEmpty}>Pick contacts below to start splitting.</Text>
                ) : (
                  selectedList.map(([id, p]) => (
                    <View key={id} style={styles.selRow}>
                      <View style={styles.selLeft}>
                        <Text style={styles.selName} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.selAmt}>
                          {mode === 'amount'
                            ? (amount ? formatCurrency(Number(p.shareAmount) || 0) : '')
                            : (amount ? formatCurrency((amount * (Number(p.percent) || 0)) / 100) : '')}
                        </Text>
                      </View>
                      <View style={styles.pctWrap}>
                        {mode === 'amount' ? (
                          <>
                            <TextInput
                              value={String(p.shareAmount ?? 0)}
                              onChangeText={(t) => setOtherAmount(id, t)}
                              keyboardType="decimal-pad"
                              style={[styles.pctInput, styles.valueInputWide]}
                            />
                            <Text style={styles.pctSuffix}>₹</Text>
                          </>
                        ) : (
                          <>
                            <TextInput
                              value={String(p.percent ?? 0)}
                              onChangeText={(t) => setOtherPercent(id, t)}
                              keyboardType="number-pad"
                              style={styles.pctInput}
                            />
                            <Text style={styles.pctSuffix}>%</Text>
                          </>
                        )}
                        <TouchableOpacity style={styles.removeBtn} onPress={() => removeSelected(id)}>
                          <Text style={styles.removeTxt}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                <Text style={[styles.sumHint, valid ? styles.sumOk : styles.sumBad]}>
                  {mode === 'amount'
                    ? `Total: ${formatCurrency(sumAllAmt)} ${valid ? '✓' : `(must be ${formatCurrency(amount)})`}`
                    : `Total: ${sumAll}% ${valid ? '✓' : '(must be 100%)'}`}
                </Text>
              </View>

              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search name or number"
                placeholderTextColor={colors.textMuted}
                style={styles.search}
              />

              {loading ? (
                <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} />
              ) : contacts.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    No contacts loaded. Allow access to choose people from your address book.
                  </Text>
                  <TouchableOpacity style={styles.permBtn} onPress={handleRequestAccess}>
                    <Text style={styles.permBtnText}>Allow contacts access</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.suggestBox}>
                  {query.trim() && topSuggestions.length === 0 ? (
                    <Text style={styles.emptyText}>No matches. Try another search.</Text>
                  ) : query.trim() ? (
                    topSuggestions.map((item) => {
                      const on = selected.has(item.id);
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={[styles.row, on && styles.rowOn]}
                          onPress={() => toggleContact(item)}
                        >
                          <View style={styles.avatar}>
                            <Text style={styles.avatarTxt}>{item.name.charAt(0).toUpperCase()}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>
                              {item.name}
                            </Text>
                            {item.phones?.[0] ? (
                              <Text style={styles.phone} numberOfLines={1}>
                                {item.phones[0]}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={styles.check}>{on ? '✓' : ''}</Text>
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyText}>Search to find a contact.</Text>
                  )}
                </View>
              )}

            </>
          )}
          </ScrollView>

          {/* Pinned footer — Cancel + Apply side by side. */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            {!blocked && (
              <GradientButton
                title={selected.size === 0 ? 'Select people' : 'Apply split'}
                onPress={handleApply}
                disabled={selected.size === 0 || loading || !valid}
                style={styles.submitBtn}
              />
            )}
          </View>
        </View>
      </View>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        onSecondary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sub: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  warn: { ...typography.small, color: colors.warning, marginBottom: spacing.md },
  clearBtnTop: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.danger + '12',
    borderWidth: 1,
    borderColor: colors.danger + '33',
  },
  clearText: { color: colors.danger, ...typography.small, fontWeight: '700' },
  selectedBox: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  selectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  selectedTitle: { ...typography.small, color: colors.textSecondary, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: spacing.xs },
  modeChip: {
    minWidth: 36,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modeChipOn: { backgroundColor: colors.primary + '14', borderColor: colors.primary + '66' },
  modeChipTxt: { ...typography.small, color: colors.textSecondary, fontWeight: '800' },
  modeChipTxtOn: { color: colors.primary },
  selectedEmpty: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
  selRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  selLeft: { flex: 1, paddingRight: spacing.md },
  selName: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  selAmt: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  pctWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pctInput: {
    width: 54,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'center',
    color: colors.textPrimary,
    ...typography.bodyBold,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  valueInputWide: {
    width: 96,
    textAlign: 'right',
    paddingHorizontal: 8,
  },
  pctSuffix: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger + '14',
    borderWidth: 1,
    borderColor: colors.danger + '33',
    marginLeft: 2,
  },
  removeTxt: { color: colors.danger, fontWeight: '900', fontSize: 16, lineHeight: 16 },
  sumHint: { ...typography.tiny, marginTop: spacing.xs, fontWeight: '700' },
  sumOk: { color: colors.success },
  sumBad: { color: colors.warning },
  search: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing.sm,
  },
  suggestBox: { gap: 4, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  rowOn: { backgroundColor: colors.primary + '14' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarTxt: { color: colors.primary, fontWeight: '800' },
  name: { flex: 1, ...typography.body, color: colors.textPrimary },
  nameOn: { fontWeight: '700', color: colors.primary },
  phone: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  check: { width: 28, color: colors.primary, fontWeight: '800', textAlign: 'right' },
  empty: { paddingVertical: spacing.lg, alignItems: 'center' },
  emptyText: { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  permBtn: {
    backgroundColor: colors.primary + '18',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
  },
  permBtnText: { color: colors.primary, fontWeight: '700' },
  // flexShrink lets the body yield height to the pinned footer when content is tall.
  body: { flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider,
  },
  cancelText: { color: colors.textSecondary, ...typography.bodyBold, fontWeight: '700' },
  submitBtn: { flex: 1 },
});

export default SplitConfigModal;
