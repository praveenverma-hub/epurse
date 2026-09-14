// =============================================================================
// ContactPickerSheet — the app's ONE "search your contacts, pick one" sheet.
//
// Extracted (Sep-14-26) from LbEntryForm.js, which had this exact Modal +
// search + FlatList inline — and the reminder form needed the identical thing
// to let a custom reminder be tied to a person. Per the shared-component rule
// (needed in >1 file ⇒ one component, never a second copy): both callers now
// use this, neither hand-rolls its own contact list or permission dance.
//
// Talks to `services/contactsService` only — it owns permission + fetch, this
// component owns the UI: search, the list, and the "access needed" state.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Linking,
} from 'react-native';

import { radius, spacing, shadows, typography as typographyBase } from '../constants/theme';
import type { TextStyle } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import SheetCloseButton from './SheetCloseButton';
import {
  fetchContactsForPicker,
  requestContactsPermissionMeta,
} from '../services/contactsService';

const typography = typographyBase as unknown as Record<string, TextStyle>;

export interface PickedContact {
  id: string;
  name: string;
  phones: string[];
}

interface Props {
  visible: boolean;
  onSelect: (contact: PickedContact) => void;
  onClose: () => void;
  title?: string;
}

const ContactPickerSheet: React.FC<Props> = ({ visible, onSelect, onClose, title = 'Pick a contact' }) => {
  const theme = useTheme();

  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [loading, setLoading] = useState(false);
  // null = not checked yet; true/false = the LAST known answer. `canAskAgain`
  // decides the denied-state button: prompt again, or send them to Settings
  // (iOS never re-prompts after one denial, matching SplitConfigModal's rule).
  const [denied, setDenied] = useState<{ canAskAgain: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { granted, canAskAgain } = await requestContactsPermissionMeta();
    if (!granted) {
      setDenied({ canAskAgain });
      setLoading(false);
      return;
    }
    setDenied(null);
    const list = await fetchContactsForPicker();
    setContacts(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    load();
  }, [visible, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phones.some((p) => p.includes(q))) : contacts;
    return base.slice(0, 60);
  }, [contacts, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <SheetCloseButton onPress={onClose} variant="absolute" />
          <View style={[styles.handle, { backgroundColor: theme.divider }]} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>

          {denied ? (
            <View style={styles.deniedWrap}>
              <Text style={[styles.deniedTitle, { color: theme.textPrimary }]}>Contacts access needed</Text>
              <Text style={[styles.deniedSubtitle, { color: theme.textSecondary }]}>
                Allow contacts access so you can pick someone from your list.
              </Text>
              <TouchableOpacity
                style={[styles.deniedBtn, { backgroundColor: theme.primary }]}
                onPress={() => (denied.canAskAgain ? load() : Linking.openSettings())}
                activeOpacity={0.85}
              >
                <Text style={styles.deniedBtnText}>
                  {denied.canAskAgain ? 'Allow Contacts Access' : 'Open Settings'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search name or number…"
                placeholderTextColor={theme.textMuted}
                style={[styles.search, { color: theme.textPrimary, borderColor: theme.divider, backgroundColor: theme.background }]}
              />
              {loading ? (
                <ActivityIndicator style={styles.loading} color={theme.primary} />
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={(c) => c.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.list}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.row, { borderBottomColor: theme.divider }]}
                      onPress={() => onSelect(item)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.avatar, { backgroundColor: theme.primary + '1F' }]}>
                        <Text style={[styles.avatarText, { color: theme.primary }]}>
                          {item.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.rowMid}>
                        <Text style={[styles.rowName, { color: theme.textPrimary }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {item.phones[0] ? (
                          <Text style={[styles.rowPhone, { color: theme.textSecondary }]} numberOfLines={1}>
                            {item.phones[0]}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={[styles.empty, { color: theme.textMuted }]}>No contacts found.</Text>
                  }
                />
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

export default ContactPickerSheet;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000073', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 32,
    maxHeight: '75%',
    ...shadows.sheet,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  title: { ...typography.h3, fontWeight: '700', marginBottom: spacing.sm },

  search: {
    ...typography.body,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  loading: { marginVertical: 32 },
  list: { maxHeight: 380 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.bodyBold, fontWeight: '700' },
  rowMid: { flex: 1 },
  rowName: { ...typography.bodyBold, fontWeight: '600' },
  rowPhone: { ...typography.small, marginTop: 2 },
  empty: { ...typography.body, textAlign: 'center', marginTop: spacing.lg },

  deniedWrap: { alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  deniedTitle: { ...typography.bodyBold, fontWeight: '700', marginBottom: spacing.xs },
  deniedSubtitle: { ...typography.small, textAlign: 'center', lineHeight: 18, marginBottom: spacing.lg },
  deniedBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg },
  deniedBtnText: { ...typography.bodyBold, color: '#fff', fontWeight: '800' },
});
