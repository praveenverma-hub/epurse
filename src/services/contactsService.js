// =============================================================================
// Contacts — permission + read for split-with picker (Expo / iOS + Android)
// =============================================================================

import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts';

export async function getContactsPermissionStatus() {
  try {
    const { status } = await Contacts.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function requestContactsPermission() {
  try {
    const result = await Contacts.requestPermissionsAsync();
    return result.status === 'granted';
  } catch {
    return false;
  }
}

export async function requestContactsPermissionMeta() {
  try {
    const result = await Contacts.requestPermissionsAsync();
    return {
      granted: result.status === 'granted',
      status: result.status,
      canAskAgain: result.canAskAgain !== false,
    };
  } catch {
    return {
      granted: false,
      status: 'undetermined',
      canAskAgain: true,
    };
  }
}

/**
 * @returns {Promise<Array<{ id: string, name: string, phones: string[], searchText: string }>>}
 */
export async function fetchContactsForPicker() {
  if (Platform.OS === 'web') return [];

  const granted = await getContactsPermissionStatus();
  if (!granted) return [];

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });

  const out = [];
  const seen = new Set();
  for (const c of data || []) {
    if (!c.id || seen.has(c.id)) continue;
    const phonesRaw = Array.isArray(c.phoneNumbers) ? c.phoneNumbers : [];
    const phones = phonesRaw
      .map((p) => (p?.number ? String(p.number).trim() : ''))
      .filter(Boolean)
      .slice(0, 3);
    const name =
      (c.name && String(c.name).trim()) ||
      (c.phoneNumbers?.[0]?.number && String(c.phoneNumbers[0].number).trim()) ||
      '';
    if (!name) continue;
    seen.add(c.id);
    const cleanName = name.split('\n')[0].trim();
    const phoneText = phones.join(' ');
    out.push({
      id: c.id,
      name: cleanName,
      phones,
      searchText: `${cleanName} ${phoneText}`.toLowerCase(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}
