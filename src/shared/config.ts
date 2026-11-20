// Build-time configuration. Production values point at the live Hear Me Out service.
// The e2e build (vite --mode e2e) swaps these for a local mock server.
export const HMO_ORIGIN: string = (import.meta.env.VITE_HMO_ORIGIN as string | undefined) ?? "https://hearmeout.george-hall.uk";
export const MEDIA_ORIGIN: string =
  (import.meta.env.VITE_MEDIA_ORIGIN as string | undefined) ?? "https://mediahub-lm-1.georgehalltuition.com";

/** Hard limit enforced inside the recording engine (offscreen document). */
export const MAX_RECORDING_SECONDS: number = Number(import.meta.env.VITE_MAX_SECONDS as string | undefined) || 15 * 60;
export const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
/** MediaRecorder timeslice: each second of audio is persisted to IndexedDB as it is produced. */
export const CHUNK_MS = 1000;
export const PREFERRED_MIME = "audio/webm;codecs=opus";
export const AUDIO_BITS_PER_SECOND = 128_000;
