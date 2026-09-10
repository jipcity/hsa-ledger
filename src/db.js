import Dexie from "dexie";

/**
 * Two stores, split by what the data actually is.
 *
 * `state` holds the whole ledger as one JSON document under a fixed key. A
 * household generates a few hundred claims a year, so it is always read and
 * written as a unit — normalising it into tables would buy queries nobody runs.
 *
 * `documents` holds EOB files as real Blobs. That is the part a JSON store
 * cannot do, and the reason this app left the browser sandbox.
 */
export const db = new Dexie("hsa-ledger");

db.version(1).stores({
  state: "key",
  documents: "id, addedAt",
});

const STATE_KEY = "ledger";

export async function loadState() {
  const row = await db.state.get(STATE_KEY);
  return row ? row.value : null;
}

export async function saveState(value) {
  await db.state.put({ key: STATE_KEY, value });
}

export async function putDocument({ id, name, type, blob }) {
  await db.documents.put({ id, name, type, blob, addedAt: Date.now() });
}

export async function getDocument(id) {
  return db.documents.get(id);
}

export async function deleteDocument(id) {
  await db.documents.delete(id);
}

export async function documentSummary() {
  const all = await db.documents.toArray();
  return {
    count: all.length,
    bytes: all.reduce((s, d) => s + (d.blob?.size || 0), 0),
  };
}

export async function allDocuments() {
  return db.documents.toArray();
}

/**
 * Arbitrary keyed values in the same store as the ledger. Used for the backup
 * folder handle, which IndexedDB can structured-clone but localStorage cannot.
 */
export async function putMeta(key, value) {
  await db.state.put({ key, value });
}

export async function getMeta(key) {
  const row = await db.state.get(key);
  return row ? row.value : null;
}

/** Open an attached EOB in a new tab. Object URLs are revoked on unload. */
export async function openDocument(id) {
  const doc = await getDocument(id);
  if (!doc) return false;
  const url = URL.createObjectURL(doc.blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export async function wipeEverything() {
  await db.state.clear();
  await db.documents.clear();
}
