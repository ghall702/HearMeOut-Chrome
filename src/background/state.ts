// Shared recording state in chrome.storage.session: survives service-worker restarts, readable by
// the popup, and cleared automatically when Chrome exits (so a stale REC badge can never return).
import { IDLE_STATE, type Phase, type RecState } from "../shared/types";

const KEY = "rec";

export async function readState(): Promise<RecState> {
  const r = await chrome.storage.session.get(KEY);
  return (r[KEY] as RecState | undefined) ?? { ...IDLE_STATE };
}

export async function writeState(next: RecState | ((cur: RecState) => RecState)): Promise<RecState> {
  const cur = await readState();
  const value = { ...(typeof next === "function" ? next(cur) : next), updatedAt: Date.now() };
  await chrome.storage.session.set({ [KEY]: value });
  await applyBadge(value.phase);
  return value;
}

export async function patchState(patch: Partial<RecState>): Promise<RecState> {
  return writeState((cur) => ({ ...cur, ...patch }));
}

const BADGES: Partial<Record<Phase, { text: string; colour: string }>> = {
  recording: { text: "REC", colour: "#d93025" },
  paused: { text: "II", colour: "#b26a00" },
  uploading: { text: "…", colour: "#5f7d66" },
  saving: { text: "…", colour: "#5f7d66" },
  error: { text: "!", colour: "#b26a00" },
};

export async function applyBadge(phase: Phase) {
  const b = BADGES[phase];
  await chrome.action.setBadgeText({ text: b?.text ?? "" });
  if (b) {
    await chrome.action.setBadgeBackgroundColor({ color: b.colour });
    await chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  }
  await chrome.action.setTitle({
    title: phase === "recording" ? "Hear Me Out — recording" : phase === "paused" ? "Hear Me Out — paused" : "Hear Me Out",
  });
}
