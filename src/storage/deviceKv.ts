// Synchronous key-value store for DEVICE-LOCAL state (MMKV on device). The subset of
// the MMKV API we use, so tests and mock-data mode can swap in memory. PURE.

export interface DeviceKv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  getAllKeys(): string[];
  clearAll(): void;
}

export function createMemoryDeviceKv(): DeviceKv {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
    getAllKeys: () => [...m.keys()],
    clearAll: () => { m.clear(); },
  };
}
