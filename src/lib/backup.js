import { getMeta, putMeta, allDocuments, putDocument } from "../db.js";

/**
 * One person, one computer. That removes sync from the problem list and leaves
 * exactly one real risk: this machine, or its browser storage, going away.
 *
 * So instead of a Download button the user has to remember, the app writes a
 * full backup — ledger plus every attached EOB — into a folder they pick once.
 * Point it at iCloud Drive, Dropbox or OneDrive and the backup is offsite,
 * versioned by that service, and requires no further thought.
 *
 * Needs the File System Access API: Chrome, Edge and other Chromium browsers on
 * desktop. Safari doesn't implement showDirectoryPicker, so it falls back to
 * manual downloads plus a reminder.
 */

const FOLDER_KEY = "backupFolder";
const LAST_KEY = "lastBackupAt";
const LEDGER_FILE = "ledger.json";
const DOC_DIR = "documents";

export const canAutoBackup = () =>
  typeof window !== "undefined" && "showDirectoryPicker" in window;

const safeName = (s) => String(s || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 80);

export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({
    id: "hsa-ledger-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  await putMeta(FOLDER_KEY, handle);
  return handle;
}

export async function forgetFolder() {
  await putMeta(FOLDER_KEY, null);
}

/**
 * Directory handles survive in IndexedDB, but the permission grant does not
 * always survive a browser restart — it can drop back to "prompt", and
 * re-granting needs a user gesture. Hence the reconnect button in Setup.
 */
export async function folderStatus() {
  if (!canAutoBackup()) return { state: "unsupported" };
  let handle;
  try {
    handle = await getMeta(FOLDER_KEY);
  } catch (err) {
    handle = null;
  }
  if (!handle) return { state: "none" };
  let permission = "prompt";
  try {
    permission = await handle.queryPermission({ mode: "readwrite" });
  } catch (err) {
    return { state: "none" };
  }
  return {
    state: permission,
    name: handle.name,
    handle,
    lastAt: await getMeta(LAST_KEY).catch(() => null),
  };
}

export async function reconnectFolder() {
  const handle = await getMeta(FOLDER_KEY);
  if (!handle) return "none";
  return handle.requestPermission({ mode: "readwrite" });
}

async function writeFile(dir, name, contents) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(contents);
  await w.close();
}

export async function writeBackup(data) {
  const status = await folderStatus();
  if (status.state !== "granted") return { ok: false, reason: status.state };

  const dir = status.handle;
  await writeFile(dir, LEDGER_FILE, JSON.stringify({ ...data, exportedAt: Date.now() }, null, 2));

  // Attached EOBs go alongside, written once and then skipped.
  const docs = await allDocuments();
  if (docs.length) {
    const sub = await dir.getDirectoryHandle(DOC_DIR, { create: true });
    const manifest = [];
    for (const doc of docs) {
      const name = `${doc.id}-${safeName(doc.name)}`;
      manifest.push({ id: doc.id, name: doc.name, file: name, type: doc.type });
      let exists = true;
      try {
        await sub.getFileHandle(name);
      } catch (err) {
        exists = false;
      }
      if (!exists) await writeFile(sub, name, doc.blob);
    }
    await writeFile(dir, "documents.json", JSON.stringify(manifest, null, 2));
  }

  const at = Date.now();
  await putMeta(LAST_KEY, at);
  return { ok: true, at };
}

/** Restore from a ledger.json produced above, or from a manual download. */
export async function readBackupFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.expenses) || !Array.isArray(parsed.planYears)) {
    throw new Error("That doesn't look like a ledger backup.");
  }
  return parsed;
}

/**
 * Pull the EOB files back in too, when restoring from a backup folder that has
 * a documents/ directory next to ledger.json.
 */
export async function restoreDocumentsFrom(dirHandle) {
  let sub;
  try {
    sub = await dirHandle.getDirectoryHandle(DOC_DIR);
  } catch (err) {
    return 0;
  }
  let manifest = [];
  try {
    const mf = await dirHandle.getFileHandle("documents.json");
    manifest = JSON.parse(await (await mf.getFile()).text());
  } catch (err) {
    manifest = [];
  }
  let restored = 0;
  for (const entry of manifest) {
    try {
      const fh = await sub.getFileHandle(entry.file);
      const blob = await fh.getFile();
      await putDocument({ id: entry.id, name: entry.name, type: entry.type, blob });
      restored += 1;
    } catch (err) {
      /* file missing, skip */
    }
  }
  return restored;
}

export const daysSince = (ts) => (ts ? Math.floor((Date.now() - ts) / 86400000) : null);
