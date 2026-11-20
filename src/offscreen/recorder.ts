// The recording engine. Lives in the offscreen document, which Chrome keeps alive independently of
// the popup and the service worker, so capture continues while the popup is closed, while other tabs,
// windows or desktop applications are in front, and while the service worker sleeps.
import { AUDIO_BITS_PER_SECOND, CHUNK_MS, MAX_RECORDING_MS, PREFERRED_MIME } from "../shared/config";
import { putChunk, putDraft, updateDraft } from "../shared/db";
import type { StopReason } from "../shared/types";

export interface StopInfo {
  draftId: string;
  accumulatedMs: number;
  bytes: number;
  reason: StopReason;
}

interface Session {
  draftId: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  mime: string;
  seq: number;
  bytes: number;
  accumulatedMs: number;
  segmentStartedAt: number | null;
  writes: Promise<void>;
  limitTimer: ReturnType<typeof setTimeout> | null;
  stopping: Promise<StopInfo> | null;
  writeFailed: boolean;
}

export interface RecorderHooks {
  onStopped(info: StopInfo): void;
  onLevel(level: number): void;
}

export class MicError extends Error {
  constructor(
    public code: "mic-permission" | "no-mic" | "mic-busy" | "mic-error",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

function micError(e: unknown): MicError {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new MicError("mic-permission", "Hear Me Out needs permission to use your microphone.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new MicError("no-mic", "No microphone was found. Connect one and try again.");
  if (name === "NotReadableError" || name === "AbortError")
    return new MicError("mic-busy", "Your microphone couldn't be started. Check that your computer allows Chrome to use it and that no other app is blocking it.");
  return new MicError("mic-error", e instanceof Error ? e.message : "The microphone couldn't be started.");
}

export class Recorder {
  private s: Session | null = null;
  private meterCtx: AudioContext | null = null;

  constructor(private hooks: RecorderHooks) {}

  get active() {
    return this.s != null && !this.s.stopping;
  }
  get paused() {
    return this.s?.recorder.state === "paused";
  }
  get draftId() {
    return this.s?.draftId ?? null;
  }

  private elapsed(now = Date.now()) {
    const s = this.s!;
    return Math.min(MAX_RECORDING_MS, s.accumulatedMs + (s.segmentStartedAt != null ? now - s.segmentStartedAt : 0));
  }

  private armLimit() {
    const s = this.s!;
    if (s.limitTimer) clearTimeout(s.limitTimer);
    const remaining = MAX_RECORDING_MS - this.elapsed();
    s.limitTimer = setTimeout(() => void this.stop("limit"), Math.max(0, remaining));
  }

  async start(draftId: string, opts: { deviceId: string; noiseSuppression: boolean }) {
    if (this.s) throw new MicError("mic-error", "A recording is already in progress.");
    let stream: MediaStream;
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: opts.noiseSuppression,
      autoGainControl: true,
      channelCount: 1,
    };
    if (opts.deviceId) audio.deviceId = { ideal: opts.deviceId };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      throw micError(e);
    }
    const mime = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    const startedAt = Date.now();
    this.s = {
      draftId,
      stream,
      recorder,
      mime,
      seq: 0,
      bytes: 0,
      accumulatedMs: 0,
      segmentStartedAt: startedAt,
      writes: Promise.resolve(),
      limitTimer: null,
      stopping: null,
      writeFailed: false,
    };
    await putDraft({
      id: draftId,
      createdAt: startedAt,
      mime,
      status: "recording",
      accumulatedMs: 0,
      segmentStartedAt: startedAt,
      bytes: 0,
      chunks: 0,
      stage: "none",
    });

    recorder.ondataavailable = (e) => {
      const s = this.s;
      if (!s || s.draftId !== draftId || e.data.size === 0) return;
      const seq = s.seq++;
      s.bytes += e.data.size;
      const elapsedMs = this.elapsed();
      // Persist every chunk immediately so an unexpected termination loses at most ~1 second.
      s.writes = s.writes
        .then(() => putChunk({ draftId, seq, blob: e.data, elapsedMs }))
        .catch(() => {
          s.writeFailed = true;
        });
      if (!s.stopping && elapsedMs >= MAX_RECORDING_MS) void this.stop("limit");
    };
    recorder.onerror = () => void this.stop("recorder-error");
    for (const t of stream.getAudioTracks()) {
      // Fires when the device is unplugged or the OS revokes access: stop cleanly, keep the audio.
      t.onended = () => void this.stop("device-lost");
    }
    recorder.start(CHUNK_MS);
    this.armLimit();
    this.startMeter(stream).catch(() => {
      /* waveform is cosmetic; recording is unaffected */
    });
    return { startedAt, mime };
  }

  async pause() {
    const s = this.s;
    if (!s || s.stopping) throw new Error("Not recording.");
    if (s.recorder.state === "recording") {
      s.recorder.pause();
      const now = Date.now();
      s.accumulatedMs = this.elapsed(now);
      s.segmentStartedAt = null;
      if (s.limitTimer) clearTimeout(s.limitTimer);
      s.limitTimer = null;
      await updateDraft(s.draftId, { status: "paused", accumulatedMs: s.accumulatedMs, segmentStartedAt: null });
    }
    return { draftId: s.draftId, accumulatedMs: s.accumulatedMs };
  }

  async resume() {
    const s = this.s;
    if (!s || s.stopping) throw new Error("Not recording.");
    if (s.recorder.state === "paused") {
      if (s.accumulatedMs >= MAX_RECORDING_MS) {
        await this.stop("limit");
        throw new Error("The 15-minute limit has been reached.");
      }
      s.recorder.resume();
      s.segmentStartedAt = Date.now();
      this.armLimit();
      await updateDraft(s.draftId, { status: "recording", segmentStartedAt: s.segmentStartedAt });
    }
    return { draftId: s.draftId, segmentStartedAt: s.segmentStartedAt!, accumulatedMs: s.accumulatedMs };
  }

  /** Idempotent: concurrent calls (user, limit timer, device loss) share one stop. */
  stop(reason: StopReason): Promise<StopInfo> {
    const s = this.s;
    if (!s) return Promise.reject(new Error("Not recording."));
    if (s.stopping) return s.stopping;
    s.stopping = (async () => {
      s.accumulatedMs = this.elapsed();
      s.segmentStartedAt = null;
      if (s.limitTimer) clearTimeout(s.limitTimer);
      await new Promise<void>((resolve) => {
        if (s.recorder.state === "inactive") return resolve();
        s.recorder.addEventListener("stop", () => resolve(), { once: true });
        try {
          s.recorder.stop(); // flushes the final chunk via dataavailable before "stop"
        } catch {
          resolve();
        }
      });
      await s.writes;
      for (const t of s.stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
      await this.stopMeter();
      await updateDraft(s.draftId, {
        status: "stopped",
        accumulatedMs: s.accumulatedMs,
        segmentStartedAt: null,
        stopReason: reason,
        bytes: s.bytes,
        chunks: s.seq,
      }).catch(() => undefined);
      const info: StopInfo = { draftId: s.draftId, accumulatedMs: s.accumulatedMs, bytes: s.bytes, reason };
      this.s = null;
      this.hooks.onStopped(info);
      return info;
    })();
    return s.stopping;
  }

  private async startMeter(stream: MediaStream) {
    const ctx = new AudioContext();
    this.meterCtx = ctx;
    await ctx.audioWorklet.addModule(chrome.runtime.getURL("level-meter.worklet.js"));
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "level-meter", { numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0; // keeps the node pulled by the graph without playing anything
    src.connect(node).connect(mute).connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent<number>) => {
      if (this.s && !this.paused) this.hooks.onLevel(Math.min(1, e.data * 4.5));
    };
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  }

  private async stopMeter() {
    const ctx = this.meterCtx;
    this.meterCtx = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
