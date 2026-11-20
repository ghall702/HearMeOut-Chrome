// Resumable save pipeline: authorise → upload directly to the media server → finalise.
// Progress is recorded on the IndexedDB draft (`stage`), so Retry resumes where it stopped and never
// creates a duplicate recording or re-sends audio that was already accepted.
import { deleteDraft, draftBlob, getDraft, updateDraft } from "../shared/db";
import { defaultTitle } from "../shared/timing";
import type { Draft, ShareResult } from "../shared/types";
import { ApiError, hmoApi, type UploadAuthorisation } from "./api";
import { AuthError } from "./auth";
import { closeOffscreenIfIdle, ensureOffscreen, sendOff } from "./offscreen-host";
import { patchState, readState } from "./state";

let running = 0;
export const isPipelineRunning = () => running > 0;
const LAST_RESULT_KEY = "lastResult";

function extFor(mime: string) {
  return mime.includes("ogg") ? "ogg" : "webm";
}

async function fail(e: unknown) {
  const auth = e instanceof AuthError;
  const message = e instanceof Error ? e.message : "Saving failed.";
  await patchState({ phase: "error", error: message, step: undefined, uploadProgress: undefined, ...(auth ? { step: "auth" } : {}) });
}

async function authorise(d: Draft, size: number): Promise<UploadAuthorisation> {
  const title = d.title?.trim() || defaultTitle(d.createdAt);
  const r = await hmoApi.createUpload({
    ext: extFor(d.mime),
    size,
    filename: `voice-note-${new Date(d.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${extFor(d.mime)}`,
    mime: d.mime.split(";")[0] ?? "audio/webm",
    durationSeconds: Math.round(d.accumulatedMs / 100) / 10,
    title,
  });
  await updateDraft(d.id, { stage: "authorised", recordingId: r.recordingId, uploadUrl: r.uploadUrl, uploadHeaders: r.headers, uploadExp: r.exp });
  return r;
}

/** Fresh token for the same recording (no duplicate). Falls back to a new upload on older backends. */
async function reauthorise(d: Draft, size: number): Promise<UploadAuthorisation | "already-finalised"> {
  if (d.recordingId) {
    try {
      const r = await hmoApi.reissueUpload(d.recordingId);
      await updateDraft(d.id, { uploadUrl: r.uploadUrl, uploadHeaders: r.headers, uploadExp: r.exp });
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return "already-finalised";
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
    }
  }
  return authorise({ ...d, stage: "none" }, size);
}

/** Starts or resumes saving the current draft. Returns once the upload has been handed to the engine. */
export async function savePipeline(title?: string): Promise<void> {
  const s = await readState();
  if (!s.draftId) throw new Error("There is no recording to save.");
  if (s.phase !== "stopped" && s.phase !== "error") throw new Error("This recording can't be saved right now.");
  running++;
  try {
    let d = await getDraft(s.draftId);
    if (!d) throw new Error("The recording could not be found on this computer.");
    if (title !== undefined) d = (await updateDraft(d.id, { title: title.trim() || defaultTitle(d.createdAt) }))!;
    await patchState({ phase: "saving", step: "Preparing upload…", error: undefined, title: d.title, uploadProgress: undefined });
    const { blob } = await draftBlob(d.id, d.mime);
    if (blob.size === 0) throw new Error("No audio was captured in this recording.");

    if (d.stage === "uploaded") return void (await finalise(d.id));
    if (d.stage === "finalised") return void (await finalise(d.id));

    let auth: UploadAuthorisation | "already-finalised";
    if (d.stage === "none") auth = await authorise(d, blob.size);
    else if (!d.uploadUrl || !d.uploadHeaders || (d.uploadExp ?? 0) - 120 < Date.now() / 1000) auth = await reauthorise(d, blob.size);
    else auth = { recordingId: d.recordingId!, uploadUrl: d.uploadUrl, headers: d.uploadHeaders, method: "PUT", exp: d.uploadExp! };
    if (auth === "already-finalised") {
      await updateDraft(d.id, { stage: "uploaded" });
      return void (await finalise(d.id));
    }
    await patchState({ phase: "uploading", step: "Uploading…", uploadProgress: 0 });
    await ensureOffscreen();
    await sendOff({ type: "off:upload", draftId: d.id, url: auth.uploadUrl, headers: auth.headers });
  } catch (e) {
    await fail(e);
  } finally {
    running--;
  }
}

export async function onUploadProgress(draftId: string, pct: number) {
  const s = await readState();
  if (s.draftId === draftId && s.phase === "uploading") await patchState({ uploadProgress: pct });
}

export async function onUploadDone(draftId: string) {
  const d = await getDraft(draftId);
  if (!d) return;
  await updateDraft(draftId, { stage: "uploaded", uploadRetried: undefined });
  void closeOffscreenIfIdle();
  await finalise(draftId);
}

export async function onUploadFailed(draftId: string, status: number, message: string) {
  const d = await getDraft(draftId);
  const s = await readState();
  if (!d || s.draftId !== draftId) return;
  // Expired storage token: fetch a fresh one for the same recording and retry once automatically.
  const retried = d.uploadRetried;
  if (status === 403 && !retried) {
    running++;
    try {
      await updateDraft(draftId, { uploadRetried: true });
      const { blob } = await draftBlob(d.id, d.mime);
      const auth = await reauthorise(d, blob.size);
      if (auth === "already-finalised") {
        await updateDraft(d.id, { stage: "uploaded" });
        return void (await finalise(d.id));
      }
      await patchState({ uploadProgress: 0 });
      await sendOff({ type: "off:upload", draftId, url: auth.uploadUrl, headers: auth.headers });
      return;
    } catch (e) {
      return fail(e);
    } finally {
      running--;
    }
  }
  await updateDraft(draftId, { uploadRetried: undefined });
  void closeOffscreenIfIdle();
  await patchState({ phase: "error", error: `${message} Your recording is safe — choose Retry upload.`, uploadProgress: undefined, step: undefined });
}

async function finalise(draftId: string) {
  running++;
  try {
    const d = await getDraft(draftId);
    if (!d?.recordingId) throw new Error("The recording could not be found on this computer.");
    await patchState({ phase: "saving", step: "Finalising…", uploadProgress: 100 });
    let r;
    try {
      // transcribe:false → share links come back immediately; transcription is queued just below.
      r = await hmoApi.finalize(d.recordingId, { title: d.title?.trim() || defaultTitle(d.createdAt), transcribe: false });
    } catch (e) {
      if (e instanceof ApiError && /did not confirm/i.test(e.message)) {
        await updateDraft(draftId, { stage: "authorised", uploadExp: 0 });
        throw new Error("The storage server didn't confirm the upload.");
      }
      throw e;
    }
    await updateDraft(draftId, { stage: "finalised" });
    const result: ShareResult = {
      id: r.id,
      title: r.title,
      shareUrl: r.shareUrl,
      embedUrl: r.embedUrl,
      embedCode: r.embedCode,
      transcription_status: r.transcription_status,
      createdAt: d.createdAt,
    };
    await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
    await patchState({ phase: "completed", result, step: undefined, error: undefined, draftId: null });
    // The audio is now safely on the media server: remove the local copy.
    await deleteDraft(draftId);
    // Hand off to Hear Me Out's existing transcription pipeline (same endpoint, transcribe:true).
    void hmoApi
      .finalize(r.id, { transcribe: true })
      .then(async (t) => {
        const cur = await readState();
        if (cur.result?.id === r.id) await patchState({ result: { ...cur.result, title: t.title, transcription_status: t.transcription_status } });
      })
      .catch(() => undefined);
  } catch (e) {
    await fail(e);
  } finally {
    running--;
  }
}

export async function lastResult(): Promise<ShareResult | null> {
  const r = await chrome.storage.local.get(LAST_RESULT_KEY);
  return (r[LAST_RESULT_KEY] as ShareResult | undefined) ?? null;
}
