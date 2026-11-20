export type Phase = "idle" | "recording" | "paused" | "stopped" | "saving" | "uploading" | "completed" | "error";
export type StopReason = "user" | "limit" | "device-lost" | "interrupted" | "recorder-error";
export type ShareFormat = "email-card" | "embed" | "link" | "message";

export interface ShareResult {
  id: string;
  title: string;
  shareUrl: string;
  embedUrl: string;
  embedCode: string;
  transcription_status?: string;
  createdAt: number;
}

/** Shared recording state (chrome.storage.session, written only by the service worker). */
export interface RecState {
  phase: Phase;
  draftId: string | null;
  /** Wall-clock ms when recording first started. */
  startedAt: number | null;
  /** ms of audio captured before the current segment (pauses excluded). */
  accumulatedMs: number;
  /** Wall-clock ms the current (unpaused) segment started, or null when paused/stopped. */
  segmentStartedAt: number | null;
  stopReason?: StopReason | undefined;
  recovered?: boolean | undefined;
  mime?: string | undefined;
  bytes?: number | undefined;
  title?: string | undefined;
  uploadProgress?: number | undefined;
  /** Human-readable step while saving/uploading. */
  step?: string | undefined;
  error?: string | undefined;
  /** Error happened during capture (true) or during save (false). */
  captureError?: boolean | undefined;
  result?: ShareResult | undefined;
  updatedAt: number;
}

export const IDLE_STATE: RecState = {
  phase: "idle",
  draftId: null,
  startedAt: null,
  accumulatedMs: 0,
  segmentStartedAt: null,
  updatedAt: 0,
};

export type UploadStage = "none" | "authorised" | "uploaded" | "finalised";

/** IndexedDB draft record — the durable source of truth for a recording until it is saved. */
export interface Draft {
  id: string;
  createdAt: number;
  mime: string;
  status: "recording" | "paused" | "stopped";
  accumulatedMs: number;
  segmentStartedAt: number | null;
  stopReason?: StopReason | undefined;
  bytes: number;
  chunks: number;
  title?: string | undefined;
  stage: UploadStage;
  recordingId?: string | undefined;
  uploadUrl?: string | undefined;
  uploadHeaders?: Record<string, string> | undefined;
  uploadExp?: number | undefined;
  /** Set after one automatic retry with a fresh storage token. */
  uploadRetried?: boolean | undefined;
}

export interface Chunk {
  draftId: string;
  seq: number;
  blob: Blob;
  /** Captured audio length (ms) at the end of this chunk — lets interrupted drafts recover a duration. */
  elapsedMs: number;
}

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
}

export interface AuthSummary {
  signedIn: boolean;
  expired?: boolean;
  user?: AuthUser;
}

export interface RecordingItem {
  id: string;
  title: string;
  duration_seconds: number | null;
  size_bytes?: number | null;
  status: string;
  transcription_status: string;
  share_enabled?: boolean;
  play_count: number;
  first_played_at: string | null;
  last_played_at?: string | null;
  created_at: string;
  shareUrl: string;
  embedUrl: string;
  embedCode: string;
  transcript?: string | null;
}

export interface SiteRule {
  id: string;
  name: string;
  /** Hostname (`mail.google.com`), wildcard host (`*.slack.com`) or host + path prefix (`example.com/course/*`). */
  pattern: string;
  format: ShareFormat;
  builtin?: boolean;
}

export interface Settings {
  theme: "light" | "dark" | "system";
  micDeviceId: string;
  noiseSuppression: boolean;
  moodleHosts: string[];
  customRules: SiteRule[];
  disabledBuiltins: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  micDeviceId: "",
  noiseSuppression: true,
  moodleHosts: ["lms.georgehilltuition.com", "lms.georgehalltuition.com"],
  customRules: [],
  disabledBuiltins: [],
};
