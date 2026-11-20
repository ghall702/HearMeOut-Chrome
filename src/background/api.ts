// Hear Me Out public API client (service worker only — credentials never leave this context).
import { HMO_ORIGIN } from "../shared/config";
import type { RecordingItem } from "../shared/types";
import { AuthError, getApiKey, markAccepted, markRejected } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function friendly(status: number, code: string): string {
  if (status === 404) return "That recording couldn't be found.";
  if (status >= 500) return "Hear Me Out is having trouble right now. Please try again shortly.";
  return code && !/^[a-z_]+$/.test(code) ? code : `Request failed (${status}${code ? `: ${code}` : ""}).`;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const call = async (token: string) => {
    try {
      return await fetch(`${HMO_ORIGIN}${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new ApiError(0, "network", "Couldn't reach Hear Me Out. Check your connection and try again.");
    }
  };
  const key = await getApiKey();
  let r = await call(key);
  if (r.status === 401) r = await call(key); // one retry: never disconnect on a single blip
  if (r.status === 401) {
    await markRejected();
    throw new AuthError("expired", "Hear Me Out didn't accept this Chrome profile's connection (it may have been revoked). Please reconnect.");
  }
  // Success is any 2xx (uploads returns 201 Created).
  if (r.ok) {
    void markAccepted();
    return (await r.json()) as T;
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(r.status, j.error ?? "", friendly(r.status, j.error ?? ""));
}

export interface UploadAuthorisation {
  recordingId: string;
  storageKey?: string;
  key?: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  exp: number;
}

export interface FinalizeResult {
  id: string;
  title: string;
  transcription_status: string;
  shareUrl: string;
  embedUrl: string;
  embedCode: string;
}

/** The documented API returns `uploadUrl`; older deployments return `url`. Normalise both. */
function normaliseUpload(r: UploadAuthorisation & { url?: string; token?: string }): UploadAuthorisation {
  const uploadUrl = r.uploadUrl ?? r.url;
  const headers = r.headers ?? (r.token ? { Authorization: `Bearer ${r.token}` } : {});
  if (!uploadUrl || !headers["Authorization"]) throw new ApiError(500, "bad_response", "Hear Me Out returned an unexpected upload response.");
  return { ...r, uploadUrl, headers };
}

export const hmoApi = {
  createUpload: async (body: { ext: string; size: number; filename: string; mime: string; durationSeconds: number; title: string }) =>
    normaliseUpload(await api<UploadAuthorisation>("/api/public/v1/uploads", { method: "POST", body })),
  reissueUpload: async (id: string) =>
    normaliseUpload(await api<UploadAuthorisation>(`/api/public/v1/recordings/${encodeURIComponent(id)}/upload-url`, { method: "POST", body: {} })),
  finalize: (id: string, body: { title?: string; transcribe?: boolean }) =>
    api<FinalizeResult>(`/api/public/v1/recordings/${encodeURIComponent(id)}/finalize`, { method: "POST", body }),
  list: () => api<{ items: RecordingItem[] }>("/api/public/v1/recordings"),
  get: (id: string) => api<RecordingItem>(`/api/public/v1/recordings/${encodeURIComponent(id)}`),
};
