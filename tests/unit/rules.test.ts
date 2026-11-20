import { describe, expect, it } from "vitest";
import { detectContext, isValidPattern, recommendationHeadline } from "../../src/shared/rules";
import { DEFAULT_SETTINGS, type Settings } from "../../src/shared/types";

const s = (patch: Partial<Settings> = {}) => ({ ...DEFAULT_SETTINGS, ...patch });

describe("built-in website rules", () => {
  it.each([
    ["https://mail.google.com/mail/u/0/#inbox?compose=new", "Gmail", "email-card"],
    ["https://lms.georgehilltuition.com/course/view.php?id=4", "Moodle", "embed"],
    ["https://lms.georgehalltuition.com/mod/assign/view.php?id=9", "Moodle", "embed"],
    ["https://outlook.office.com/mail/inbox", "Outlook", "email-card"],
    ["https://outlook.live.com/mail/0/", "Outlook", "email-card"],
    ["https://docs.google.com/document/d/abc/edit", "Google Docs", "link"],
    ["https://classroom.google.com/c/123", "Google Classroom", "link"],
    ["https://app.slack.com/client/T1/C1", "Slack", "link"],
    ["https://myteam.slack.com/messages", "Slack", "link"],
    ["https://teams.microsoft.com/v2/", "Microsoft Teams", "link"],
  ])("%s → %s (%s)", (url, name, format) => {
    const c = detectContext(url, s());
    expect(c.name).toBe(name);
    expect(c.format).toBe(format);
  });

  it("unknown sites get a plain share link", () => {
    const c = detectContext("https://example.org/page", s());
    expect(c.name).toBeNull();
    expect(c.format).toBe("link");
    expect(recommendationHeadline(c)).toBe("Share this voice note");
  });

  it("ignores non-web pages and junk", () => {
    expect(detectContext("chrome://extensions", s()).name).toBeNull();
    expect(detectContext("not a url", s()).name).toBeNull();
    expect(detectContext(undefined, s()).name).toBeNull();
  });

  it("does not match look-alike hosts", () => {
    expect(detectContext("https://mail.google.com.evil.example/", s()).name).toBeNull();
    expect(detectContext("https://notslack.com/", s()).name).toBeNull();
  });

  it("headlines match the spec", () => {
    expect(recommendationHeadline(detectContext("https://mail.google.com/", s()))).toBe("You're on Gmail. Copy an email-friendly voice-note card?");
    expect(recommendationHeadline(detectContext("https://lms.georgehalltuition.com/", s()))).toBe("You're on Moodle. Copy the HTML embed?");
  });
});

describe("configurable rules", () => {
  it("custom rules override built-ins", () => {
    const c = detectContext("https://mail.google.com/", s({ customRules: [{ id: "x", name: "Work mail", pattern: "mail.google.com", format: "message" }] }));
    expect(c.name).toBe("Work mail");
    expect(c.format).toBe("message");
  });
  it("supports wildcard and path patterns, most specific first", () => {
    const rules = [
      { id: "a", name: "Portal", pattern: "*.example.edu", format: "link" as const },
      { id: "b", name: "Portal course", pattern: "portal.example.edu/course/*", format: "embed" as const },
    ];
    expect(detectContext("https://portal.example.edu/course/7", s({ customRules: rules })).name).toBe("Portal course");
    expect(detectContext("https://portal.example.edu/home", s({ customRules: rules })).name).toBe("Portal");
    expect(detectContext("https://example.edu/", s({ customRules: rules })).name).toBe("Portal");
  });
  it("Moodle hosts are configurable", () => {
    expect(detectContext("https://moodle.school.test/", s({ moodleHosts: ["moodle.school.test"] })).format).toBe("embed");
    expect(detectContext("https://lms.georgehalltuition.com/", s({ moodleHosts: [] })).name).toBeNull();
  });
  it("built-ins can be switched off", () => {
    expect(detectContext("https://mail.google.com/", s({ disabledBuiltins: ["gmail"] })).name).toBeNull();
  });
  it("validates patterns", () => {
    expect(isValidPattern("https://Example.com/")).toBe(true);
    expect(isValidPattern("*.example.com")).toBe(true);
    expect(isValidPattern("example.com/course/*")).toBe(true);
    expect(isValidPattern("")).toBe(false);
    expect(isValidPattern("exa mple.com")).toBe(false);
  });
});
