// DeviceKv on MMKV, encrypted (AES-256) with the per-install key from SecureStore.
// Device only — tests and mock-data mode use createMemoryDeviceKv().

import { createMMKV } from 'react-native-mmkv';
import { getKvKey } from './keys';
import type { DeviceKv } from './deviceKv';

const instances = new Map<string, DeviceKv>();

export function getMmkvDeviceKv(id: string): DeviceKv {
  const hit = instances.get(id);
  if (hit) return hit;
  const mmkv = createMMKV({ id, encryptionKey: getKvKey().value, encryptionType: 'AES-256' });
  const kv: DeviceKv = {
    getString: (k) => mmkv.getString(k),
    set: (k, v) => mmkv.set(k, v),
    remove: (k) => { mmkv.remove(k); },
    getAllKeys: () => mmkv.getAllKeys(),
    clearAll: () => mmkv.clearAll(),
  };
  instances.set(id, kv);
  return kv;
}
