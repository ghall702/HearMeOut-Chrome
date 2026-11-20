import { AlertTriangle, Globe, Info, Loader2, Mic, Pause, Play, Plus, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { MAX_RECORDING_MS } from "../../shared/config";
import { draftBlob } from "../../shared/db";
import { bg } from "../../shared/messages";
import type { SiteContext } from "../../shared/rules";
import { defaultTitle, elapsedMs, formatClock } from "../../shared/timing";
import type { AuthSummary, RecState } from "../../shared/types";
import { openPermissionPage, useMicPermission, useNow, type ActiveTab } from "../hooks";
import { SharePanel } from "./SharePanel";
import { TranscriptBadge } from "./TranscriptBadge";
import { GoogleG, Notice } from "./ui";
import { Waveform } from "./Waveform";

type Toast = (t: string, k?: "ok" | "error") => void;

export function ContextChip({ ctx }: { ctx: SiteContext }) {
  if (!ctx.name) return null;
  return (
    <span className={`chip ${ctx.name ? "" : "neutral"}`}>
      <Globe /> {ctx.name ? `${ctx.name} detected` : "Share this voice note"}
    </span>
  );
}

export function RecordView({
  state,
  auth,
  ctx,
  tab,
  onToast,
  onSignIn,
}: {
  state: RecState;
  auth: AuthSummary;
  ctx: SiteContext;
  tab: ActiveTab;
  onToast: Toast;
  onSignIn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const perm = useMicPermission();
  const live = state.phase === "recording" || state.phase === "paused";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "mic-permission") {
        openPermissionPage(true);
        return;
      }
      onToast(err.message || "Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (perm === "prompt") return openPermissionPage(true);
    return run(() => bg({ type: "rec:start" }));
  };

  if (live) return <LiveRecording state={state} busy={busy} run={run} />;
  if (state.phase === "stopped" || state.phase === "error") return <Review state={state} auth={auth} busy={busy} run={run} onSignIn={onSignIn} />;
  if (state.phase === "saving" || state.phase === "uploading") return <Saving state={state} />;
  if (state.phase === "completed" && state.result)
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="row">
          <div className="grow">
            <div className="small muted">Saved to Hear Me Out</div>
            <h2 className="truncate" style={{ fontSize: 17 }}>{state.result.title}</h2>
          </div>
          <TranscriptBadge status={state.result.transcription_status} />
        </div>
        <ContextChip ctx={ctx} />
        <SharePanel result={state.result} ctx={ctx} tabId={tab.id} onToast={onToast} />
        <button type="button" className="btn btn-outline btn-block" onClick={() => run(() => bg({ type: "rec:new" }))}>
          <Plus /> Record another voice note
        </button>
      </div>
    );

  // idle
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ minHeight: 24 }}>
        <ContextChip ctx={ctx} />
      </div>
      <div className="recorder">
        <button type="button" className="big-btn" onClick={start} disabled={busy} aria-label="Record a Voice Note">
          {busy ? <Loader2 className="spin" /> : <Mic />}
        </button>
        <div className="big-label">Record a Voice Note</div>
        <div className="small muted center">Up to 15 minutes. Recording carries on while you switch tabs, windows or apps.</div>
      </div>
      {perm === "denied" && (
        <Notice kind="warn" icon={<AlertTriangle />}>
          Microphone access is blocked for Hear Me Out. <button type="button" className="btn btn-ghost" style={{ height: 26, padding: "0 6px" }} onClick={() => openPermissionPage(false)}>Fix this</button>
        </Notice>
      )}
    </div>
  );
}

function LiveRecording({ state, busy, run }: { state: RecState; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const now = useNow(state.phase === "recording");
  const ms = elapsedMs(state, now);
  const paused = state.phase === "paused";
  const left = MAX_RECORDING_MS - ms;
  return (
    <div className="recorder" style={{ paddingTop: 6 }}>
      <span className={`rec-pill ${paused ? "paused" : ""}`}>
        <span className="dot" /> {paused ? "PAUSED" : "REC"}
      </span>
      <div className="timer" aria-live="off">
        {formatClock(ms)}
        <small>/ 15:00</small>
      </div>
      <Waveform live paused={paused} />
      {left < 60_000 && <div className="small" style={{ color: "var(--rec)", fontWeight: 600 }}>Less than a minute left — recording stops at 15:00.</div>}
      <div className="controls">
        {paused ? (
          <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={() => run(() => bg({ type: "rec:resume" }))}>
            <Play /> Resume
          </button>
        ) : (
          <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={() => run(() => bg({ type: "rec:pause" }))}>
            <Pause /> Pause
          </button>
        )}
        <button type="button" className="btn btn-stop btn-lg" disabled={busy} onClick={() => run(() => bg({ type: "rec:stop" }))} autoFocus>
          {busy ? <Loader2 className="spin" /> : <Square />} Stop recording
        </button>
      </div>
      <div className="small muted center">You can close this window — recording continues in the background.</div>
    </div>
  );
}

const STOP_NOTES: Record<string, string> = {
  limit: "The 15-minute limit was reached, so recording stopped automatically.",
  "device-lost": "Your microphone was disconnected. Everything captured before that has been kept.",
  "recorder-error": "The recorder was interrupted. Everything captured before that has been kept.",
  interrupted: "This recording was interrupted (for example, Chrome closed). The audio saved so far has been recovered.",
};

function Review({
  state,
  auth,
  busy,
  run,
  onSignIn,
}: {
  state: RecState;
  auth: AuthSummary;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onSignIn: () => Promise<void>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [title, setTitle] = useState(state.title || defaultTitle(state.startedAt ?? Date.now()));
  const [confirm, setConfirm] = useState<null | "discard" | "restart">(null);
  useEffect(() => {
    if (!state.draftId) return;
    let url: string | null = null;
    void draftBlob(state.draftId, state.mime ?? "audio/webm").then(({ blob }) => {
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [state.draftId, state.mime]);

  const isError = state.phase === "error";
  const needsAuth = !auth.signedIn || !!auth.expired || state.step === "auth";
  const note = state.recovered && state.stopReason !== "interrupted" ? STOP_NOTES["interrupted"] : state.stopReason ? STOP_NOTES[state.stopReason] : undefined;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <h2 className="grow" style={{ fontSize: 17 }}>{isError ? "Upload needs attention" : "Review your voice note"}</h2>
        <span className="chip neutral">{formatClock(state.accumulatedMs)}</span>
      </div>
      {note && <Notice kind="warn" icon={<Info />}>{note}</Notice>}
      {isError && state.error && <Notice kind="error" icon={<AlertTriangle />}>{state.error}</Notice>}
      <div className="card stack">
        {src ? <audio controls src={src} preload="metadata" /> : <div className="progress indeterminate"><div /></div>}
        <label className="field">
          Title
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={isError} />
        </label>
      </div>
      {needsAuth ? (
        <button type="button" className="btn btn-outline btn-lg btn-block" onClick={() => void onSignIn()} disabled={busy}>
          <GoogleG /> {auth.expired || state.step === "auth" ? "Reconnect with Google to save" : "Sign in with Google to save"}
        </button>
      ) : isError ? (
        <button type="button" className="btn btn-hero btn-lg btn-block" disabled={busy} onClick={() => run(() => bg({ type: "rec:retry" }))}>
          {busy ? <Loader2 className="spin" /> : <RotateCcw />} Retry upload
        </button>
      ) : (
        <button type="button" className="btn btn-hero btn-lg btn-block" disabled={busy} onClick={() => run(() => bg({ type: "rec:save", title }))} autoFocus>
          {busy ? <Loader2 className="spin" /> : <Upload />} Save voice note
        </button>
      )}
      {confirm ? (
        <div className="card stack">
          <div className="small">{confirm === "discard" ? "Delete this recording? This can't be undone." : "Delete this recording and start again?"}</div>
          <div className="row">
            <button type="button" className="btn btn-danger grow" onClick={() => run(async () => {
              await bg({ type: "rec:discard" });
              if (confirm === "restart") await bg({ type: "rec:start" });
            })}>
              <Trash2 /> {confirm === "discard" ? "Delete" : "Delete and record"}
            </button>
            <button type="button" className="btn btn-outline grow" onClick={() => setConfirm(null)}>Keep it</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-ghost grow" onClick={() => setConfirm("restart")} disabled={busy}>
            <RotateCcw /> Record again
          </button>
          <button type="button" className="btn btn-danger grow" onClick={() => setConfirm("discard")} disabled={busy}>
            <Trash2 /> Discard
          </button>
        </div>
      )}
    </div>
  );
}

function Saving({ state }: { state: RecState }) {
  const pct = state.uploadProgress;
  return (
    <div className="stack" style={{ gap: 14, paddingTop: 24 }}>
      <div className="recorder" style={{ paddingTop: 0 }}>
        <span className="big-btn" style={{ cursor: "default" }} aria-hidden>
          <Upload />
        </span>
        <div className="big-label">{state.phase === "uploading" ? "Uploading…" : (state.step ?? "Saving…")}</div>
        <div className="small muted truncate" style={{ maxWidth: "100%" }}>{state.title}</div>
      </div>
      <div className={`progress ${pct == null ? "indeterminate" : ""}`} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct ?? 0}%` }} />
      </div>
      <div className="small muted center">Uploading straight to your Hear Me Out storage. You can close this window.</div>
    </div>
  );
}
