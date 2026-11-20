import { CheckCircle2, AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Toast } from "../hooks";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size, borderRadius: size * 0.36 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    </span>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      Hear Me Out
    </span>
  );
}

export function GoogleG() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

export function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.kind === "error" ? "error" : ""}`} role="status" aria-live="polite">
      {toast.kind === "error" ? <AlertCircle /> : <CheckCircle2 />}
      {toast.text}
    </div>
  );
}

export function Notice({ kind, icon, children }: { kind: "info" | "warn" | "error"; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : undefined}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function initials(name: string | null | undefined, email: string | null | undefined) {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
