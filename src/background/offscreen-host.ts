// Offscreen document lifecycle. There is at most one per extension, so it is also our single-recording lock.
import type { DistOmit, OffRequest, OffStatus } from "../shared/messages";

const PATH = "offscreen.html";
let creating: Promise<void> | null = null;

export async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD],
      justification:
        "Records microphone audio for voice notes while the popup is closed, uploads the recording to Hear Me Out and copies share links to the clipboard.",
    })
    .catch((e: unknown) => {
      // Another caller may have won the race.
      if (!/single offscreen/i.test(String(e))) throw e;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function sendOff<T>(msg: DistOmit<OffRequest, "to">): Promise<T> {
  const r = (await chrome.runtime.sendMessage({ ...msg, to: "offscreen" })) as
    | { ok: true; data: T }
    | { ok: false; error: string; code?: string }
    | undefined;
  if (!r) throw new Error("The recorder didn't respond.");
  if (!r.ok) {
    const e = new Error(r.error);
    e.name = r.code ?? "Error";
    throw e;
  }
  return r.data;
}

export async function offStatus(): Promise<OffStatus | null> {
  if (!(await hasOffscreen())) return null;
  try {
    return await sendOff<OffStatus>({ type: "off:status" });
  } catch {
    return null;
  }
}

/** Closes the offscreen document when it is neither recording nor uploading. */
export async function closeOffscreenIfIdle(): Promise<void> {
  const st = await offStatus();
  if (!st || st.recording || st.uploading) return;
  await chrome.offscreen.closeDocument().catch(() => undefined);
}
