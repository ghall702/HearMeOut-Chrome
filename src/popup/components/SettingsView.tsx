import { ExternalLink, Keyboard, LogOut, Mic, Monitor, Moon, Pencil, Plus, Sun, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { HMO_ORIGIN } from "../../shared/config";
import { BUILTIN_RULES, FORMAT_OPTIONS, isValidPattern, normalisePattern } from "../../shared/rules";
import { saveSettings } from "../../shared/settings";
import type { AuthSummary, Settings, ShareFormat, SiteRule } from "../../shared/types";
import { openPermissionPage, useMicPermission } from "../hooks";
import { Notice, Switch, initials } from "./ui";

type Toast = (t: string, k?: "ok" | "error") => void;

export function SettingsView({ auth, settings, onSignOut, onToast }: { auth: AuthSummary; settings: Settings; onSignOut: () => Promise<void>; onToast: Toast }) {
  return (
    <div className="stack" style={{ gap: 10, maxHeight: 455, overflowY: "auto", margin: "0 -4px", padding: "0 4px 4px" }}>
      <Account auth={auth} onSignOut={onSignOut} />
      <Appearance settings={settings} />
      <Microphone settings={settings} />
      <WebsiteRules settings={settings} onToast={onToast} />
      <Shortcuts />
      <a className="btn btn-outline btn-block" href={HMO_ORIGIN} target="_blank" rel="noreferrer">
        <ExternalLink /> Open the Hear Me Out website
      </a>
      <div className="small muted center">Hear Me Out for Chrome {chrome.runtime.getManifest().version}</div>
    </div>
  );
}

function Account({ auth, onSignOut }: { auth: AuthSummary; onSignOut: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const u = auth.user;
  return (
    <>
      <div className="section-title">Account</div>
      <div className="card stack">
        <div className="row">
          <span className="avatar">{u?.avatar_url ? <img src={u.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(u?.name, u?.email)}</span>
          <div className="grow">
            <div className="truncate" style={{ fontWeight: 600 }}>{u?.name ?? u?.email ?? "Not signed in"}</div>
            <div className="truncate small muted">{u?.email}</div>
          </div>
        </div>
        <div className="small muted">This Chrome profile is connected to this Google account. Use Chrome's profile menu to work with a different account.</div>
        {confirm ? (
          <div className="row">
            <button type="button" className="btn btn-danger grow" onClick={() => void onSignOut()}>
              <LogOut /> Sign out and remove local data
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)} aria-label="Cancel"><X /></button>
          </div>
        ) : (
          <button type="button" className="btn btn-outline" onClick={() => setConfirm(true)}>
            <LogOut /> Sign out
          </button>
        )}
      </div>
    </>
  );
}

function Appearance({ settings }: { settings: Settings }) {
  const opts = [
    ["light", Sun, "Light"],
    ["dark", Moon, "Dark"],
    ["system", Monitor, "System"],
  ] as const;
  return (
    <>
      <div className="section-title">Appearance</div>
      <div className="seg">
        {opts.map(([v, Icon, l]) => (
          <button key={v} type="button" aria-pressed={settings.theme === v} onClick={() => void saveSettings({ theme: v })}>
            <Icon /> {l}
          </button>
        ))}
      </div>
    </>
  );
}

function Microphone({ settings }: { settings: Settings }) {
  const perm = useMicPermission();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === "audioinput" && x.deviceId !== "default" && x.deviceId !== "communications")))
        .catch(() => setDevices([]));
    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, [perm]);
  return (
    <>
      <div className="section-title">Microphone</div>
      <div className="card stack">
        {perm !== "granted" ? (
          <Notice kind="warn" icon={<Mic />}>
            {perm === "denied" ? "Microphone access is blocked." : "Hear Me Out hasn't been given microphone access yet."}{" "}
            <button type="button" className="btn btn-soft" style={{ height: 28, marginTop: 6 }} onClick={() => openPermissionPage(false)}>Allow microphone</button>
          </Notice>
        ) : (
          <label className="field">
            Input device
            <select className="select" value={settings.micDeviceId} onChange={(e) => void saveSettings({ micDeviceId: e.target.value })}>
              <option value="">System default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 600, fontSize: 13 }}>Noise suppression</div>
            <div className="small muted">Reduces background noise. Turn off for music.</div>
          </div>
          <Switch label="Noise suppression" checked={settings.noiseSuppression} onChange={(v) => void saveSettings({ noiseSuppression: v })} />
        </div>
      </div>
    </>
  );
}

const fmtLabel = (f: ShareFormat) => FORMAT_OPTIONS.find((o) => o.value === f)?.label ?? f;

function WebsiteRules({ settings, onToast }: { settings: Settings; onToast: Toast }) {
  const [editing, setEditing] = useState<SiteRule | null>(null);
  const [moodle, setMoodle] = useState("");
  const toggleBuiltin = (id: string, on: boolean) =>
    void saveSettings({ disabledBuiltins: on ? settings.disabledBuiltins.filter((x) => x !== id) : [...settings.disabledBuiltins, id] });
  const builtins = Array.from(new Map(BUILTIN_RULES.map((r) => [r.name, r])).values());
  const builtinIdsByName = (name: string) => BUILTIN_RULES.filter((r) => r.name === name).map((r) => r.id);

  const addMoodle = () => {
    const h = normalisePattern(moodle);
    if (!isValidPattern(h) || h.includes("/")) return onToast("Enter a hostname like lms.example.com", "error");
    if (!settings.moodleHosts.includes(h)) void saveSettings({ moodleHosts: [...settings.moodleHosts, h] });
    setMoodle("");
  };
  const saveRule = (r: SiteRule) => {
    const rules = settings.customRules.some((x) => x.id === r.id) ? settings.customRules.map((x) => (x.id === r.id ? r : x)) : [...settings.customRules, r];
    void saveSettings({ customRules: rules });
    setEditing(null);
    onToast("Website rule saved");
  };

  return (
    <>
      <div className="section-title">Website detection</div>
      <div className="card stack">
        <div className="small muted">Detection happens on this computer. Page addresses are never sent to Hear Me Out.</div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Your rules</div>
        {settings.customRules.length === 0 && <div className="small muted">No custom rules yet. Custom rules take priority over the built-in ones.</div>}
        {settings.customRules.map((r) => (
          <div key={r.id} className="rule">
            <div className="grow">
              <div className="truncate" style={{ fontWeight: 600 }}>{r.name}</div>
              <code className="truncate">{r.pattern}</code> · <span className="muted">{fmtLabel(r.format)}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${r.name}`} onClick={() => void saveSettings({ customRules: settings.customRules.filter((x) => x.id !== r.id) })}><Trash2 /></button>
          </div>
        ))}
        {editing ? (
          <RuleEditor rule={editing} onSave={saveRule} onCancel={() => setEditing(null)} onToast={onToast} />
        ) : (
          <button type="button" className="btn btn-outline" onClick={() => setEditing({ id: crypto.randomUUID(), name: "", pattern: "", format: "link" })}>
            <Plus /> Add website rule
          </button>
        )}

        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>Moodle sites (HTML embed)</div>
        {settings.moodleHosts.map((h) => (
          <div key={h} className="rule">
            <code className="grow truncate">{h}</code>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${h}`} onClick={() => void saveSettings({ moodleHosts: settings.moodleHosts.filter((x) => x !== h) })}><Trash2 /></button>
          </div>
        ))}
        <div className="row">
          <input className="input grow" placeholder="lms.example.com" value={moodle} onChange={(e) => setMoodle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMoodle()} aria-label="Add Moodle hostname" />
          <button type="button" className="btn btn-outline btn-icon" onClick={addMoodle} aria-label="Add Moodle site"><Plus /></button>
        </div>

        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>Built-in rules</div>
        {builtins.map((r) => {
          const ids = builtinIdsByName(r.name);
          const on = ids.some((id) => !settings.disabledBuiltins.includes(id));
          return (
            <div key={r.name} className="rule">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <span className="muted">{fmtLabel(r.format)}</span>
              </div>
              <Switch label={`${r.name} rule`} checked={on} onChange={(v) => ids.forEach((id) => toggleBuiltin(id, v))} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function RuleEditor({ rule, onSave, onCancel, onToast }: { rule: SiteRule; onSave: (r: SiteRule) => void; onCancel: () => void; onToast: Toast }) {
  const [r, setR] = useState(rule);
  const submit = () => {
    if (!r.name.trim()) return onToast("Give the website a name", "error");
    if (!isValidPattern(r.pattern)) return onToast("Enter a hostname such as example.com, *.example.com or example.com/path", "error");
    onSave({ ...r, name: r.name.trim(), pattern: normalisePattern(r.pattern) });
  };
  return (
    <div className="stack" style={{ padding: 10, borderRadius: 14, border: "1px dashed var(--border)" }}>
      <label className="field">
        Website name
        <input className="input" value={r.name} placeholder="School portal" onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus />
      </label>
      <label className="field">
        Hostname or URL pattern
        <input className="input" value={r.pattern} placeholder="portal.example.com or *.example.com/course" onChange={(e) => setR({ ...r, pattern: e.target.value })} />
      </label>
      <label className="field">
        Preferred sharing format
        <select className="select" value={r.format} onChange={(e) => setR({ ...r, format: e.target.value as ShareFormat })}>
          {FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" className="btn btn-hero grow" onClick={submit}>Save rule</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Shortcuts() {
  const [cmds, setCmds] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    void chrome.commands.getAll().then(setCmds);
  }, []);
  return (
    <>
      <div className="section-title">Keyboard shortcuts</div>
      <div className="card stack">
        {cmds.map((c) => (
          <div key={c.name} className="row small">
            <span className="grow">{c.name === "_execute_action" ? "Open Hear Me Out" : c.description}</span>
            {c.shortcut ? <kbd>{c.shortcut}</kbd> : <span className="muted">Not set</span>}
          </div>
        ))}
        <button type="button" className="btn btn-outline" onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
          <Keyboard /> Change shortcuts
        </button>
      </div>
    </>
  );
}
