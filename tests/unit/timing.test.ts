import { describe, expect, it } from "vitest";
import { MAX_RECORDING_MS } from "../../src/shared/config";
import { defaultTitle, elapsedMs, formatClock, remainingMs } from "../../src/shared/timing";

describe("elapsed time from recorded timestamps", () => {
  it("adds the live segment to accumulated time", () => {
    expect(elapsedMs({ accumulatedMs: 30_000, segmentStartedAt: 1_000 }, 11_000)).toBe(40_000);
  });
  it("is frozen while paused", () => {
    expect(elapsedMs({ accumulatedMs: 42_000, segmentStartedAt: null }, 999_999)).toBe(42_000);
  });
  it("survives a closed popup — five minutes later the value is still correct", () => {
    const startedAt = Date.UTC(2026, 10, 20, 14, 35);
    expect(formatClock(elapsedMs({ accumulatedMs: 0, segmentStartedAt: startedAt }, startedAt + 5 * 60_000))).toBe("05:00");
  });
  it("never exceeds 15 minutes", () => {
    expect(elapsedMs({ accumulatedMs: 0, segmentStartedAt: 0 }, 60 * 60_000)).toBe(MAX_RECORDING_MS);
    expect(remainingMs({ accumulatedMs: 899_000, segmentStartedAt: null })).toBe(1_000);
  });
});

describe("default title", () => {
  it("uses British date and 24-hour time", () => {
    expect(defaultTitle(new Date(2026, 10, 20, 14, 35))).toBe("20 November 2026, 14:35");
    expect(defaultTitle(new Date(2026, 0, 3, 9, 5))).toBe("3 January 2026, 09:05");
  });
});
