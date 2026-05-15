// =============================================================================
// LinkContactModal
// Shown when a transaction is re-categorised to lent/borrow.
// Flow:
//   • Search contacts by name or phone number
//   • Tap a contact to confirm → uses saved name + primary phone
//   • If query is a number with no match → validate + let user save by number
//     (name field optional, defaults to "Friend")
// =============================================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import GradientButton from './GradientButton';
import { fetchContactsForPicker } from '../services/contactsService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a phone string to digits-only for comparison. */
const digitsOnly = (s) => (s || '').replace(/\D/g, '');

/**
 * Basic phone validation:
 *   • After stripping non-digits (and leading country codes 91/1)
 *     the number must be 10 digits.
 *   • Indian mobile: starts with 6-9 after normalisation.
 * Returns null if valid, or an error message string.
 */
const validatePhone = (raw) => {
  if (!raw || !raw.trim()) return 'Phone number is required.';
  let digits = digitsOnly(raw.trim());
  // Strip country code: +91 or 91 prefix for Indian numbers
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return 'Enter a valid 10-digit phone number.';
  if (!/^[6-9]/.test(digits)) return 'Mobile numbers must start with 6–9.';
  return null;
};

/** Format a raw phone string for display (Indian: +91 XXXXX XXXXX). */
const formatPhone = (raw) => {
  let d = digitsOnly(raw);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return raw;
};

/** True if the query looks like the user is typing a phone number. */
const looksLikePhone = (q) => /^[\d\s\+\-\(\)]{3,}$/.test(q.trim());

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LinkContactModal = ({
  visible,
  categoryId,   // 'lent' | 'borrowed' | 'lent_settled' | 'borrow_repaid'
  onConfirm,    // ({ person, phone, contactId }) => void
  onSkip,       // () => void
  onClose,      // () => void
}) => {
  const [contacts, setContacts]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [query, setQuery]                 = useState('');
  const [selected, setSelected]           = useState(null);  // { id, name, phone }
  const [manualPhone, setManualPhone]     = useState('');
  const [manualName, setManualName]       = useState('');
  const [phoneError, setPhoneError]       = useState('');

  // Load contacts once when modal opens
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSelected(null);
    setManualPhone('');
    setManualName('');
    setPhoneError('');
    setLoading(true);
    fetchContactsForPicker()
      .then(setContacts)
      .finally(() => setLoading(false));
  }, [visible]);

  // ── Filtered contacts ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts.slice(0, 40); // show first 40 before any query
    return contacts.filter((c) => c.searchText.includes(q)).slice(0, 30);
  }, [contacts, query]);

  const isPhoneQuery = looksLikePhone(query);
  const hasContactMatch = filtered.length > 0;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelectContact = useCallback((contact) => {
    setSelected({
      id: contact.id,
      name: contact.name,
      phone: contact.phones[0] || '',
    });
  }, []);

  const handleConfirmContact = useCallback(() => {
    if (!selected) return;
    onConfirm({ person: selected.name, phone: selected.phone, contactId: selected.id });
  }, [selected, onConfirm]);

  const isLent = categoryId === 'lent' || categoryId === 'lent_settled';
  const title  = isLent ? 'Who did you lend to?' : 'Who did you borrow from?';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>

          {/* ── Selected contact card ── */}
          {selected ? (
            <View style={styles.selectedCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{selected.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedName}>{selected.name}</Text>
                {selected.phone ? (
                  <Text style={styles.selectedPhone}>{formatPhone(selected.phone)}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.changeBtn}>
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* ── Search input ── */}
              <View style={styles.searchRow}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  value={query}
                  onChangeText={(v) => { setQuery(v); setPhoneError(''); }}
                  placeholder="Search by name or phone number"
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  autoFocus
                  keyboardType={isPhoneQuery ? 'phone-pad' : 'default'}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
                    <Text style={styles.clearBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ── Contact list ── */}
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : hasContactMatch ? (
                <FlatList
                  data={filtered}
                  keyExtractor={(c) => c.id}
                  style={styles.contactList}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={() => handleSelectContact(item)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName}>{item.name}</Text>
                        {item.phones[0] ? (
                          <Text style={styles.contactPhone}>{formatPhone(item.phones[0])}</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  )}
                  ListFooterComponent={
                    isPhoneQuery ? (
                      <TouchableOpacity
                        style={styles.useNumberRow}
                        onPress={() => { setManualPhone(query); setQuery(''); }}
                      >
                        <Text style={styles.useNumberText}>
                          Use "{query.trim()}" as phone instead
                        </Text>
                      </TouchableOpacity>
                    ) : null
                  }
                />
              ) : (
                /* ── No contact match — manual phone entry ── */
                <View style={styles.manualBox}>
                  {isPhoneQuery && query.trim() ? (
                    <Text style={styles.manualHint}>
                      No contact found for "{query.trim()}"
                    </Text>
                  ) : query.trim() ? (
                    <Text style={styles.manualHint}>No match — enter a number below</Text>
                  ) : (
                    <Text style={styles.manualHint}>
                      Start typing a name or number to search contacts
                    </Text>
                  )}

                  <Text style={styles.fieldLabel}>Phone number</Text>
                  <TextInput
                    value={manualPhone || (isPhoneQuery ? query : '')}
                    onChangeText={(v) => { setManualPhone(v); setPhoneError(''); }}
                    placeholder="e.g. 98765 43210"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    style={[styles.textInput, phoneError && styles.textInputError]}
                  />
                  {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                  <Text style={styles.fieldLabel}>
                    Name <Text style={styles.optionalLabel}>(optional — defaults to "Friend")</Text>
                  </Text>
                  <TextInput
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="Friend"
                    placeholderTextColor={colors.textMuted}
                    style={styles.textInput}
                  />
                </View>
              )}
            </>
          )}

          {/* ── Action buttons ── */}
          {selected ? (
            <GradientButton
              title="Confirm"
              onPress={handleConfirmContact}
              style={{ marginTop: spacing.md }}
            />
          ) : (!hasContactMatch && !loading && (manualPhone.trim() || (isPhoneQuery && query.trim()))) ? (
            <GradientButton
              title="Save & link"
              onPress={() => {
                const phone = manualPhone.trim() || query.trim();
                const err = validatePhone(phone);
                if (err) { setPhoneError(err); return; }
                setPhoneError('');
                const person = manualName.trim() || 'Friend';
                onConfirm({ person, phone: formatPhone(phone), contactId: null });
              }}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
            <Text style={styles.skipText}>Skip — just change category</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '85%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchIcon: { fontSize: 16, marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },
  clearBtn: { padding: spacing.xs },
  clearBtnText: { color: colors.textMuted, fontSize: 14 },

  // Contact list
  contactList: { maxHeight: 280 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary + '22',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  contactName: { ...typography.bodyBold, color: colors.textPrimary },
  contactPhone: { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },

  useNumberRow: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing.xs,
  },
  useNumberText: { ...typography.small, color: colors.primary, fontWeight: '700' },

  // Selected card
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '10',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '44',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  selectedName: { ...typography.bodyBold, color: colors.textPrimary },
  selectedPhone: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  changeBtn: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  changeBtnText: { ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },

  // Manual entry
  manualBox: { gap: spacing.xs, marginBottom: spacing.sm },
  manualHint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  fieldLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600', marginTop: spacing.sm },
  optionalLabel: { fontWeight: '400', color: colors.textMuted },
  textInput: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.divider,
    marginTop: spacing.xs,
  },
  textInputError: { borderColor: colors.danger },
  errorText: { ...typography.tiny, color: colors.danger, marginTop: spacing.xs },

  skipBtn: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  skipText: { ...typography.small, color: colors.textSecondary, textDecorationLine: 'underline' },
});

export default LinkContactModal;
