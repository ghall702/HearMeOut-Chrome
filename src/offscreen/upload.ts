// Direct browser → media server upload (no proxy). Uses XHR for progress events.
import { draftBlob, getDraft } from "../shared/db";

export interface UploadOutcome {
  ok: boolean;
  status: number;
  code: string;
  message: string;
}

export function friendlyUploadError(status: number, code: string): string {
  if (status === 0) return "Network error during upload. Check your connection and try again.";
  if (status === 413) return "This recording is too large for the storage server.";
  if (status === 400 && code === "bad_key") return "The storage server rejected the file name or type.";
  if (status === 400 && code === "upload_incomplete") return "The connection dropped before the upload finished. Please try again.";
  if (status === 403) return "The upload link expired.";
  if (status === 502 || status === 503 || status === 504) return "The storage server is restarting. Please try again in a few seconds.";
  return `Upload failed (${status}${code ? `: ${code}` : ""}).`;
}

export async function uploadDraft(draftId: string, url: string, headers: Record<string, string>, onProgress: (pct: number) => void): Promise<UploadOutcome> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, status: -1, code: "missing", message: "The recording could not be found on this computer." };
  const { blob } = await draftBlob(draftId, draft.mime);
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    let last = -1;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      if (pct - last >= 4 || pct === 100) {
        last = pct;
        onProgress(pct);
      }
    };
    xhr.onload = () => {
      if (xhr.status === 201 || xhr.status === 200) return resolve({ ok: true, status: xhr.status, code: "", message: "" });
      let code = "";
      try {
        code = (JSON.parse(xhr.responseText) as { error?: string }).error ?? "";
      } catch {
        /* not JSON */
      }
      resolve({ ok: false, status: xhr.status, code, message: friendlyUploadError(xhr.status, code) });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, code: "network", message: friendlyUploadError(0, "") });
    xhr.ontimeout = xhr.onerror;
    xhr.send(blob);
  });
}
