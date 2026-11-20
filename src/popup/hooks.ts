import { useCallback, useEffect, useRef, useState } from "react";
import { bg } from "../shared/messages";
import { detectContext, type SiteContext, UNKNOWN_CONTEXT } from "../shared/rules";
import { getSettings, onSettingsChanged } from "../shared/settings";
import { DEFAULT_SETTINGS, IDLE_STATE, type AuthSummary, type RecState, type Settings } from "../shared/types";

/** Live recording state: reconciled by the worker on open, then pushed via storage change events. */
export function useRecState() {
  const [state, setState] = useState<RecState | null>(null);
  useEffect(() => {
    let alive = true;
    bg<RecState>({ type: "state:get" })
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ ...IDLE_STATE }));
    const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes["rec"]) setState((changes["rec"].newValue as RecState | undefined) ?? { ...IDLE_STATE });
    };
    chrome.storage.onChanged.addListener(l);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(l);
    };
  }, []);
  return state;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthSummary | null>(null);
  const refresh = useCallback(() => bg<AuthSummary>({ type: "auth:get" }).then(setAuth).catch(() => setAuth({ signedIn: false })), []);
  useEffect(() => {
    void refresh();
    // React immediately if Hear Me Out rejects (or re-accepts) this profile's key.
    const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes["authRejected"]) void refresh();
    };
    chrome.storage.onChanged.addListener(l);
    return () => chrome.storage.onChanged.removeListener(l);
  }, [refresh]);
  return { auth, setAuth, refresh };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    return onSettingsChanged(setSettings);
  }, []);
  return { settings, loaded };
}

export interface ActiveTab {
  id: number | null;
  url: string | null;
}

/**
 * The active tab of this window, re-read when the user switches tabs or the tab's URL changes
 * (SPA route changes included). Event-driven — no polling. The URL never leaves this popup.
 */
export function useActiveContext(settings: Settings): { ctx: SiteContext; tab: ActiveTab } {
  const [tab, setTab] = useState<ActiveTab>({ id: null, url: null });
  useEffect(() => {
    const read = () =>
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([t]) => setTab({ id: t?.id ?? null, url: t?.url ?? null }))
        .catch(() => undefined);
    void read();
    const onActivated = () => void read();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => {
      if (t.active && (info.url || info.status === "complete")) void read();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  const ctx = tab.url ? detectContext(tab.url, settings) : UNKNOWN_CONTEXT;
  return { ctx, tab };
}

/** Re-render ticker for the timer (display only — the value comes from recorded timestamps). */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), text, kind });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return { toast, show };
}

export type MicPermission = "granted" | "prompt" | "denied" | "unknown";

export function useMicPermission() {
  const [perm, setPerm] = useState<MicPermission>("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setPerm(status.state as MicPermission);
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setPerm("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);
  return perm;
}

export function openPermissionPage(autostart = false) {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`permission.html${autostart ? "?start=1" : ""}`) });
}
