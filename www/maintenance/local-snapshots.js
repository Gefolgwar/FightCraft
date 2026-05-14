/**
 * LocalSnapshotsManager — shared ES6 module for IndexedDB snapshot access.
 *
 * The Global World generation (admin-world.js) saves citadels and other
 * generated objects into local IndexedDB instead of Firestore.  This module
 * exposes the same storage so that admin-monsters.js (and any other consumer)
 * can read those snapshots without touching Firestore.
 *
 * Database : FightCraftLocalTemplates
 * Store    : local_snapshots
 */

export const LocalSnapshotsManager = {
  dbName: "FightCraftLocalTemplates",
  storeName: "local_snapshots",

  /** Open (or create) the IndexedDB database and return the db handle. */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /** Save (put/upsert) a snapshot object into the store. */
  async saveSnapshot(data) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      store.put(data);
      tx.oncomplete = () => resolve(data);
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Return all snapshots, sorted by `created` descending. */
  async getAll() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        const result = request.result || [];
        result.sort((a, b) => b.created - a.created);
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  },

  /** Get a single snapshot by its id. Returns the object or undefined. */
  async getById(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /** Delete a snapshot by id. */
  async deleteSnapshot(id) {
    const db = await this.init();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
};
