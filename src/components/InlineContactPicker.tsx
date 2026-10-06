// =============================================================================
// InlineContactPicker — search your contacts and tap one, rendered IN the page
// (no Modal, no extra level). Owns the permission + fetch like ContactPickerSheet
// does; the caller owns what "picking" means.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, DIVIDER_W } from '../constants/theme';
import { useFocusBorder } from './FormField';
import {
  fetchContactsForPicker,
  getContactsPermissionStatus,
  requestContactsPermissionMeta,
} from '../services/contactsService';

export interface InlineContact {
  id: string;
  name: string;
  phones: string[];
  searchText?: string;
}

interface Props {
  onPick: (c: InlineContact) => void;
  /** Contact ids already chosen — hidden from the results. */
  excludeIds?: string[];
  accentColor?: string;
  autoFocus?: boolean;
}

const MAX_RESULTS = 6;

export default function InlineContactPicker({ onPick, excludeIds = [], accentColor = colors.primary, autoFocus }: Props) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<InlineContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [granted, setGranted] = useState(true);
  const focus = useFocusBorder();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await getContactsPermissionStatus();
      setGranted(ok);
      setContacts(ok ? await fetchContactsForPicker() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const skip = new Set(excludeIds);
    return contacts
      .filter((c) => !skip.has(c.id) && (!q || (c.searchText || c.name.toLowerCase()).includes(q)))
      .slice(0, MAX_RESULTS);
  }, [contacts, query, excludeIds]);

  const askAccess = async () => {
    const { granted: ok, canAskAgain } = await requestContactsPermissionMeta();
    if (ok) load();
    else if (!canAskAgain) Linking.openSettings();
  };

  if (!loading && !granted) {
    return (
      <View style={styles.denied}>
        <Text style={styles.deniedText}>Allow contacts access to choose people from your address book.</Text>
        <TouchableOpacity style={[styles.permBtn, { borderColor: accentColor }]} onPress={askAccess} activeOpacity={0.8}>
          <Text style={[styles.permText, { color: accentColor }]}>Allow Contacts Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.searchBox, focus.focusStyle]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or number"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoFocus={autoFocus}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginVertical: spacing.lg }} color={accentColor} />
      ) : results.length === 0 ? (
        <Text style={styles.empty}>{query.trim() ? 'No matches. Try another search.' : 'No contacts to show.'}</Text>
      ) : (
        <View style={styles.list}>
          {results.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.row, i > 0 && styles.rowDivider]}
              onPress={() => onPick(c)}
              activeOpacity={0.8}
            >
              <View style={[styles.avatar, { backgroundColor: accentColor + '1A' }]}>
                <Text style={[styles.avatarText, { color: accentColor }]}>{c.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                {c.phones?.[0] ? <Text style={styles.phone} numberOfLines={1}>{c.phones[0]}</Text> : null}
              </View>
              <Ionicons name="add-circle-outline" size={22} color={accentColor} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: 15, color: colors.textPrimary },
  list: { marginTop: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowDivider: { borderTopWidth: DIVIDER_W, borderTopColor: colors.divider },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  phone: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  empty: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  denied: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  deniedText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  permBtn: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  permText: { fontSize: 14, fontWeight: '700' },
});
