// Minimal in-memory chrome.* stub for unit tests.
type Store = Record<string, unknown>;
function area(): chrome.storage.StorageArea {
  let data: Store = {};
  return {
    get: async (keys?: string | string[] | null) => {
      if (keys == null) return { ...data };
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    set: async (items: Store) => {
      data = { ...data, ...structuredClone(items) };
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    clear: async () => {
      data = {};
    },
  } as unknown as chrome.storage.StorageArea;
}

export function installChromeStub() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area(), session: area(), onChanged: { addListener() {}, removeListener() {} } },
    runtime: { id: "test", getURL: (p: string) => `chrome-extension://test/${p}` },
  };
}
