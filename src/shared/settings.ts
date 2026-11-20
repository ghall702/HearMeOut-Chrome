// Per-profile settings in chrome.storage.local (never sync). Contains no credentials.
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((r[KEY] as Partial<Settings> | undefined) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) fn({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  };
  chrome.storage.onChanged.addListener(l);
  return () => chrome.storage.onChanged.removeListener(l);
}
