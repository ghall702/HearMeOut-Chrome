// Sharing formats. The Gmail card mirrors gmailCardHtml() in the web app's src/lib/share-links.ts
// so cards look identical whether copied from the web app or the extension.
import type { ShareFormat } from "./types";

export const SHARE_MESSAGE_PREFIX = "Hey, I've recorded you a voice memo. Click here to listen: ";

export interface Shareable {
  shareUrl: string;
  embedCode: string;
}

/** Extracts the 32-char share token from a /s/<token> URL. */
export function shareTokenFrom(shareUrl: string): string | null {
  try {
    const m = /^\/s\/([a-z0-9]{16,64})\/?$/i.exec(new URL(shareUrl).pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function shareMessage(shareUrl: string): string {
  return `${SHARE_MESSAGE_PREFIX}${shareUrl}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Email-safe card: inline-styled table + linked card image (Gmail strips iframes/scripts/audio). */
export function gmailCardHtml(shareUrl: string): string {
  const token = shareTokenFrom(shareUrl);
  const origin = new URL(shareUrl).origin;
  const url = esc(shareUrl);
  const img = esc(`${origin}/api/public/card/${token ?? ""}`);
  return `<p style="font-family:Arial,sans-serif;font-size:15px;color:#1c1c1e;margin:0 0 12px">Hey, I've recorded you a voice memo. Click below to listen.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:480px;width:100%"><tr><td>
<a href="${url}" target="_blank" style="text-decoration:none;display:block"><img src="${img}" width="480" alt="▶ Play voice memo" style="display:block;width:100%;max-width:480px;height:auto;border:0;border-radius:16px"></a>
</td></tr><tr><td style="padding:10px 4px 0;font-family:Arial,sans-serif;font-size:14px">
<a href="${url}" target="_blank" style="color:#5f7d66;font-weight:bold;text-decoration:none">▶ Listen to voice memo</a>
</td></tr></table>`;
}

export interface ClipboardPayload {
  text: string;
  html?: string;
}

/** What goes on the clipboard for each format. Rich formats always include a text/plain fallback. */
export function clipboardPayload(format: ShareFormat, r: Shareable): ClipboardPayload {
  switch (format) {
    case "email-card":
      return { text: shareMessage(r.shareUrl), html: gmailCardHtml(r.shareUrl) };
    case "embed":
      return { text: r.embedCode };
    case "message":
      return { text: shareMessage(r.shareUrl) };
    case "link":
    default:
      return { text: r.shareUrl };
  }
}

export const FORMAT_LABELS: Record<ShareFormat, { action: string; short: string; copied: string }> = {
  "email-card": { action: "Copy for Gmail", short: "Email card", copied: "Email card copied — paste it into your message" },
  embed: { action: "Copy HTML Embed", short: "HTML embed", copied: "HTML embed copied — paste it into the HTML editor" },
  link: { action: "Copy Share Link", short: "Share link", copied: "Share link copied" },
  message: { action: "Copy Sharing Message", short: "Sharing message", copied: "Sharing message copied" },
};

/** Writes text/html + text/plain together where possible (popup and other focused extension pages). */
export async function writeClipboard(p: ClipboardPayload): Promise<void> {
  if (p.html && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([p.html], { type: "text/html" }),
          "text/plain": new Blob([p.text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* fall through to execCommand */
    }
  }
  if (!p.html) {
    try {
      await navigator.clipboard.writeText(p.text);
      return;
    } catch {
      /* fall through */
    }
  }
  if (!execCopy(p)) throw new Error("Couldn't copy to the clipboard");
}

/** document.execCommand("copy") with explicit formats — works in unfocused offscreen documents. */
export function execCopy(p: ClipboardPayload): boolean {
  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData?.setData("text/plain", p.text);
    if (p.html) e.clipboardData?.setData("text/html", p.html);
  };
  document.addEventListener("copy", onCopy, true);
  const ta = document.createElement("textarea");
  ta.value = p.text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy, true);
    ta.remove();
  }
}
