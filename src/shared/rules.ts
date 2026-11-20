// Context-aware sharing: a single, central rules engine. Matching happens locally only.
import type { Settings, ShareFormat, SiteRule } from "./types";

export const BUILTIN_RULES: SiteRule[] = [
  { id: "gmail", name: "Gmail", pattern: "mail.google.com", format: "email-card", builtin: true },
  { id: "outlook", name: "Outlook", pattern: "outlook.office.com", format: "email-card", builtin: true },
  { id: "outlook-365", name: "Outlook", pattern: "outlook.office365.com", format: "email-card", builtin: true },
  { id: "outlook-live", name: "Outlook", pattern: "outlook.live.com", format: "email-card", builtin: true },
  { id: "outlook-cloud", name: "Outlook", pattern: "outlook.cloud.microsoft", format: "email-card", builtin: true },
  { id: "gdocs", name: "Google Docs", pattern: "docs.google.com", format: "link", builtin: true },
  { id: "classroom", name: "Google Classroom", pattern: "classroom.google.com", format: "link", builtin: true },
  { id: "slack", name: "Slack", pattern: "*.slack.com", format: "link", builtin: true },
  { id: "teams", name: "Microsoft Teams", pattern: "teams.microsoft.com", format: "link", builtin: true },
  { id: "teams-live", name: "Microsoft Teams", pattern: "teams.live.com", format: "link", builtin: true },
  { id: "teams-cloud", name: "Microsoft Teams", pattern: "teams.cloud.microsoft", format: "link", builtin: true },
];

export function moodleRules(hosts: string[]): SiteRule[] {
  return hosts
    .map((h) => normalisePattern(h))
    .filter(Boolean)
    .map((h) => ({ id: `moodle:${h}`, name: "Moodle", pattern: h, format: "embed" as const, builtin: true }));
}

/** Lower-cases and strips scheme / trailing slash so users can paste a URL. */
export function normalisePattern(input: string): string {
  let p = input.trim().toLowerCase();
  p = p.replace(/^[a-z]+:\/\//, "");
  p = p.replace(/\/+$/, "");
  return p;
}

export function isValidPattern(input: string): boolean {
  const p = normalisePattern(input);
  if (!p || p.length > 200) return false;
  const [host, ...rest] = p.split("/");
  if (!host || !/^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d+)?$/.test(host)) return false;
  return rest.join("/").length < 180;
}

/** Specificity score, or -1 when the pattern doesn't match. */
export function matchScore(pattern: string, url: URL): number {
  const p = normalisePattern(pattern);
  const slash = p.indexOf("/");
  const hostPat = slash === -1 ? p : p.slice(0, slash);
  const pathPat = slash === -1 ? "" : p.slice(slash);
  const host = url.hostname.toLowerCase();
  let hostOk = false;
  if (hostPat.startsWith("*.")) {
    const base = hostPat.slice(2);
    hostOk = host === base || host.endsWith(`.${base}`);
  } else {
    hostOk = host === hostPat.replace(/:\d+$/, "");
  }
  if (!hostOk) return -1;
  if (pathPat) {
    const prefix = pathPat.replace(/\*+$/, "");
    if (!url.pathname.toLowerCase().startsWith(prefix)) return -1;
  }
  return hostPat.replace("*.", "").length + pathPat.length * 2 + (hostPat.startsWith("*.") ? 0 : 1);
}

export interface SiteContext {
  /** Friendly site name, or null when unrecognised. */
  name: string | null;
  format: ShareFormat;
  rule: SiteRule | null;
  hostname: string | null;
}

export const UNKNOWN_CONTEXT: SiteContext = { name: null, format: "link", rule: null, hostname: null };

export function activeRules(settings: Pick<Settings, "customRules" | "moodleHosts" | "disabledBuiltins">): { custom: SiteRule[]; builtin: SiteRule[] } {
  const builtin = [...BUILTIN_RULES, ...moodleRules(settings.moodleHosts)].filter((r) => !settings.disabledBuiltins.includes(r.id));
  return { custom: settings.customRules, builtin };
}

/** Custom rules always override built-ins; within a group the most specific pattern wins. */
export function detectContext(rawUrl: string | undefined | null, settings: Pick<Settings, "customRules" | "moodleHosts" | "disabledBuiltins">): SiteContext {
  if (!rawUrl) return UNKNOWN_CONTEXT;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return UNKNOWN_CONTEXT;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return UNKNOWN_CONTEXT;
  const { custom, builtin } = activeRules(settings);
  for (const group of [custom, builtin]) {
    let best: SiteRule | null = null;
    let bestScore = -1;
    for (const r of group) {
      const s = matchScore(r.pattern, url);
      if (s > bestScore) {
        best = r;
        bestScore = s;
      }
    }
    if (best) return { name: best.name, format: best.format, rule: best, hostname: url.hostname };
  }
  return { ...UNKNOWN_CONTEXT, hostname: url.hostname };
}

export function recommendationHeadline(ctx: SiteContext): string {
  if (!ctx.name) return "Share this voice note";
  switch (ctx.format) {
    case "email-card":
      return `You're on ${ctx.name}. Copy an email-friendly voice-note card?`;
    case "embed":
      return `You're on ${ctx.name}. Copy the HTML embed?`;
    case "message":
      return `You're on ${ctx.name}. Copy a sharing message?`;
    default:
      return `You're on ${ctx.name}. Copy the share link?`;
  }
}

export const FORMAT_OPTIONS: { value: ShareFormat; label: string }[] = [
  { value: "email-card", label: "Rich Gmail/email card" },
  { value: "embed", label: "HTML embed" },
  { value: "link", label: "Plain link" },
  { value: "message", label: "Sharing message" },
];
