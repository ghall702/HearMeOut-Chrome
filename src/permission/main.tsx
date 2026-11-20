// One-off page that asks Chrome for microphone permission on behalf of the extension. The offscreen
// recorder can't show a permission prompt itself, but it inherits this grant.
import { CheckCircle2, Loader2, Mic, MicOff } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { bg } from "../shared/messages";
import { getSettings } from "../shared/settings";
import { applyTheme } from "../popup/theme";
import { LogoMark } from "../popup/components/ui";
import "../popup/styles.css";

const autostart = new URLSearchParams(location.search).get("start") === "1";

function PermissionPage() {
  const [phase, setPhase] = useState<"ask" | "working" | "granted" | "recording" | "denied">("ask");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getSettings().then((s) => applyTheme(s.theme));
    void navigator.permissions.query({ name: "microphone" as PermissionName }).then((p) => {
      if (p.state === "granted") setPhase("granted");
      if (p.state === "denied") setPhase("denied");
    });
  }, []);

  const ask = async () => {
    setPhase("working");
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setPhase("granted");
    } catch (e) {
      const name = (e as { name?: string }).name;
      setPhase(name === "NotAllowedError" ? "denied" : "ask");
      if (name !== "NotAllowedError") setError((e as Error).message || "The microphone couldn't be started.");
    }
  };

  const startNow = async () => {
    setPhase("working");
    try {
      await bg({ type: "rec:start" });
      setPhase("recording");
      setTimeout(() => window.close(), 1600);
    } catch (e) {
      setError((e as Error).message);
      setPhase("granted");
    }
  };

  return (
    <div className="card stack" style={{ maxWidth: 420, padding: 26, gap: 14, textAlign: "center", alignItems: "center" }}>
      <LogoMark size={52} />
      {phase === "recording" ? (
        <>
          <span className="rec-pill"><span className="dot" /> REC</span>
          <h1 style={{ fontSize: 22 }}>Recording</h1>
          <p className="muted" style={{ margin: 0 }}>You can close this tab and carry on working. Click the Hear Me Out icon to stop.</p>
        </>
      ) : phase === "granted" ? (
        <>
          <CheckCircle2 size={30} style={{ color: "var(--success)" }} />
          <h1 style={{ fontSize: 22 }}>Microphone ready</h1>
          <p className="muted" style={{ margin: 0 }}>Hear Me Out can now record in the background. You won't be asked again.</p>
          {autostart && (
            <button type="button" className="btn btn-hero btn-lg btn-block" onClick={startNow}>
              <Mic /> Start recording now
            </button>
          )}
          <button type="button" className="btn btn-outline btn-block" onClick={() => window.close()}>Close this tab</button>
        </>
      ) : phase === "denied" ? (
        <>
          <MicOff size={30} style={{ color: "var(--destructive)" }} />
          <h1 style={{ fontSize: 22 }}>Microphone blocked</h1>
          <p className="muted" style={{ margin: 0, textAlign: "left" }}>
            Click the microphone or tune icon at the right of the address bar on this page and choose <strong>Allow</strong>, then reload.
            On a Mac, also check <strong>System Settings → Privacy &amp; Security → Microphone</strong> and make sure Google Chrome is switched on.
            On Windows 11, check <strong>Settings → Privacy &amp; security → Microphone</strong>.
          </p>
          <button type="button" className="btn btn-outline btn-block" onClick={() => location.reload()}>Reload</button>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 22 }}>Allow microphone access</h1>
          <p className="muted" style={{ margin: 0 }}>
            Hear Me Out needs your microphone to record voice notes. Chrome will ask once; choose <strong>Allow</strong>.
          </p>
          {error && <div className="notice error">{error}</div>}
          <button type="button" className="btn btn-hero btn-lg btn-block" onClick={ask} disabled={phase === "working"} autoFocus>
            {phase === "working" ? <Loader2 className="spin" /> : <Mic />} Allow microphone
          </button>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PermissionPage />
  </StrictMode>,
);
