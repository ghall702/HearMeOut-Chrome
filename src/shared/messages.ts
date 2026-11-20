// Typed messages between the popup, service worker and offscreen document.
/** Omit that distributes over unions (keeps each variant's own fields). */
export type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

import type { AuthSummary, RecState, RecordingItem, ShareFormat, StopReason } from "./types";

/** Popup / permission page → service worker. */
export type BgRequest =
  | { to: "bg"; type: "state:get" }
  | { to: "bg"; type: "rec:start" }
  | { to: "bg"; type: "rec:pause" }
  | { to: "bg"; type: "rec:resume" }
  | { to: "bg"; type: "rec:stop" }
  | { to: "bg"; type: "rec:discard" }
  | { to: "bg"; type: "rec:save"; title: string }
  | { to: "bg"; type: "rec:retry" }
  | { to: "bg"; type: "rec:new" }
  | { to: "bg"; type: "auth:get" }
  | { to: "bg"; type: "auth:signin" }
  | { to: "bg"; type: "auth:signout" }
  | { to: "bg"; type: "api:list" }
  | { to: "bg"; type: "api:get"; id: string };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Service worker → offscreen document. */
export type OffRequest =
  | { to: "offscreen"; type: "off:start"; draftId: string; deviceId: string; noiseSuppression: boolean }
  | { to: "offscreen"; type: "off:pause" }
  | { to: "offscreen"; type: "off:resume" }
  | { to: "offscreen"; type: "off:stop"; reason: StopReason }
  | { to: "offscreen"; type: "off:status" }
  | { to: "offscreen"; type: "off:upload"; draftId: string; url: string; headers: Record<string, string> }
  | { to: "offscreen"; type: "off:copy"; text: string; html?: string | undefined };

export interface OffStatus {
  recording: boolean;
  paused: boolean;
  draftId: string | null;
  uploading: boolean;
}

/** Offscreen document → service worker (events). */
export type OffEvent =
  | { to: "bg-event"; type: "rec:started"; draftId: string; startedAt: number; mime: string }
  | { to: "bg-event"; type: "rec:paused"; draftId: string; accumulatedMs: number }
  | { to: "bg-event"; type: "rec:resumed"; draftId: string; segmentStartedAt: number; accumulatedMs: number }
  | { to: "bg-event"; type: "rec:stopped"; draftId: string; accumulatedMs: number; bytes: number; reason: StopReason }
  | { to: "bg-event"; type: "upload:progress"; draftId: string; pct: number }
  | { to: "bg-event"; type: "upload:done"; draftId: string; status: number }
  | { to: "bg-event"; type: "upload:failed"; draftId: string; status: number; code: string; message: string };

export async function bg<T>(msg: DistOmit<BgRequest, "to">): Promise<T> {
  const r = (await chrome.runtime.sendMessage({ ...msg, to: "bg" })) as BgResponse<T> | undefined;
  if (!r) throw new Error("The extension background didn't respond. Please try again.");
  if (!r.ok) {
    const e = new Error(r.error) as Error & { code?: string };
    if (r.code) e.code = r.code;
    throw e;
  }
  return r.data;
}

export type { AuthSummary, RecState, RecordingItem, ShareFormat };
