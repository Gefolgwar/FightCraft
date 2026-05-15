/**
 * Defeated State Manager
 *
 * Tracks mutable state for procedurally generated objects:
 * - Defeated monsters (respawn timer)
 * - Captured castles (longer cooldown)
 * - Purchased shop items (future)
 *
 * This is a thin facade over SyncEngine's defeated_objects IndexedDB store
 * and Firestore collection.  It provides the "Defeated State Manager"
 * interface described in the PRD without duplicating SyncEngine internals.
 *
 * Storage model:
 *   IndexedDB  — immediate local state (offline-capable)
 *   Firestore  — cross-player visibility (defeated_objects collection)
 *
 * Record schema (IndexedDB + Firestore):
 *   { id, h3Index, defeatedByUid, defeatedAt, expiresAt, type? }
 */

import { SyncEngine } from "./sync-engine.js";

// ── Constants ────────────────────────────────────────────

/** Default monster respawn: 30 minutes. */
const DEFAULT_MONSTER_RESPAWN_MS = 30 * 60 * 1000;

/** Castle capture cooldown: 4 hours. */
const DEFAULT_CASTLE_RESPAWN_MS = 4 * 60 * 60 * 1000;

// ── Public API ───────────────────────────────────────────

/**
 * Check if an object is currently defeated/unavailable.
 * Reads directly from local IndexedDB for instant response.
 *
 * @param {string} objectId - Procedural object ID
 * @returns {Promise<{defeated: boolean, respawnAt: number|null}>}
 */
export async function isObjectDefeated(objectId) {
  if (!SyncEngine.db) {
    return { defeated: false, respawnAt: null };
  }

  try {
    return await new Promise((resolve) => {
      const tx = SyncEngine.db.transaction("defeated_objects", "readonly");
      const store = tx.objectStore("defeated_objects");
      const req = store.get(objectId);

      req.onsuccess = () => {
        const record = req.result;
        if (!record) {
          resolve({ defeated: false, respawnAt: null });
          return;
        }
        const now = Date.now();
        if (record.expiresAt > now) {
          resolve({ defeated: true, respawnAt: record.expiresAt });
        } else {
          // Expired — treat as available
          resolve({ defeated: false, respawnAt: null });
        }
      };

      req.onerror = () => resolve({ defeated: false, respawnAt: null });
    });
  } catch (e) {
    console.warn("[defeated-state-manager] isObjectDefeated failed:", e);
    return { defeated: false, respawnAt: null };
  }
}

/**
 * Get all defeated object IDs for a set of H3 cells.
 * Used by getViewportObjects() to filter out unavailable objects.
 * Delegates to SyncEngine.getDefeatedMonstersForCells().
 *
 * @param {string[]} h3Cells - H3 cell indices
 * @returns {Promise<Set<string>>} Set of defeated object IDs
 */
export async function getDefeatedIdsForCells(h3Cells) {
  if (!h3Cells || h3Cells.length === 0) return new Set();
  return SyncEngine.getDefeatedMonstersForCells(h3Cells);
}

/**
 * Record an object as defeated with respawn timer.
 * Delegates to SyncEngine.recordDefeatedMonster() for the dual-write
 * (IndexedDB for immediate local state + Firestore for cross-player sync).
 *
 * Note: SyncEngine internally uses a fixed 1-hour cooldown. The respawnMs
 * parameter is accepted for API completeness but not yet forwarded.
 * TODO: Extend SyncEngine.recordDefeatedMonster() to accept custom cooldown.
 *
 * @param {string} objectId - e.g. "proc_monster_882a1070adfffff_3"
 * @param {string} h3Index - H3 cell (extracted from objectId)
 * @param {string} defeatedByUid - Player UID
 * @param {number} [respawnMs=1800000] - Respawn in 30 min (reserved)
 * @returns {Promise<void>}
 */
export async function recordDefeated(
  objectId,
  h3Index,
  defeatedByUid,
  respawnMs = DEFAULT_MONSTER_RESPAWN_MS,
) {
  await SyncEngine.recordDefeatedMonster(objectId, h3Index, defeatedByUid);
}

/**
 * Record a castle capture.
 * Uses a longer cooldown (4 hours) than standard monster defeat.
 * Writes directly to IndexedDB + Firestore since SyncEngine's method
 * uses a fixed 1hr cooldown that's too short for castles.
 *
 * @param {string} castleId - Procedural castle ID
 * @param {string} h3Index - H3 cell
 * @param {string} capturedByUid - Player UID
 * @returns {Promise<void>}
 */
export async function recordCastleCapture(castleId, h3Index, capturedByUid) {
  const now = Date.now();
  const expiresAt = now + DEFAULT_CASTLE_RESPAWN_MS;

  // 1. Local IndexedDB write (immediate, offline-capable)
  if (SyncEngine.db) {
    try {
      const tx = SyncEngine.db.transaction("defeated_objects", "readwrite");
      const store = tx.objectStore("defeated_objects");
      store.put({
        id: castleId,
        h3Index,
        defeatedByUid: capturedByUid,
        defeatedAt: now,
        expiresAt,
        type: "castle_capture",
      });
    } catch (e) {
      console.warn(
        "[defeated-state-manager] Local castle capture write failed:",
        e,
      );
    }
  }

  // 2. Firestore write (cross-player visibility)
  try {
    const { doc, setDoc, getFirestore } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
    );
    const { getApp } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
    );
    const db = getFirestore(getApp());
    await setDoc(doc(db, "defeated_objects", castleId), {
      h3Index,
      defeatedByUid: capturedByUid,
      defeatedAt: now,
      expiresAt,
      type: "castle_capture",
    });
  } catch (e) {
    console.warn(
      "[defeated-state-manager] Firestore castle capture write failed:",
      e,
    );
    // Local cache still works — will sync on next Firestore read
  }
}

/**
 * Clean up expired defeated entries from IndexedDB.
 * Should be called periodically (e.g. every 10 minutes) to free local storage.
 * Delegates to SyncEngine.cleanupExpiredDefeated().
 *
 * @returns {Promise<void>}
 */
export async function cleanupExpired() {
  await SyncEngine.cleanupExpiredDefeated();
}

/**
 * Extract h3Index from a procedural object ID.
 * ID format: proc_{type}_{h3Index}_{localIndex}
 *
 * @param {string} objectId
 * @returns {string|null} h3Index, or null if the ID format is invalid
 */
export function extractH3FromId(objectId) {
  if (!objectId || typeof objectId !== "string") return null;
  const parts = objectId.split("_");
  // Minimum valid: ['proc', type, h3Index, localIndex]
  if (parts[0] !== "proc" || parts.length < 4) return null;
  // H3 index is everything between type and the last segment
  return parts.slice(2, -1).join("_");
}
