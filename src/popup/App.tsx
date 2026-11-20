import { Library, Loader2, Mic, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { bg } from "../shared/messages";
import type { AuthSummary, RecState } from "../shared/types";
import { useActiveContext, useAuth, useRecState, useSettings, useToast } from "./hooks";
import { LibraryView } from "./components/LibraryView";
import { RecordView } from "./components/RecordView";
import { SettingsView } from "./components/SettingsView";
import { GoogleG, Logo, LogoMark, Notice, ToastView } from "./components/ui";
import { applyTheme } from "./theme";

type Tab = "record" | "library" | "settings";
const TABS: { id: Tab; label: string; Icon: typeof Mic }[] = [
  { id: "record", label: "Record", Icon: Mic },
  { id: "library", label: "Library", Icon: Library },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

export function App() {
  const state = useRecState();
  const { auth, setAuth } = useAuth();
  const { settings } = useSettings();
  const { ctx, tab } = useActiveContext(settings);
  const { toast, show } = useToast();
  const [view, setView] = useState<Tab>("record");
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const signIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      setAuth(await bg<AuthSummary>({ type: "auth:signin" }));
      show("Signed in");
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code !== "cancelled") setAuthError(err.message);
    } finally {
      setSigningIn(false);
    }
  };
  const signOut = async () => {
    setAuth(await bg<AuthSummary>({ type: "auth:signout" }));
    setView("record");
    show("Signed out");
  };

  if (!state || !auth)
    return (
      <div className="app" style={{ placeItems: "center", display: "grid" }}>
        <Loader2 className="spin muted" />
      </div>
    );

  const live = state.phase === "recording" || state.phase === "paused";
  const showSignIn = !auth.signedIn && (state.phase === "idle" || state.phase === "completed");

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === view);
    if (e.key === "ArrowRight") setView(TABS[(i + 1) % TABS.length]!.id);
    if (e.key === "ArrowLeft") setView(TABS[(i + TABS.length - 1) % TABS.length]!.id);
  };

  return (
    <div className="app">
      <header className="header">
        <Logo />
        {live && (
          <span className={`rec-pill ${state.phase === "paused" ? "paused" : ""}`}>
            <span className="dot" /> {state.phase === "paused" ? "PAUSED" : "REC"}
          </span>
        )}
      </header>
      {showSignIn ? (
        <SignIn auth={auth} busy={signingIn} error={authError} onSignIn={signIn} />
      ) : (
        <>
          <div className="nav" role="tablist" aria-label="Hear Me Out" onKeyDown={onTabKey}>
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)}>
                {id === "record" && live ? <span className="dot" /> : <Icon size={14} />} {label}
              </button>
            ))}
          </div>
          <main className="main" key={view}>
            {authError && <Notice kind="error">{authError}</Notice>}
            {view === "record" && <RecordView state={state as RecState} auth={auth} ctx={ctx} tab={tab} onToast={show} onSignIn={signIn} />}
            {view === "library" &&
              (auth.signedIn ? <LibraryView auth={auth} ctx={ctx} onToast={show} /> : <SignIn auth={auth} busy={signingIn} error={null} onSignIn={signIn} compact />)}
            {view === "settings" && <SettingsView auth={auth} settings={settings} onSignOut={signOut} onToast={show} />}
          </main>
        </>
      )}
      <ToastView toast={toast} />
    </div>
  );
}

function SignIn({ auth, busy, error, onSignIn, compact }: { auth: AuthSummary; busy: boolean; error: string | null; onSignIn: () => void; compact?: boolean }) {
  return (
    <main className="main" style={{ justifyContent: compact ? "flex-start" : "center", gap: 16, padding: compact ? undefined : "24px 22px" }}>
      {!compact && (
        <div className="stack" style={{ alignItems: "center", gap: 14, textAlign: "center" }}>
          <LogoMark size={56} />
          <h1 style={{ fontSize: 24, lineHeight: 1.1 }}>
            Say it once.
            <br />
            <span style={{ background: "var(--gradient-primary)", WebkitBackgroundClip: "text", color: "transparent" }}>Share it anywhere.</span>
          </h1>
          <p className="muted" style={{ margin: 0 }}>Record a voice note from any tab and get the right sharing format for the site you're on.</p>
        </div>
      )}
      {auth.expired && auth.user?.email && (
        <Notice kind="warn">Your session for <strong>{auth.user.email}</strong> has expired. Reconnect to carry on.</Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <button
        type="button"
        className="btn btn-lg btn-block"
        style={{ background: "#fff", color: "#1f1f1f", border: "1px solid #747775", boxShadow: "var(--shadow-soft)" }}
        onClick={onSignIn}
        disabled={busy}
        autoFocus
      >
        {busy ? <Loader2 className="spin" /> : <GoogleG />} {auth.expired ? "Reconnect with Google" : "Sign in with Google"}
      </button>
      <div className="row small muted" style={{ justifyContent: "center" }}>
        <ShieldCheck size={14} /> Private service — authorised accounts only.
      </div>
      <p className="small muted center" style={{ margin: 0 }}>Each Chrome profile signs in separately, so your personal, work and teaching profiles stay apart.</p>
    </main>
  );
}
