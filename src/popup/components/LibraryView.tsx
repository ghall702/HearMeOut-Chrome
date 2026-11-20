import { ExternalLink, FileText, Library as LibraryIcon, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HMO_ORIGIN } from "../../shared/config";
import { bg } from "../../shared/messages";
import type { SiteContext } from "../../shared/rules";
import { formatDate, formatDuration } from "../../shared/timing";
import type { AuthSummary, RecordingItem } from "../../shared/types";
import { ShareOptions, actionLabel, useCopy } from "./SharePanel";
import { ListenedBadge, TranscriptBadge } from "./TranscriptBadge";
import { Notice } from "./ui";

type Toast = (t: string, k?: "ok" | "error") => void;

export function LibraryView({ auth, ctx, onToast }: { auth: AuthSummary; ctx: SiteContext; onToast: Toast }) {
  const [items, setItems] = useState<RecordingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await bg<RecordingItem[]>({ type: "api:list" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Show this profile's cached list instantly, then refresh.
    void chrome.storage.local.get("libraryCache").then((r) => {
      const c = r["libraryCache"] as { userId: string | null; items: RecordingItem[] } | undefined;
      if (c && c.userId === auth.user?.id) setItems((cur) => cur ?? c.items);
    });
    void load();
  }, [load, auth.user?.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!items) return [];
    if (!s) return items;
    return items.filter((i) => i.title.toLowerCase().includes(s) || (i.transcript ?? "").toLowerCase().includes(s));
  }, [items, q]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <div className="search grow">
          <Search />
          <input className="input" placeholder="Search recordings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recordings" />
        </div>
        <button type="button" className="btn btn-outline btn-icon" onClick={load} aria-label="Refresh" disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {items == null ? (
        <div className="empty"><Loader2 className="spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <LibraryIcon />
          <div>{q ? "No recordings match your search." : "No recordings yet. Your voice notes will appear here."}</div>
        </div>
      ) : (
        <div className="list" role="list">
          {filtered.map((it) => (
            <LibraryItem key={it.id} item={it} ctx={ctx} open={open === it.id} onToggle={() => setOpen(open === it.id ? null : it.id)} onToast={onToast} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryItem({ item, ctx, open, onToggle, onToast }: { item: RecordingItem; ctx: SiteContext; open: boolean; onToggle: () => void; onToast: Toast }) {
  const [transcript, setTranscript] = useState<string | null | undefined>(undefined);
  const [loadingT, setLoadingT] = useState(false);
  const { copy } = useCopy(onToast);
  const ready = item.status === "ready";
  const viewTranscript = async () => {
    setLoadingT(true);
    try {
      const full = await bg<RecordingItem>({ type: "api:get", id: item.id });
      setTranscript(full.transcript ?? null);
    } catch (e) {
      onToast((e as Error).message, "error");
    } finally {
      setLoadingT(false);
    }
  };
  return (
    <div className={`item ${open ? "open" : ""}`} role="listitem">
      <button type="button" className="head" onClick={onToggle} aria-expanded={open}>
        <div className="grow">
          <div className="title truncate">{item.title}</div>
          <div className="meta">
            <span>{formatDate(item.created_at)}</span>·<span>{formatDuration(item.duration_seconds)}</span>
          </div>
        </div>
        <span className="chip neutral" title={`${item.play_count} plays`}>▶ {item.play_count}</span>
      </button>
      {open && (
        <div className="body">
          <div className="meta">
            <ListenedBadge firstPlayedAt={item.first_played_at} count={item.play_count} />
            <TranscriptBadge status={item.transcription_status} />
            {!ready && <span className="chip warn">{item.status === "pending" ? "Upload incomplete" : item.status}</span>}
          </div>
          {ready && (
            <>
              <button type="button" className="btn btn-hero btn-block" onClick={() => copy(ctx.format, item)}>
                <Sparkles /> {actionLabel(ctx.format, ctx)}{ctx.name ? ` · ${ctx.name}` : ""}
              </button>
              <ShareOptions item={item} ctx={ctx} onToast={onToast} compact />
            </>
          )}
          <div className="row">
            {item.transcription_status === "done" && (
              <button type="button" className="btn btn-outline grow" onClick={viewTranscript} disabled={loadingT}>
                {loadingT ? <Loader2 className="spin" /> : <FileText />} {transcript === undefined ? "View transcript" : "Reload transcript"}
              </button>
            )}
            <a className="btn btn-outline grow" href={`${HMO_ORIGIN}/recordings/${item.id}`} target="_blank" rel="noreferrer">
              <ExternalLink /> Open
            </a>
          </div>
          {transcript !== undefined && <div className="transcript">{transcript || "No transcript available."}</div>}
        </div>
      )}
    </div>
  );
}
