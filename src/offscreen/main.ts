// Offscreen document entry: message routing for the recorder, uploads, clipboard and live levels.
import type { DistOmit, OffEvent, OffRequest, OffStatus } from "../shared/messages";
import { execCopy } from "../shared/share";
import { Recorder, type StopInfo } from "./recorder";
import { uploadDraft } from "./upload";

const HISTORY = 240;
const levels: number[] = [];
const ports = new Set<chrome.runtime.Port>();
let uploading = 0;

function emit(e: DistOmit<OffEvent, "to">) {
  chrome.runtime.sendMessage({ ...e, to: "bg-event" }).catch(() => undefined);
}

const recorder = new Recorder({
  onStopped(info: StopInfo) {
    emit({ type: "rec:stopped", ...info });
    for (const p of ports) p.postMessage({ type: "stopped" });
  },
  onLevel(level) {
    levels.push(level);
    if (levels.length > HISTORY) levels.splice(0, levels.length - HISTORY);
    for (const p of ports) p.postMessage({ type: "level", level });
  },
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "levels" || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.postMessage({ type: "history", levels });
  port.onDisconnect.addListener(() => ports.delete(port));
});

async function handle(msg: OffRequest): Promise<unknown> {
  switch (msg.type) {
    case "off:start":
      levels.length = 0;
      return recorder.start(msg.draftId, { deviceId: msg.deviceId, noiseSuppression: msg.noiseSuppression });
    case "off:pause":
      return recorder.pause();
    case "off:resume":
      return recorder.resume();
    case "off:stop":
      return recorder.stop(msg.reason);
    case "off:status":
      return { recording: recorder.active, paused: recorder.paused, draftId: recorder.draftId, uploading: uploading > 0 } satisfies OffStatus;
    case "off:upload": {
      uploading++;
      const { draftId, url, headers } = msg;
      void uploadDraft(draftId, url, headers, (pct) => emit({ type: "upload:progress", draftId, pct }))
        .then((r) =>
          r.ok
            ? emit({ type: "upload:done", draftId, status: r.status })
            : emit({ type: "upload:failed", draftId, status: r.status, code: r.code, message: r.message }),
        )
        .catch((e: unknown) =>
          emit({ type: "upload:failed", draftId, status: -1, code: "internal", message: e instanceof Error ? e.message : "Upload failed." }),
        )
        .finally(() => uploading--);
      return { accepted: true };
    }
    case "off:copy":
      if (!execCopy({ text: msg.text, html: msg.html })) throw new Error("Couldn't copy to the clipboard.");
      return { copied: true };
  }
}

chrome.runtime.onMessage.addListener((msg: OffRequest, sender, sendResponse) => {
  if (msg?.to !== "offscreen" || sender.id !== chrome.runtime.id) return false;
  handle(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e), code: (e as { name?: string })?.name }),
  );
  return true;
});
