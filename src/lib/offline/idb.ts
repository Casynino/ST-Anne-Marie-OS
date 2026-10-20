/** Minimal promise wrapper over IndexedDB (no dependency). Browser-only; tests use fake-indexeddb. */
const DB_NAME = "sam-attendance";
const DB_VERSION = 1;
export const STORES = { sheets: "sheets", ops: "ops", meta: "meta" } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available"));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.sheets)) db.createObjectStore(STORES.sheets, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.ops)) db.createObjectStore(STORES.ops, { keyPath: "opId" });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Closes the cached connection (used by tests and after clearing data). */
export async function closeDb() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const idb = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  getAll: <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  put: (store: StoreName, value: unknown) => run(store, "readwrite", (s) => s.put(value)),
  delete: (store: StoreName, key: string) => run(store, "readwrite", (s) => s.delete(key)),
  clear: (store: StoreName) => run(store, "readwrite", (s) => s.clear()),
};
