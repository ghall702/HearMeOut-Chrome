import { Check, Code2, Copy, ExternalLink, Link2, Mail, MessageSquareText, Sparkles, TextCursorInput } from "lucide-react";
import { useState } from "react";
import { HMO_ORIGIN } from "../../shared/config";
import { recommendationHeadline, type SiteContext } from "../../shared/rules";
import { FORMAT_LABELS, clipboardPayload, gmailCardHtml, writeClipboard, type Shareable } from "../../shared/share";
import type { ShareFormat } from "../../shared/types";
import { insertGmailCard } from "../insert";

const ICONS: Record<ShareFormat, typeof Mail> = { "email-card": Mail, embed: Code2, link: Link2, message: MessageSquareText };

export function actionLabel(format: ShareFormat, ctx: SiteContext) {
  if (format === "email-card" && ctx.name === "Outlook") return "Copy for Outlook";
  return FORMAT_LABELS[format].action;
}

export function useCopy(onToast: (t: string, k?: "ok" | "error") => void) {
  const [copied, setCopied] = useState<ShareFormat | null>(null);
  const copy = async (format: ShareFormat, r: Shareable) => {
    try {
      await writeClipboard(clipboardPayload(format, r));
      setCopied(format);
      onToast("Copied to clipboard");
      setTimeout(() => setCopied((c) => (c === format ? null : c)), 1800);
    } catch {
      onToast("Couldn't copy — please try again", "error");
    }
  };
  return { copied, copy };
}

export function ShareOptions({
  item,
  ctx,
  onToast,
  compact = false,
}: {
  item: Shareable & { id: string };
  ctx: SiteContext;
  onToast: (t: string, k?: "ok" | "error") => void;
  compact?: boolean;
}) {
  const { copied, copy } = useCopy(onToast);
  const formats: ShareFormat[] = ["email-card", "embed", "link", "message"];
  return (
    <div className="share-grid">
      {formats.map((f) => {
        const Icon = copied === f ? Check : ICONS[f];
        const rec = f === ctx.format;
        return (
          <button
            key={f}
            type="button"
            className={`btn ${rec ? "btn-soft recommended" : "btn-outline"} ${copied === f ? "copied" : ""}`}
            onClick={() => copy(f, item)}
            title={rec ? "Recommended for this website" : undefined}
          >
            <Icon /> {compact ? FORMAT_LABELS[f].short : actionLabel(f, ctx).replace(/^Copy /, "")}
          </button>
        );
      })}
    </div>
  );
}

export function SharePanel({
  result,
  ctx,
  tabId,
  onToast,
}: {
  result: Shareable & { id: string; title: string; transcription_status?: string | undefined };
  ctx: SiteContext;
  tabId: number | null;
  onToast: (t: string, k?: "ok" | "error") => void;
}) {
  const { copied, copy } = useCopy(onToast);
  const PrimaryIcon = copied === ctx.format ? Check : ICONS[ctx.format];
  const canInsert = ctx.rule?.id === "gmail" && tabId != null;
  const insert = async () => {
    try {
      const r = await insertGmailCard(tabId!, gmailCardHtml(result.shareUrl));
      if (r === "inserted") onToast("Inserted into your email");
      else if (r === "ambiguous") onToast("Click inside the email you're writing, then try again", "error");
      else onToast("Open a Gmail compose window first", "error");
    } catch {
      onToast("Couldn't insert — use Copy for Gmail instead", "error");
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="share-primary">
        <div className="row">
          <Sparkles size={16} className="muted" style={{ color: "var(--accent-foreground)" }} />
          <span className="headline">{recommendationHeadline(ctx)}</span>
        </div>
        <button type="button" className={`btn btn-hero btn-lg btn-block ${copied === ctx.format ? "copied" : ""}`} onClick={() => copy(ctx.format, result)} autoFocus>
          <PrimaryIcon /> {copied === ctx.format ? "Copied to clipboard" : actionLabel(ctx.format, ctx)}
        </button>
        {canInsert && (
          <button type="button" className="btn btn-outline btn-block" onClick={insert}>
            <TextCursorInput /> Insert into Gmail
          </button>
        )}
      </div>
      <div className="linkbox">
        <span className="grow truncate">{result.shareUrl}</span>
        <button type="button" className={`btn btn-ghost btn-icon ${copied === "link" ? "copied" : ""}`} aria-label="Copy share link" onClick={() => copy("link", result)}>
          {copied === "link" ? <Check /> : <Copy />}
        </button>
      </div>
      <div className="small muted" style={{ marginBottom: -4 }}>Other formats</div>
      <ShareOptions item={result} ctx={ctx} onToast={onToast} />
      <a className="btn btn-ghost btn-block" href={`${HMO_ORIGIN}/recordings/${result.id}`} target="_blank" rel="noreferrer">
        <ExternalLink /> Open in Hear Me Out
      </a>
    </div>
  );
}
