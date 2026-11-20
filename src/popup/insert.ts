// Optional direct insertion into a Gmail compose window. Runs only on an explicit click, via
// chrome.scripting + activeTab (no persistent content script, nothing reads the email).

/** Injected into the page. Must be self-contained. Never sends, never replaces existing content. */
export function insertIntoGmailCompose(html: string): "inserted" | "no-editor" | "ambiguous" {
  const editors = Array.from(document.querySelectorAll<HTMLElement>('div[contenteditable="true"][g_editable="true"][role="textbox"]')).filter(
    (el) => el.offsetParent !== null,
  );
  if (editors.length === 0) return "no-editor";
  const active = document.activeElement as HTMLElement | null;
  const target = editors.find((el) => el === active || el.contains(active)) ?? (editors.length === 1 ? editors[0]! : null);
  if (!target) return "ambiguous";
  target.focus();
  const sel = window.getSelection();
  if (!sel) return "no-editor";
  // Keep the user's caret if it's inside this editor; otherwise append at the end. Collapse any
  // selection so highlighted text is never replaced.
  if (!sel.rangeCount || !target.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(target);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  } else if (!sel.isCollapsed) {
    sel.collapseToEnd();
  }
  // insertHTML goes through the editor's normal paste/sanitisation path.
  return document.execCommand("insertHTML", false, `${html}<br>`) ? "inserted" : "no-editor";
}

export async function insertGmailCard(tabId: number, html: string): Promise<string> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: insertIntoGmailCompose, args: [html] });
  return (res?.result as string | undefined) ?? "no-editor";
}
