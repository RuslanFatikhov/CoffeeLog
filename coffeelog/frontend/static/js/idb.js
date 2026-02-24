const DB_NAME = "coffeelog-db";
const DB_VERSION = 1;
const STORE_ENTRIES = "entries";

let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
        store.createIndex("by_created", "created_at");
        store.createIndex("by_brew_date", "brew_date");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function withStore(mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, mode);
    const store = tx.objectStore(STORE_ENTRIES);

    let result;
    try {
      result = action(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export async function getEntry(id) {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getAllEntries() {
  const entries = await withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });

  return entries.sort((a, b) => {
    const dateA = `${a.brew_date || ""}|${a.created_at || ""}`;
    const dateB = `${b.brew_date || ""}|${b.created_at || ""}`;
    return dateA < dateB ? 1 : -1;
  });
}

export async function putEntry(entry) {
  return withStore("readwrite", (store) => {
    store.put(entry);
  });
}

export async function putEntries(entries) {
  return withStore("readwrite", (store) => {
    entries.forEach((entry) => store.put(entry));
  });
}

export async function deleteEntry(id) {
  return withStore("readwrite", (store) => {
    store.delete(id);
  });
}

export async function getUnsyncedEntries() {
  const entries = await getAllEntries();
  return entries.filter((entry) => !entry.synced);
}
