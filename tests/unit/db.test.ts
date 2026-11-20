import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllDrafts, deleteDraft, draftBlob, getAuthSession, getChunks, listDrafts, putChunk, putDraft, setAuthSession, updateDraft } from "../../src/shared/db";
import type { Draft } from "../../src/shared/types";

const draft = (id: string, createdAt = Date.now()): Draft => ({ id, createdAt, mime: "audio/webm;codecs=opus", status: "recording", accumulatedMs: 0, segmentStartedAt: createdAt, bytes: 0, chunks: 0, stage: "none" });

describe("IndexedDB recording storage", () => {
  beforeEach(async () => {
    await clearAllDrafts();
    await setAuthSession(null);
  });

  it("reassembles chunks in order without altering bytes", async () => {
    await putDraft(draft("a"));
    // written out of order on purpose
    await putChunk({ draftId: "a", seq: 2, blob: new Blob([new Uint8Array([5, 6])]), elapsedMs: 3000 });
    await putChunk({ draftId: "a", seq: 0, blob: new Blob([new Uint8Array([1, 2])]), elapsedMs: 1000 });
    await putChunk({ draftId: "a", seq: 1, blob: new Blob([new Uint8Array([3, 4])]), elapsedMs: 2000 });
    const { blob, lastElapsedMs, count } = await draftBlob("a", "audio/webm;codecs=opus");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(blob.type).toBe("audio/webm");
    expect(lastElapsedMs).toBe(3000);
    expect(count).toBe(3);
  });

  it("deleting one draft keeps other drafts' audio", async () => {
    await putDraft(draft("a", 1));
    await putDraft(draft("b", 2));
    await putChunk({ draftId: "a", seq: 0, blob: new Blob(["x"]), elapsedMs: 1000 });
    await putChunk({ draftId: "b", seq: 0, blob: new Blob(["y"]), elapsedMs: 1000 });
    await deleteDraft("a");
    expect(await getChunks("a")).toHaveLength(0);
    expect(await getChunks("b")).toHaveLength(1);
    expect((await listDrafts()).map((d) => d.id)).toEqual(["b"]);
  });

  it("persists upload stage for resumable retries", async () => {
    await putDraft(draft("c"));
    await updateDraft("c", { stage: "authorised", recordingId: "rec-1" });
    const [d] = await listDrafts();
    expect(d!.stage).toBe("authorised");
    expect(d!.recordingId).toBe("rec-1");
  });

  it("stores and clears the auth session", async () => {
    await setAuthSession({ access_token: "a.b.c", refresh_token: "r", expires_at: 1, user: { id: "u", email: "e", name: null, avatar_url: null } });
    expect((await getAuthSession())?.refresh_token).toBe("r");
    await setAuthSession(null);
    expect(await getAuthSession()).toBeNull();
  });
});
