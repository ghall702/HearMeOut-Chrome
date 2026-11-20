// Recording orchestration. The service worker never touches audio; it tells the offscreen engine what
// to do and mirrors its state for the popup. Every step is persisted, so nothing depends on the
// service worker staying alive.
import { MAX_RECORDING_MS } from "../shared/config";
import { deleteDraft, draftBlob, getDraft, listDrafts, updateDraft } from "../shared/db";
import { getSettings } from "../shared/settings";
import { formatClock } from "../shared/timing";
import { IDLE_STATE, type RecState, type StopReason } from "../shared/types";
import { closeOffscreenIfIdle, ensureOffscreen, offStatus, sendOff } from "./offscreen-host";
import { readState, writeState, patchState } from "./state";
import { notify } from "./notify";
import { isPipelineRunning } from "./pipeline";

export class RecError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

const LIMIT_ALARM = "rec-limit";
let lock: Promise<unknown> = Promise.resolve();

/** Serialises state-changing operations within this service-worker lifetime. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function armLimitAlarm(s: Pick<RecState, "accumulatedMs" | "segmentStartedAt">) {
  await chrome.alarms.clear(LIMIT_ALARM);
  if (s.segmentStartedAt == null) return;
  // Backstop only — the offscreen engine enforces the limit itself.
  const when = s.segmentStartedAt + (MAX_RECORDING_MS - s.accumulatedMs) + 5_000;
  await chrome.alarms.create(LIMIT_ALARM, { when });
}

export function startRecording() {
  return serial(async () => {
    const s = await reconcile();
    if (s.phase === "recording" || s.phase === "paused") throw new RecError("already-recording", "A recording is already in progress.");
    if (s.draftId && s.phase !== "completed" && s.phase !== "idle")
      throw new RecError("unsaved", "Save or discard your current recording before starting a new one.");
    const settings = await getSettings();
    const draftId = crypto.randomUUID();
    await ensureOffscreen();
    let started: { startedAt: number; mime: string };
    try {
      started = await sendOff({ type: "off:start", draftId, deviceId: settings.micDeviceId, noiseSuppression: settings.noiseSuppression });
    } catch (e) {
      await deleteDraft(draftId).catch(() => undefined);
      await closeOffscreenIfIdle();
      const name = (e as Error).name;
      throw new RecError(name.startsWith("mic-") || name === "no-mic" ? name : "mic-error", (e as Error).message);
    }
    const next = await writeState({
      ...IDLE_STATE,
      phase: "recording",
      draftId,
      startedAt: started.startedAt,
      segmentStartedAt: started.startedAt,
      accumulatedMs: 0,
      mime: started.mime,
      updatedAt: Date.now(),
    });
    await armLimitAlarm(next);
    return next;
  });
}

export function pauseRecording() {
  return serial(async () => {
    const s = await readState();
    if (s.phase !== "recording") return s;
    const r = await sendOff<{ accumulatedMs: number }>({ type: "off:pause" });
    await chrome.alarms.clear(LIMIT_ALARM);
    return patchState({ phase: "paused", accumulatedMs: r.accumulatedMs, segmentStartedAt: null });
  });
}

export function resumeRecording() {
  return serial(async () => {
    const s = await readState();
    if (s.phase !== "paused") return s;
    const r = await sendOff<{ accumulatedMs: number; segmentStartedAt: number }>({ type: "off:resume" });
    const next = await patchState({ phase: "recording", accumulatedMs: r.accumulatedMs, segmentStartedAt: r.segmentStartedAt });
    await armLimitAlarm(next);
    return next;
  });
}

export function stopRecording(reason: StopReason = "user") {
  return serial(async () => {
    const s = await readState();
    if (s.phase !== "recording" && s.phase !== "paused") return s;
    try {
      const info = await sendOff<{ draftId: string; accumulatedMs: number; bytes: number; reason: StopReason }>({ type: "off:stop", reason });
      return markStopped(info);
    } catch {
      // Engine gone: recover whatever was written to IndexedDB.
      return reconcileUnlocked();
    }
  });
}

/** Handles a stop from the engine (user, 15-minute limit, device loss). Idempotent. */
export async function markStopped(info: { draftId: string; accumulatedMs: number; bytes: number; reason: StopReason }): Promise<RecState> {
  const s = await readState();
  await chrome.alarms.clear(LIMIT_ALARM);
  if (s.draftId !== info.draftId || (s.phase !== "recording" && s.phase !== "paused")) return s;
  const next = await patchState({
    phase: "stopped",
    accumulatedMs: info.accumulatedMs,
    segmentStartedAt: null,
    bytes: info.bytes,
    stopReason: info.reason,
  });
  void closeOffscreenIfIdle();
  if (info.reason === "limit") notify("limit", "15-minute limit reached", `Recording stopped at ${formatClock(info.accumulatedMs)}. Open Hear Me Out to review and save it.`);
  else if (info.reason === "device-lost")
    notify("device", "Microphone disconnected", "Recording stopped and the audio captured so far has been kept. Open Hear Me Out to review it.");
  else if (info.reason === "recorder-error") notify("device", "Recording stopped", "Something interrupted the recorder. The audio captured so far has been kept.");
  return next;
}

export function discardRecording() {
  return serial(async () => {
    const s = await readState();
    if (s.phase === "recording" || s.phase === "paused") {
      await sendOff({ type: "off:stop", reason: "user" }).catch(() => undefined);
    }
    if (s.phase === "saving" || s.phase === "uploading") throw new RecError("busy", "Wait for the upload to finish or fail before discarding.");
    if (s.draftId) await deleteDraft(s.draftId);
    await chrome.alarms.clear(LIMIT_ALARM);
    await closeOffscreenIfIdle();
    return writeState({ ...IDLE_STATE, updatedAt: Date.now() });
  });
}

export function resetCompleted() {
  return serial(async () => {
    const s = await readState();
    if (s.phase !== "completed") return s;
    return writeState({ ...IDLE_STATE, updatedAt: Date.now() });
  });
}

export function reconcile(): Promise<RecState> {
  return reconcileUnlocked();
}

/**
 * Makes the shared state truthful. Called whenever the popup opens and when the worker starts:
 *  - "recording" but the engine is gone (crash, Chrome restart) → stopped + recovered from IndexedDB;
 *  - "saving/uploading" but nothing is running → error with Retry (no duplicate upload);
 *  - empty state but an unsaved draft exists (after a Chrome restart) → offer it for review.
 */
async function reconcileUnlocked(): Promise<RecState> {
  const s = await readState();
  if (s.phase === "recording" || s.phase === "paused") {
    const st = await offStatus();
    if (st?.recording && st.draftId === s.draftId) return s;
    return recoverDraft(s.draftId, "interrupted");
  }
  if (s.phase === "uploading") {
    const st = await offStatus();
    if (st?.uploading || isPipelineRunning()) return s;
    return patchState({ phase: "error", error: "The upload was interrupted. Your recording is safe — choose Retry upload.", uploadProgress: undefined });
  }
  if (s.phase === "saving" && !isPipelineRunning()) {
    return patchState({ phase: "error", error: "Saving was interrupted. Your recording is safe — choose Retry upload." });
  }
  if (s.phase === "idle" || (s.phase === "completed" && !s.draftId)) {
    if (s.phase === "completed") return s;
    const drafts = await listDrafts();
    const latest = drafts[0];
    if (!latest) return s;
    const st = await offStatus();
    if (st?.recording && st.draftId === latest.id) return s;
    return recoverDraft(latest.id, "interrupted");
  }
  return s;
}

async function recoverDraft(draftId: string | null, reason: StopReason): Promise<RecState> {
  await chrome.alarms.clear(LIMIT_ALARM);
  const d = draftId ? await getDraft(draftId) : undefined;
  if (!d) return writeState({ ...IDLE_STATE, updatedAt: Date.now() });
  const { blob, lastElapsedMs, count } = await draftBlob(d.id, d.mime);
  if (count === 0 && d.stage === "none") {
    await deleteDraft(d.id);
    return writeState({ ...IDLE_STATE, updatedAt: Date.now() });
  }
  const wasCapturing = d.status !== "stopped";
  const accumulatedMs = wasCapturing ? Math.max(d.accumulatedMs, lastElapsedMs) : d.accumulatedMs;
  if (wasCapturing) await updateDraft(d.id, { status: "stopped", accumulatedMs, segmentStartedAt: null, stopReason: reason, bytes: blob.size, chunks: count });
  const pendingUpload = d.stage === "authorised" || d.stage === "uploaded";
  return writeState({
    ...IDLE_STATE,
    phase: pendingUpload ? "error" : "stopped",
    draftId: d.id,
    startedAt: d.createdAt,
    accumulatedMs,
    mime: d.mime,
    bytes: blob.size,
    title: d.title,
    stopReason: wasCapturing ? reason : d.stopReason,
    recovered: true,
    error: pendingUpload ? "This recording hadn't finished uploading. Your audio is safe — choose Retry upload." : undefined,
    updatedAt: Date.now(),
  });
}

export async function onLimitAlarm() {
  const s = await readState();
  if (s.phase === "recording") await stopRecording("limit");
}
