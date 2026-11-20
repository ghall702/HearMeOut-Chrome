import { MAX_RECORDING_MS } from "./config";

/** Elapsed captured audio, derived from recorded timestamps rather than any UI timer. */
export function elapsedMs(s: { accumulatedMs: number; segmentStartedAt: number | null }, now = Date.now()): number {
  const live = s.segmentStartedAt != null ? Math.max(0, now - s.segmentStartedAt) : 0;
  return Math.min(MAX_RECORDING_MS, s.accumulatedMs + live);
}

export function remainingMs(s: { accumulatedMs: number; segmentStartedAt: number | null }, now = Date.now()): number {
  return Math.max(0, MAX_RECORDING_MS - elapsedMs(s, now));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Default title, e.g. "20 November 2026, 14:35". */
export function defaultTitle(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date}, ${time}`;
}

export function formatDate(iso: string | number): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}
