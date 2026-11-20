import type { Settings } from "../shared/types";

const KEY = "hmo-theme";
let mq: MediaQueryList | null = null;
let listener: (() => void) | null = null;

export function applyTheme(t: Settings["theme"]) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  mq ??= window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && mq!.matches));
  set();
  if (listener) mq.removeEventListener("change", listener);
  listener = t === "system" ? set : null;
  if (listener) mq.addEventListener("change", listener);
}

/** Applies the cached theme synchronously before first paint (no flash). */
export function bootTheme() {
  let t: Settings["theme"] = "system";
  try {
    t = (localStorage.getItem(KEY) as Settings["theme"] | null) ?? "system";
  } catch {
    /* ignore */
  }
  applyTheme(t);
}
