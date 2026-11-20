// Service worker: routes messages, keyboard shortcuts and alarms. Holds no audio and no long-lived
// in-memory state — Chrome may stop it at any time without affecting a recording.
import { HMO_ORIGIN } from "../shared/config";
import { clearAllDrafts } from "../shared/db";
import type { BgRequest, OffEvent } from "../shared/messages";
import { detectContext } from "../shared/rules";
import { getSettings } from "../shared/settings";
import { FORMAT_LABELS, clipboardPayload } from "../shared/share";
import { formatClock } from "../shared/timing";
import { IDLE_STATE } from "../shared/types";
import { hmoApi } from "./api";
import { AuthError, authSummary, signIn, signOut } from "./auth";
import { notify } from "./notify";
import { closeOffscreenIfIdle, ensureOffscreen, sendOff } from "./offscreen-host";
import { lastResult, onUploadDone, onUploadFailed, onUploadProgress, savePipeline } from "./pipeline";
import {
  RecError,
  discardRecording,
  markStopped,
  onLimitAlarm,
  pauseRecording,
  reconcile,
  resetCompleted,
  resumeRecording,
  startRecording,
  stopRecording,
} from "./recording";
import { applyBadge, readState, writeState } from "./state";

const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;
const LIBRARY_CACHE = "libraryCache";

/** Only our own extension pages (popup, permission page, offscreen) may talk to the worker. */
function trusted(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id && (sender.url ?? "").startsWith(EXT_ORIGIN);
}

async function handle(msg: BgRequest): Promise<unknown> {
  switch (msg.type) {
    case "state:get":
      return reconcile();
    case "rec:start":
      return startRecording();
    case "rec:pause":
      return pauseRecording();
    case "rec:resume":
      return resumeRecording();
    case "rec:stop":
      return stopRecording("user");
    case "rec:discard":
      return discardRecording();
    case "rec:save":
      await savePipeline(msg.title);
      return readState();
    case "rec:retry":
      await savePipeline();
      return readState();
    case "rec:new":
      return resetCompleted();
    case "auth:get":
      return authSummary();
    case "auth:signin": {
      const user = await signIn();
      return { signedIn: true, user };
    }
    case "auth:signout": {
      const s = await readState();
      if (s.phase === "recording" || s.phase === "paused") await stopRecording("user");
      await signOut();
      // Remove every trace of this account from the profile: drafts, cache, last share.
      await clearAllDrafts();
      await chrome.storage.local.remove([LIBRARY_CACHE, "lastResult"]);
      await writeState({ ...IDLE_STATE, updatedAt: Date.now() });
      await closeOffscreenIfIdle();
      return authSummary();
    }
    case "api:list": {
      const r = await hmoApi.list();
      const user = (await authSummary()).user;
      await chrome.storage.local.set({ [LIBRARY_CACHE]: { userId: user?.id ?? null, items: r.items, at: Date.now() } });
      return r.items;
    }
    case "api:get":
      return hmoApi.get(msg.id);
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest | OffEvent, sender, sendResponse) => {
  if (!trusted(sender)) return false;
  if (msg?.to === "bg-event") {
    void onEngineEvent(msg);
    return false;
  }
  if (msg?.to !== "bg") return false;
  handle(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e: unknown) => {
      const code = e instanceof RecError || e instanceof AuthError ? e.code : (e as { name?: string })?.name;
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e), code });
    },
  );
  return true;
});

async function onEngineEvent(e: OffEvent) {
  switch (e.type) {
    case "rec:stopped":
      await markStopped(e);
      break;
    case "upload:progress":
      await onUploadProgress(e.draftId, e.pct);
      break;
    case "upload:done":
      await onUploadDone(e.draftId);
      break;
    case "upload:failed":
      await onUploadFailed(e.draftId, e.status, e.message);
      break;
    default:
      break;
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "rec-limit") void onLimitAlarm();
});

// ---- keyboard shortcuts (chrome://extensions/shortcuts) ----
chrome.commands.onCommand.addListener((command, tab) => {
  void runCommand(command, tab).catch((e: unknown) => notify("cmd", "Hear Me Out", e instanceof Error ? e.message : "Something went wrong."));
});

async function runCommand(command: string, tab?: chrome.tabs.Tab) {
  if (command === "toggle-recording") {
    const s = await reconcile();
    if (s.phase === "recording" || s.phase === "paused") {
      const done = await stopRecording("user");
      notify("stop", "Recording stopped", `${formatClock(done.accumulatedMs)} recorded. Open Hear Me Out to review and save it.`);
      await chrome.action.openPopup?.().catch(() => undefined);
      return;
    }
    try {
      await startRecording();
    } catch (e) {
      if (e instanceof RecError && e.code === "mic-permission") {
        await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
        return;
      }
      if (e instanceof RecError && e.code === "unsaved") {
        await chrome.action.openPopup?.().catch(() => undefined);
      }
      throw e;
    }
    return;
  }
  if (command === "copy-latest") {
    const r = await lastResult();
    if (!r) return notify("copy", "Nothing to copy yet", "Save a voice note first, then use this shortcut to copy it.");
    const ctx = detectContext(tab?.url, await getSettings());
    const payload = clipboardPayload(ctx.format, r);
    await ensureOffscreen();
    await sendOff({ type: "off:copy", text: payload.text, html: payload.html });
    void closeOffscreenIfIdle();
    return notify("copy", "Copied to clipboard", `${FORMAT_LABELS[ctx.format].short} for “${r.title}”${ctx.name ? ` (${ctx.name})` : ""}.`);
  }
  if (command === "open-hearmeout") {
    await chrome.tabs.create({ url: `${HMO_ORIGIN}/library` });
  }
}

// ---- lifecycle ----
chrome.runtime.onStartup.addListener(() => {
  // Chrome just started: no recording can be running. Never show a stale REC badge.
  void applyBadge("idle").then(() => reconcile());
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  void reconcile();
});

// Each time the worker wakes, make sure the badge reflects reality.
void readState().then((s) => applyBadge(s.phase));
