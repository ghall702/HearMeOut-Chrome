// IndexedDB for the extension origin. Shared by the service worker, offscreen document and popup,
// isolated per Chrome profile, and never reachable from web pages or content scripts.
//   drafts  — recording metadata + resumable upload stage
//   chunks  — 1-second audio chunks, written as they are recorded
//   secure  — authentication session (kept out of chrome.storage, which content scripts can read)
import type { AuthSession, Chunk, Draft } from "./types";

const DB_NAME = "hearmeout";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["draftId", "seq"] });
      if (!db.objectStoreNames.contains("secure")) db.createObjectStore("secure");
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- drafts ----
export async function putDraft(d: Draft): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("drafts", "readwrite");
  tx.objectStore("drafts").put(d);
  await done(tx);
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  const db = await openDb();
  return result(db.transaction("drafts").objectStore("drafts").get(id) as IDBRequest<Draft | undefined>);
}

export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft | undefined> {
  const db = await openDb();
  const tx = db.transaction("drafts", "readwrite");
  const store = tx.objectStore("drafts");
  const cur = (await result(store.get(id) as IDBRequest<Draft | undefined>)) ?? undefined;
  let next: Draft | undefined;
  if (cur) {
    next = { ...cur, ...patch };
    store.put(next);
  }
  await done(tx);
  return next;
}

export async function listDrafts(): Promise<Draft[]> {
  const db = await openDb();
  const all = await result(db.transaction("drafts").objectStore("drafts").getAll() as IDBRequest<Draft[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes a draft and all of its audio chunks. */
export async function deleteDraft(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["drafts", "chunks"], "readwrite");
  tx.objectStore("drafts").delete(id);
  tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await done(tx);
}

export async function clearAllDrafts(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["drafts", "chunks"], "readwrite");
  tx.objectStore("drafts").clear();
  tx.objectStore("chunks").clear();
  await done(tx);
}

// ---- chunks ----
export async function putChunk(c: Chunk): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("chunks", "readwrite");
  tx.objectStore("chunks").put(c);
  await done(tx);
}

export async function getChunks(draftId: string): Promise<Chunk[]> {
  const db = await openDb();
  const range = IDBKeyRange.bound([draftId, 0], [draftId, Number.MAX_SAFE_INTEGER]);
  const rows = await result(db.transaction("chunks").objectStore("chunks").getAll(range) as IDBRequest<Chunk[]>);
  return rows.sort((a, b) => a.seq - b.seq);
}

/** Reassembles the original recorded bytes — chunks are concatenated, never re-encoded. */
export async function draftBlob(draftId: string, mime: string): Promise<{ blob: Blob; lastElapsedMs: number; count: number }> {
  const chunks = await getChunks(draftId);
  return {
    blob: new Blob(chunks.map((c) => c.blob), { type: mime.split(";")[0] }),
    lastElapsedMs: chunks.at(-1)?.elapsedMs ?? 0,
    count: chunks.length,
  };
}

// ---- secure (auth) ----
const AUTH_KEY = "session";

export async function getAuthSession(): Promise<AuthSession | null> {
  const db = await openDb();
  return ((await result(db.transaction("secure").objectStore("secure").get(AUTH_KEY))) as AuthSession | undefined) ?? null;
}

export async function setAuthSession(s: AuthSession | null): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("secure", "readwrite");
  if (s) tx.objectStore("secure").put(s, AUTH_KEY);
  else tx.objectStore("secure").delete(AUTH_KEY);
  await done(tx);
}

/** Test helper. */
export function _resetDbForTests() {
  dbPromise = null;
}
