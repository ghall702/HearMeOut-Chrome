import { describe, expect, it } from "vitest";
import { clipboardPayload, gmailCardHtml, shareMessage, shareTokenFrom } from "../../src/shared/share";

const shareUrl = "https://hearmeout.george-hall.uk/s/3fa85f64c9d44e599e8b7c02b8d0e123";
const embedCode =
  '<iframe src="https://hearmeout.george-hall.uk/embed/3fa85f64c9d44e599e8b7c02b8d0e123" width="100%" height="152" frameborder="0" allow="autoplay" style="border-radius:16px;max-width:560px" title="Hear Me Out voice note"></iframe>';
const r = { shareUrl, embedCode };

describe("sharing formats", () => {
  it("extracts the share token", () => {
    expect(shareTokenFrom(shareUrl)).toBe("3fa85f64c9d44e599e8b7c02b8d0e123");
    expect(shareTokenFrom("https://hearmeout.george-hall.uk/recordings/abc")).toBeNull();
  });
  it("Gmail card links the card image and the listening page, with no iframe or audio", () => {
    const html = gmailCardHtml(shareUrl);
    expect(html).toContain(`src="https://hearmeout.george-hall.uk/api/public/card/3fa85f64c9d44e599e8b7c02b8d0e123"`);
    expect(html).toContain(`href="${shareUrl}"`);
    expect(html).toContain("Hey, I've recorded you a voice memo.");
    expect(html).not.toMatch(/<iframe|<audio|<script/i);
  });
  it("email card copies html + plain-text fallback", () => {
    const p = clipboardPayload("email-card", r);
    expect(p.html).toBeDefined();
    expect(p.text).toBe(`Hey, I've recorded you a voice memo. Click here to listen: ${shareUrl}`);
  });
  it("embed copies the API's iframe unchanged", () => {
    expect(clipboardPayload("embed", r)).toEqual({ text: embedCode });
  });
  it("link and message", () => {
    expect(clipboardPayload("link", r)).toEqual({ text: shareUrl });
    expect(clipboardPayload("message", r).text).toBe(shareMessage(shareUrl));
    expect(shareMessage(shareUrl)).not.toMatch(/Untitled/);
  });
});
