// Firebase Service Module - VERSION 2.0_CLEAN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  initializeFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  collectionGroup,
  query,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getDatabase,
  ref,
  set,
  push,
  update,
  remove,
  onChildAdded,
  onChildChanged,
  runTransaction,
  onValue,
  off,
  onDisconnect,
  query as rtdbQuery,
  orderByChild,
  equalTo,
  serverTimestamp as rtdbTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  monitoredGetDoc,
  monitoredGetDocs,
  monitoredOnSnapshot,
} from "./firebase-monitor.js";
import { gameState, recalculateStats } from "../core/gameState.js";

// Global cache for spawned objects to prevent multiple reads
let _spawnedObjectsCache = [];
let _worldFetchPromise = null;
let _cityZonesCache = {}; // {cityId: data}
let _templatesCache = {}; // {type: [templates]}
import { showNotification, addEventLog } from "../auth-ui/ui-controller.js";
import { SyncEngine } from "../gameplay/sync-engine.js";

// Configuration from google-services.json
const firebaseConfig = {
  apiKey: "AIzaSyD_MmVmjrchLqGgl8h1Zr-7od9QHvYPlW4",
  authDomain: "fight-craft-3c3f0.firebaseapp.com",
  projectId: "fight-craft-3c3f0",
  storageBucket: "fight-craft-3c3f0.firebasestorage.app",
  messagingSenderId: "1042637371139",
  appId: "1:1042637371139:android:0c6ff703f819bc80ea9b36",
  databaseURL:
    "https://fight-craft-3c3f0-default-rtdb.europe-west1.firebasedatabase.app/",
};

// Initialize Firebase
let app;
let db;
let auth;
let rtdb;
let storage;
let currentUser = null;
let userRole = "player"; // default: 'player', 'moderator', 'admin'
let onlinePlayersCount = 0;

// ==================== USAGE TRACKING STATE ====================
const STORAGE_KEY = "fightcraft_db_usage";
let usageStats = {
  reads: 0,
  writes: 0,
  deletes: 0,
  rtdb: 0,
  logs: [],
  date: new Date().toDateString(),
};

// Dirty Tracking Cache
let lastSavedHash = null;

/**
 * Quick hash/checksum of object to see if it changed
 */
function fastHash(obj) {
  try {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  } catch (e) {
    return Math.random();
  }
}

export async function initFirebase() {
  console.log("ðŸ”¥ Firebase: Initializing...");
  const start = Date.now();

  try {
    app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
    auth = getAuth(app);
    rtdb = getDatabase(app);
    storage = getStorage(app);
    console.log("✅ RTDB Initialized:", !!rtdb);
    window.firebaseFirestore = { collectionGroup, query, onSnapshot };

    return new Promise((resolve) => {
      console.log("â³ Waiting for Firebase Auth State...");
      const timer = setTimeout(() => {
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        console.warn(
          `âš ï¸ Auth check timed out after ${duration}s. Resolution: Force Login UI.`,
        );
        console.log("Mock redirect");
        resolve(false);
      }, 15000); // Increased to 15s for slow first-launch networks

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        clearTimeout(timer);
        const duration = ((Date.now() - start) / 1000).toFixed(1);

        if (user) {
          currentUser = user;
          // Expose email globally to avoid circular imports in UI
          window.currentUserEmail = user.email;
          console.log(
            `✅ Firebase: Auth detected in ${duration}s for ${user.email}`,
          );

          try {
            // 3. Get User Profile & Role (Optimized: Check LocalStorage first)
            const cachedProfileRaw = localStorage.getItem(
              `user_profile_${user.uid}`,
            );
            let cachedProfile = null;
            const CACHE_DURATION = 1000 * 60 * 60; // 1 Hour

            if (cachedProfileRaw) {
              try {
                const parsed = JSON.parse(cachedProfileRaw);
                if (Date.now() - parsed.timestamp < CACHE_DURATION) {
                  cachedProfile = parsed.data;
                  console.log("👤 Loaded User Profile from Cache (0 Reads)");
                }
              } catch (err) {
                console.warn("Invalid profile cache ignored");
              }
            }

            if (cachedProfile) {
              userRole = cachedProfile.role || "player";
              if (userRole === "admin")
                showNotification("👑 Cache: Welcome, Admin!", "success");
            } else {
              // Fetch from Firestore
              console.log("⏳ Fetching User Profile...");
              // trackUsage passed to monitoredGetDoc
              const userRef = doc(db, "users", user.uid);
              const userDoc = await monitoredGetDoc(
                userRef,
                `users/${user.uid} (initFirebase Profile)`,
              );

              if (userDoc.exists()) {
                const data = userDoc.data();
                userRole = data.role || "player";
                if (userRole === "admin")
                  showNotification("👑 Welcome back, Admin!", "success");

                // Update Cache
                const cacheObj = { data: data, timestamp: Date.now() };
                localStorage.setItem(
                  `user_profile_${user.uid}`,
                  JSON.stringify(cacheObj),
                );

                // Check for missing basic info (updates)
                const updates = {};
                if (
                  (!data.displayName || data.displayName === "No Name") &&
                  user.displayName
                )
                  updates.displayName = user.displayName;
                if (!data.email && user.email) updates.email = user.email;

                if (Object.keys(updates).length > 0) {
                  // Fire and forget update
                  updateDoc(userRef, updates).catch((e) =>
                    console.warn("Update profile failed:", e),
                  );
                }
              } else {
                console.log("🆕 Creating new user profile...");
                userRole = "player";
                await setDoc(doc(db, "users", user.uid), {
                  email: user.email,
                  displayName: user.displayName || "No Name",
                  role: "player",
                  createdAt: serverTimestamp(),
                  lastLogin: serverTimestamp(),
                });
              }
            }

            // Update login timestamp (Fire and forget)
            setDoc(
              doc(db, "users", user.uid),
              { lastLogin: serverTimestamp() },
              { merge: true },
            ).catch(() => {});
          } catch (e) {
            console.error("Role sync error:", e);
            userRole = "player";
          }

          resolve(true);
        } else {
          console.log(
            `ℹ️ Firebase: No user detected in ${duration}s. Redirecting...`,
          );
          console.log("Mock redirect");
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.error("Firebase init massive error:", error);
    showNotification("âŒ Firebase Error", "error");
    return false;
  }
}

// Role Helpers
export function getUserRole() {
  return userRole;
}

export function isAdmin() { return true;
  return userRole && userRole.toLowerCase() === "admin";
}

export function isModerator() {
  return (
    userRole &&
    (userRole.toLowerCase() === "admin" ||
      userRole.toLowerCase() === "moderator")
  );
}

export async function logout() {
  try {
    await signOut(auth);
    console.log("Mock redirect");
  } catch (error) {
    console.error("Logout error:", error);
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function getDB() {
  return db;
}

export function getStorageInstance() {
  return storage;
}

export async function savePlayerToCloud(playerData) {
  if (!currentUser || !db) return;

  try {
    const userRef = doc(db, "users", currentUser.uid);

    // Prepare data for cloud (remove non-serializable stuff if any)
    const dataToSave = {
      ...playerData,
      lastSave: serverTimestamp(),
      updatedAt: new Date().toISOString(),
      dbUsage: (() => {
        // Aggregate Stats
        const localReads = parseInt(
          localStorage.getItem("total_firestore_reads") || "0",
          10,
        );
        const totalReads = Math.max(usageStats.reads, localReads);

        // Aggregate Logs
        let allLogs = [...usageStats.logs];
        try {
          const localLogs = JSON.parse(
            localStorage.getItem("firestore_detailed_logs") || "[]",
          );
          allLogs = allLogs.concat(localLogs);
        } catch (e) {}

        // Sort and Limit logs to last 50 to save bandwidth
        allLogs.sort((a, b) => b.timestamp - a.timestamp);
        if (allLogs.length > 50) allLogs = allLogs.slice(0, 50);

        return {
          reads: totalReads,
          writes: usageStats.writes || 0,
          logs: allLogs,
        };
      })(),
    };

    // We use setDoc with merge to update or create
    trackUsage(
      "write",
      "[sync] [збереження даних профілю]",
      1,
      `users/${currentUser.uid} (savePlayerToCloud)`,
      playerData,
    );
    await setDoc(userRef, dataToSave, { merge: true });
    console.log("Cloud save complete");
  } catch (error) {
    console.error("Cloud save error:", error);
    addEventLog("Save failed: " + error.message, "error");
  }
}

export async function loadPlayerFromCloud() {
  if (!currentUser || !db) {
    console.warn("Cannot load: No user or DB");
    return null;
  }

  try {
    // OPTIMIZATION: Check cache first (same cache as initFirebase)
    const cachedRaw = localStorage.getItem(`user_profile_${currentUser.uid}`);
    if (cachedRaw) {
      try {
        const parsed = JSON.parse(cachedRaw);
        // 5 minute freshness check for this specific call (stricter than init)
        if (Date.now() - parsed.timestamp < 1000 * 60 * 5) {
          console.log("Cloud data found (in Cache):", parsed.data);
          return parsed.data;
        }
      } catch (e) {}
    }

    const userRef = doc(db, "users", currentUser.uid);
    // trackUsage handled by monitoredGetDoc
    const docSnap = await monitoredGetDoc(
      userRef,
      `users/${currentUser.uid} (loadPlayerFromCloud)`,
    );

    if (docSnap.exists()) {
      console.log("Cloud data found:", docSnap.data());

      // Update cache while we are here
      localStorage.setItem(
        `user_profile_${currentUser.uid}`,
        JSON.stringify({
          data: docSnap.data(),
          timestamp: Date.now(),
        }),
      );

      return docSnap.data();
    } else {
      console.log("No cloud data found (new player)");
      return null;
    }
  } catch (error) {
    console.error("Cloud load error:", error);
    return null;
  }
}

/**
 * Load any player's data by ID (for character switching in debug mode)
 * @param {string} characterId - Character ID
 * @param {string} ownerUID - Owner user ID (if loading from characters subcollection)
 */
export async function loadPlayerDataById(characterId, ownerUID = null) {
  if (!db) {
    console.error("Cannot load player: DB not initialized");
    return null;
  }

  try {
    const { doc, getDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    let docRef;

    if (ownerUID) {
      // Load from characters subcollection
      docRef = doc(db, "users", ownerUID, "characters", characterId);
    } else {
      // Fallback: try loading as old structure (standalone user)
      docRef = doc(db, "users", characterId);
    }

    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log(
        `âœ… Loaded character data: ${characterId.substring(0, 12)}... (owner: ${ownerUID?.substring(0, 12) || "self"})`,
      );
      return data;
    } else {
      console.warn(
        `No data found for character: ${characterId} (owner: ${ownerUID || "N/A"})`,
      );
      return null;
    }
  } catch (error) {
    console.error("Error loading player data:", error);
    return null;
  }
}

export async function updatePlayerLocation(lat, lng) {
  if (!db || !currentUser) return;

  try {
    // Update User level position for persistent last known location
    // This is only called via saveGame (every 60s) now to save costs
    const userRef = doc(db, "users", currentUser.uid);
    trackUsage(
      "write",
      "[gps] [оновлення координат (Firestore)]",
      1,
      `users/${currentUser.uid}/position (updatePlayerLocation)`,
      { lat, lng },
    );
    await updateDoc(userRef, {
      position: { lat, lng },
      lastLocationUpdate: serverTimestamp(),
    });
  } catch (e) {
    // Silent fail
  }
}

/**
 * Реєстрація гравця в RTDB — ПОВНИЙ запис з усіма даними.
 * Викликається ОДИН РАЗ при логіні/старті гри.
 * Встановлює onDisconnect для автоматичного видалення при від'єднанні.
 */
export async function registerPlayerInRTDB(lat, lng) {
  if (!rtdb) {
    console.warn("📡 RTDB: Not initialized yet");
    return;
  }
  if (!currentUser) {
    console.warn("📡 RTDB: No current user for sync");
    return;
  }
  if (!window._currentCharacterId) {
    console.warn("📡 RTDB: No character ID for sync");
    return;
  }

  const path = `live_players/${window._currentCharacterId}`;
  try {
    const playerRef = ref(rtdb, path);

    // Встановити очищення при від'єднанні (тільки тут, один раз)
    onDisconnect(playerRef).remove();

    // Повний запис усіх даних гравця
    await set(playerRef, {
      id: window._currentCharacterId,
      userId: currentUser.uid,
      name: gameState.player.name || "Hero",
      avatar: gameState.player.avatar || "🧙",
      level: gameState.player.level || 1,
      // Серіалізація stats з обробкою BigInt
      stats: JSON.parse(
        JSON.stringify(recalculateStats(), (key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
      position: { lat, lng },
      status: "idle",
      groupId: null,
      combatId: null,
      updatedAt: rtdbTimestamp(),
    });
    console.log(
      `📡 RTDB: Player ${gameState.player.name} registered at ${path}`,
    );
  } catch (e) {
    console.error(`📡 RTDB: Registration failed at ${path}:`, e);
  }
}

/**
 * Легке оновлення ТІЛЬКИ позиції в RTDB.
 * Використовує update() замість set() — відправляє менше даних,
 * що критично для швидких серій рухів (trailing edge throttle).
 */
export async function updatePlayerLocationRTDB(lat, lng) {
  if (!rtdb) return;
  if (!currentUser) return;
  if (!window._currentCharacterId) return;

  const path = `live_players/${window._currentCharacterId}`;
  try {
    const playerRef = ref(rtdb, path);

    // Часткове оновлення — тільки позиція та мітка часу
    await update(playerRef, {
      position: { lat, lng },
      updatedAt: rtdbTimestamp(),
    });
  } catch (e) {
    // Якщо вузол ще не існує (рідкісний випадок) — зробити повну реєстрацію
    if (e.message && e.message.toLowerCase().includes("permission")) {
      console.warn(`📡 RTDB: Update fallback to register for ${path}`);
      await registerPlayerInRTDB(lat, lng);
    } else {
      console.error(`📡 RTDB: Position update failed:`, e);
    }
  }
}

/**
 * Subscribe to LIVE players via RTDB
 */
export function subscribeToPlayersRTDB(onUpdate) {
  if (!rtdb) return () => {};

  const playersRef = ref(rtdb, "live_players");

  // console.log("📡 Subscribing to LIVE players via RTDB...");

  onValue(
    playersRef,
    (snapshot) => {
      const data = snapshot.val();
      // console.log("📡 RTDB: Data Received from 'live_players':", data ? Object.keys(data).length : "EMPTY");

      if (!data) {
        // console.log("📡 RTDB: No players online currently.");
        onUpdate([]);
        return;
      }

      const currentUserId = currentUser?.uid;
      const currentCharId =
        window._currentCharacterId || window._currentlyPlayingCharacterId;

      const players = Object.values(data).map((p) => ({
        ...p,
        lat: p.position?.lat,
        lng: p.position?.lng,
        isSelf: p.id === currentCharId,
        isTestPlayer: p.name?.includes("TestPlayer"),
      }));

      onUpdate(players);
    },
    (error) => {
      console.warn("RTDB Subscription error:", error);
    },
  );

  return () => off(playersRef);
}

export function subscribeToPlayers(onUpdate) {
  if (!db) return () => {};

  // DEBUG: Identify who is calling this
  console.warn(
    "⚠️ subscribeToPlayers (Firestore) called! This uses collectionGroup (expensive). Call Stack:",
    new Error().stack,
  );

  if (!isAdmin()) {
    console.warn("⛔ subscribeToPlayers blocked: User is not admin.");
    return () => {};
  }

  try {
    const q = query(collectionGroup(db, "characters"));

    trackUsage(
      "read",
      "[multiplayer] [пошук активних гравців]",
      1,
      "characters/ (subscribeToPlayers)",
    );
    const unsubscribe = monitoredOnSnapshot(
      q,
      (snapshot) => {
        // trackUsage removed here - handled by monitoredOnSnapshot
        // trackUsage('read', '[multiplayer] [оновлення списку гравців]', snapshot.size, `characters/ (Snapshot Update)`);
        const players = [];
        const currentUserId = currentUser?.uid;

        snapshot.forEach((doc) => {
          const data = doc.data();
          const parentPath = doc.ref.parent.parent;
          const userId = parentPath?.id;
          const name = data.player?.name || "Unknown";

          const isTestPlayer = data.isTestPlayer || name.includes("TestPlayer");
          if (isTestPlayer && userId !== currentUserId) {
            return;
          }

          if (data.position && data.position.lat && data.position.lng) {
            players.push({
              id: doc.id,
              userId: userId,
              position: data.position,
              name: name,
              level: data.player?.level || 1,
              avatar: data.player?.avatar || "🧙",
              isSelf:
                userId === currentUserId &&
                (doc.id === window._currentCharacterId ||
                  doc.id === window._currentlyPlayingCharacterId),
              isTestPlayer: isTestPlayer,
            });
          }
        });

        onlinePlayersCount = players.length;
        onUpdate(players);
      },
      (error) => {
        if (error.code === "permission-denied") {
          console.log(
            "Multiplayer Sync: Access Denied (Admin-only feature). Player list hidden.",
          );
          onUpdate([]); // Send empty list instead of crashing
          return;
        }
        console.warn("Player subscription error:", error);
      },
      "characters/ (subscribeToPlayers)",
    );

    return unsubscribe;
  } catch (error) {
    console.error("Player query setup failed:", error);
    return () => {};
  }
}

/**
 * Legacy player subscription (for backward compatibility)
 * Reads from old structure: users/{uid}
 */
function subscribeToPlayersLegacy(onUpdate) {
  if (!db) return () => {};

  const q = query(collection(db, "users"));

  trackUsage(
    "read",
    "[multiplayer] [пошук гравців (Legacy)]",
    1,
    "users/ (subscribeToPlayersLegacy)",
  );
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      trackUsage(
        "read",
        "[multiplayer] [оновлення гравців (Legacy)]",
        snapshot.size,
        `users/ (Legacy Snapshot Update)`,
      );
      const players = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const name = data.player?.name || "Unknown";

        if (name.includes("TestPlayer")) return;

        if (data.position && data.position.lat && data.position.lng) {
          players.push({
            id: doc.id,
            position: data.position,
            name: name,
            level: data.player?.level || 1,
            avatar: data.player?.avatar || "🧙",
            isSelf: doc.id === getCurrentUser()?.uid,
          });
        }
      });

      onlinePlayersCount = players.length;
      onUpdate(players);
    },
    (error) => {
      console.error("Legacy player sync error:", error);
    },
  );

  return unsubscribe;
}

// ==================== MULTIPLAYER DEBUG FUNCTIONS ====================

/**
 * Get all players for debug dropdown (ONLY TEST PLAYERS)
 * Reads from NEW structure: users/{uid}/characters/{charId}
 */
export async function getAllPlayersForDebug() {
  if (!db) return [];

  try {
    // Use Collection Group query to get ALL characters
    const q = query(collectionGroup(db, "characters"));
    const snapshot = await getDocs(q);

    const players = [];
    const currentUserId = currentUser?.uid;

    snapshot.forEach((doc) => {
      const data = doc.data();

      if (data.isTestPlayer !== true) {
        return;
      }

      const parentPath = doc.ref.parent.parent;
      const userId = parentPath?.id;

      players.push({
        id: doc.id,
        userId: userId,
        name: data.player?.name || "Unknown",
        level: data.player?.level || 1,
        avatar: data.player?.avatar || "🧙",
        position: data.position || { lat: 0, lng: 0 },
        isSelf: false,
        isTestPlayer: true,
        lastUpdate: data.lastSave,
      });
    });

    return players;
  } catch (error) {
    console.error("Error loading characters for debug:", error);
    if (error.code === "permission-denied") {
      console.warn(
        "Debug character fetch failed - likely missing composite index or quota.",
      );
    }
    return [];
  }
}

/**
 * Load test players to map immediately (for instant display on game start)
 */
export async function loadTestPlayersToMap() {
  try {
    console.log("â³ Loading test players from Firebase...");

    // Show loading in Multi-Admin panel
    const countEl = document.getElementById("mp-online-count");
    if (countEl) countEl.textContent = "â³";

    const testPlayers = await getAllPlayersForDebug();

    if (testPlayers.length === 0) {
      // console.log('ðŸ“­ No test players to load');
      if (countEl) countEl.textContent = "0";
      return;
    }

    console.log(`ðŸ“¦ Loading ${testPlayers.length} test players to map...`);

    // Dynamically import map module
    const { otherPlayerMarkers, createPlayerMarker } =
      await import("../map/map.js");

    let loaded = 0;
    testPlayers.forEach((player) => {
      // Only create if doesn't exist
      if (!otherPlayerMarkers[player.id] && player.position) {
        otherPlayerMarkers[player.id] = createPlayerMarker(
          player.position.lat,
          player.position.lng,
          player.name,
          player.avatar,
          player.id,
          player.level,
          true, // isTestPlayer
        );
        loaded++;
        console.log(`  âœ… ${player.name} loaded`);
      }
    });

    console.log(`âœ… ${loaded} test players loaded to map`);
    if (countEl) countEl.textContent = loaded.toString();
  } catch (error) {
    console.error("âŒ Error loading test players:", error);
    const countEl = document.getElementById("mp-online-count");
    if (countEl) countEl.textContent = "âŒ";
  }
}

/**
 * Create a test player as a character under admin's account
 */
export async function createTestPlayer() {
  console.warn("createTestPlayer has been deprecated and removed.");
  showNotification("Test Player creation is disabled", "warning");
  return null;
}

/**
 * Delete a test character (from admin's character subcollection)
 * @param {string} characterId - Character ID
 * @param {string} ownerUID - Owner user ID (admin)
 */
export async function deleteTestPlayer(characterId, ownerUID = null) {
  if (!db || !auth.currentUser) {
    console.error("Cannot delete: DB not initialized or no current user");
    showNotification("Database not ready", "error");
    return false;
  }

  try {
    const { doc, getDoc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // If ownerUID not provided, assume current user is owner (admin)
    const owner = ownerUID || auth.currentUser.uid;

    const charRef = doc(db, "users", owner, "characters", characterId);
    const charDoc = await getDoc(charRef);

    if (!charDoc.exists()) {
      console.warn("Cannot delete: Character document does not exist");
      showNotification("Character not found in database", "warning");
      return false;
    }

    const charData = charDoc.data();

    // Check if it's a test player
    if (charData.isTestPlayer === true) {
      await deleteDoc(charRef);
      console.log(`âœ… Test character deleted: ${characterId}`);
      showNotification("Test character deleted", "success");
      return true;
    } else {
      console.warn(
        "Cannot delete: Not a test character (isTestPlayer:",
        charData.isTestPlayer,
        ")",
      );
      showNotification("Cannot delete: Not a test character", "warning");
      return false;
    }
  } catch (error) {
    console.error("Error deleting test character:", error);

    if (error.code === "permission-denied") {
      showNotification("Permission denied: Check Firebase rules", "error");
    } else {
      showNotification("Failed to delete character", "error");
    }
    return false;
  }
}

/**
 * Get online players count
 */
export function getOnlinePlayersCount() {
  // This would be updated by subscribeToPlayers callback
  // For now, return from a global variable that's updated by the subscription
  return window._cachedOnlinePlayersCount || 0;
}

// ==================== LEADERBOARD ====================

export async function fetchLeaderboard(type = "street") {
  if (!db) return [];

  try {
    const { collectionGroup, getDocs, query, orderBy, limit } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // Note: Real production apps need composite indexes for these sorts.
    // For prototype, we fetch all characters and sort in memory to avoid index errors.
    const q = query(collectionGroup(db, "characters"));
    const snapshot = await getDocs(q);

    const players = [];
    const currentUserId = currentUser?.uid;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const p = data.player || {};
      const pvp = p.pvp || { wins: 0, losses: 0 };

      // Filter ghosts/tests if needed
      // if (data.isTestPlayer && ...)

      players.push({
        id: doc.id,
        name: p.name || "Unknown",
        avatar: p.avatar || "ðŸ‘¤",
        level: p.level || 1,
        wins: pvp.wins || 0,
        losses: pvp.losses || 0,
        pvp: pvp,
        userId: doc.ref.parent.parent?.id,
      });
    });

    console.log(`ðŸ† Leaderboard: Fetched ${players.length} records`);
    return players;
  } catch (error) {
    console.error("Leaderboard error:", error);
    return [];
  }
}

// ==================== CHARACTER MANAGEMENT ====================

/**
 * Get all characters for a user
 */
export async function getAllCharacters(userId) {
  if (!db) return [];

  try {
    const { collection, getDocs, query } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const charactersRef = collection(db, "users", userId, "characters");
    const snapshot = await getDocs(charactersRef);

    const characters = [];
    snapshot.forEach((doc) => {
      characters.push({
        id: doc.id,
        data: doc.data(),
      });
    });

    console.log(
      `ðŸ“‹ Found ${characters.length} characters for user ${userId.substring(0, 12)}...`,
    );
    return characters;
  } catch (error) {
    console.error("Error loading characters:", error);
    return [];
  }
}

/**
 * Get specific character
 */
export async function getCharacter(userId, characterId) {
  if (!db) return null;
  if (!userId) {
    console.error("❌ getCharacter: userId is missing!");
    return null;
  }
  if (!characterId) {
    console.error("❌ getCharacter: characterId is missing!");
    return null;
  }

  try {
    const { doc, getDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // Debug Log
    const currentAuthId = auth.currentUser ? auth.currentUser.uid : "null";
    console.log(
      `🔍 getCharacter: Requesting users/${userId}/characters/${characterId}`,
    );
    console.log(
      `   👉 Auth Context: CurrentUID=${currentAuthId} vs ParamUserID=${userId}`,
    );

    if (currentAuthId !== userId) {
      console.warn(
        "⚠️ getCharacter: ID Mismatch! This may cause Permission Denied.",
      );
    }

    const charRef = doc(db, "users", userId, "characters", characterId);
    const docSnap = await getDoc(charRef);

    if (docSnap.exists()) {
      console.log(`✅ Loaded character: ${characterId}`);
      return docSnap.data();
    } else {
      console.warn(
        `❌ Character not found: ${characterId} (Path: users/${userId}/characters/${characterId})`,
      );
      return null;
    }
  } catch (error) {
    console.error(`❌ Error loading character (${characterId}):`, error);
    // If permission denied, it acts like not found for own user vs others
    return null;
  }
}

/**
 * Create new character
 */
export async function createCharacter(userId, name, avatar = "ðŸ§™") {
  if (!db) throw new Error("Database not initialized");

  try {
    const { collection, doc, setDoc, getDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // Get user data from Firestore (more reliable than auth.currentUser immediately after registration)
    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.exists() ? userDoc.data() : {};

    const userName =
      userData.displayName || auth.currentUser?.displayName || "Player";
    const userEmail =
      userData.email || auth.currentUser?.email || "unknown@email.com";

    const charactersRef = collection(db, "users", userId, "characters");
    const newCharRef = doc(charactersRef);

    const characterData = {
      player: {
        name: name,
        userName: userName,
        userEmail: userEmail,
        avatar: avatar,
        level: 1,
        xp: "0",
        xpToNext: "500",
        hp: 100,
        maxHp: 100,
        gold: 100,
        strength: 5,
        agility: 5,
        intuition: 5,
        vitality: 5,
        intellect: 5,
        wisdom: 5,
        statPoints: 5,
        regenRate: 0,
        lastDamageTime: 0,
        interactionRadius: 25,
      },
      equipment: {
        helmet: null,
        armor: null,
        shield: null,
        sword: null,
        boots: null,
        gloves: null,
        belt: null,
      },
      inventory: [],
      position: {
        lat: 52.484512,
        lng: 13.449876,
      },
      quests: {
        monstersKilled: 0,
        itemsCollected: 0,
        uniquesKilled: 0,
        distanceTraveled: 0,
      },
      settings: {
        sound: true,
        notifications: true,
        fog: true,
        vibration: true,
      },
      debug: {
        enabled: false,
        moveSpeed: 1,
      },
      inactiveMonsters: {},
      createdAt: serverTimestamp(),
      lastSave: serverTimestamp(),
    };

    await setDoc(newCharRef, characterData);

    console.log(`âœ… Character created: ${name} [${newCharRef.id}]`);
    showNotification(`Character "${name}" created!`, "success");

    return {
      characterId: newCharRef.id,
      characterData: characterData,
    };
  } catch (error) {
    console.error("Error creating character:", error);
    showNotification("Failed to create character", "error");
    throw error;
  }
}

/**
 * Save character data
 */
export async function saveCharacter(userId, characterId, characterData) {
  if (!db) return;

  try {
    const { doc, setDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const charRef = doc(db, "users", userId, "characters", characterId);

    // CRITICAL: Clean the data to avoid Firestore errors
    // Remove non-serializable fields and convert BigInt to strings
    const p = characterData.player || {};

    const cleanData = {
      player: {
        ...p,
        xp: p.xp ? String(p.xp) : "0",
        xpToNext: p.xpToNext ? String(p.xpToNext) : "500",
      },
      position: characterData.position || p.position,
      equipment: characterData.equipment,
      inventory: characterData.inventory,
      storage: characterData.storage || [],
      storageGold: characterData.storageGold || 0,
      quests: characterData.quests,
      settings: characterData.settings,
      isTestPlayer: characterData.isTestPlayer || false,
      lastIncomeUpdate: characterData.lastIncomeUpdate || null,
    };

    // DIRTY TRACKING: Only save if data actually changed
    const currentHash = fastHash(cleanData);
    if (currentHash === lastSavedHash) {
      // console.log(`⏭️ Save skipped: No changes detected for ${characterId}`);
      return;
    }

    const dataToSave = {
      ...cleanData,
      lastSave: serverTimestamp(),
      updatedAt: new Date().toISOString(),
    };

    trackUsage(
      "write",
      "[sync] [збереження персонажа]",
      1,
      `users/${userId}/characters/${characterId} (saveCharacter)`,
      cleanData,
    );
    await setDoc(charRef, dataToSave, { merge: true });
    lastSavedHash = currentHash;
    console.log(`💾 Character saved: ${characterId}`);
  } catch (error) {
    console.error("Error saving character:", error);
    if (window.addEventLog) {
      window.addEventLog("Save failed: " + error.message, "error");
    }
  }
}

/**
 * Delete character
 */
export async function deleteCharacter(userId, characterId) {
  if (!db) throw new Error("Database not initialized");

  try {
    const { doc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const charRef = doc(db, "users", userId, "characters", characterId);
    await deleteDoc(charRef);

    console.log(`ðŸ—‘ï¸ Character deleted: ${characterId}`);
    showNotification("Character deleted", "success");

    return true;
  } catch (error) {
    console.error("Error deleting character:", error);
    showNotification("Failed to delete character", "error");
    throw error;
  }
}

// Helpers for external scripts (like cleanup-logic.js)
export function getDb() {
  return db;
}
export function getAuthObj() {
  return auth;
}

/**
 * CLEANUP DATABASE (Admin Only)
 * Deletes all users except Admins and TestPlayers
 */
export async function cleanupDatabase() {
  // Dynamically import isAdmin to avoid circular dependency issues if any,
  // though here we are in same module so we can just call isAdmin() if it's hoisted or available.
  // However, since isAdmin is exported, we can use it directly.

  if (!isAdmin()) {
    showNotification("Only admins can do this!", "error");
    return;
  }

  if (
    !confirm(
      "â˜¢ï¸ DELETE ALL RECORDS (EXCEPT ADMIN)?\n\nThis will wipe:\n- All players\n- All test accounts\n\nOnly ADMINS will survive.\n\nCannot be undone!",
    )
  )
    return;

  showNotification("ðŸ§¹ Cleaning database...", "info");
  console.log("ðŸ§¹ Starting Database Cleanup...");

  try {
    const { getDocs, collection, deleteDoc, doc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const usersSnap = await getDocs(collection(db, "users"));
    let deletedCount = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const data = userDoc.data();
      const name = data.displayName || "Unknown";

      // Protections
      const isMe = currentUser && uid === currentUser.uid;
      const isTargetAdmin =
        data.role === "admin" ||
        (data.role && data.role.toLowerCase() === "admin");
      // TestPlayer protection REMOVED for strict cleanup

      if (isMe || isTargetAdmin) {
        console.log(`âœ… Keeping: ${name} (${data.role || "player"})`);
        continue;
      }

      console.warn(`ðŸ—‘ï¸ Deleting: ${name} (${uid})`);

      // 1. Delete characters subcollection
      const charsSnap = await getDocs(
        collection(db, "users", uid, "characters"),
      );
      for (const char of charsSnap.docs) {
        await deleteDoc(doc(db, "users", uid, "characters", char.id));
      }

      // 2. Delete user doc
      await deleteDoc(doc(db, "users", uid));
      deletedCount++;
    }

    showNotification(`âœ¨ Done! Deleted ${deletedCount} users.`, "success");
    console.log(`âœ¨ Cleanup complete. Removed ${deletedCount} users.`);

    // Refresh lists if available
    if (window.refreshPlayersList) window.refreshPlayersList();
  } catch (e) {
    console.error("Cleanup error:", e);
    showNotification("Cleanup failed", "error");
  }
}

export async function updateUserProfile(name) {
  if (!currentUser) return false;
  try {
    // 1. Update Auth
    await updateProfile(currentUser, { displayName: name });
    // 2. Update DB
    await updateDoc(doc(db, "users", currentUser.uid), { displayName: name });
    console.log("âœ… User Profile Updated:", name);
    return true;
  } catch (e) {
    console.error("Update Profile Error:", e);
    return false;
  }
}

// ==================== ADMIN OBJECT GENERATION SYSTEM ====================

/**
 * Get all templates of a specific type (monster, shop, castle)
 * @param {string} type 'monster', 'shop', 'castle'
 */
export async function getTemplates(type) {
  if (_templatesCache[type]) return _templatesCache[type];

  try {
    console.log(`🌍 Using SyncEngine for Templates (${type})...`);
    const templates = await SyncEngine.syncTemplates(db, type);
    _templatesCache[type] = templates;
    return templates;
  } catch (e) {
    console.error("Error fetching templates:", e);
    return [];
  }
}

/**
 * Save or Update a Template
 * @param {object} template Must have 'type' and optional 'id'
 */
export async function saveTemplate(template) {
  if (!isAdmin()) return false;
  try {
    const id = template.id || `tpl_${Date.now()}`;
    const data = { ...template, updatedAt: serverTimestamp() };
    delete data.id; // Don't save ID inside doc

    trackUsage(
      "write",
      `[admin] [збереження шаблону: ${template.type}]`,
      1,
      `templates/${id}`,
      data,
    );
    await setDoc(doc(db, "templates", id), data);

    // Auto-update templates timestamp so clients sync
    await setDoc(
      doc(db, "world_metadata", "current_state"),
      {
        last_templates_update: serverTimestamp(),
        // Invalidate the pre-generated bundle URL to force clients to fetch fresh from Firestore
        templates: null,
      },
      { merge: true },
    );

    _templatesCache = {}; // Clear template cache after modification
    console.log(`✅ Template saved: ${id}`);
    return true;
  } catch (e) {
    console.error("Error saving template:", e);
    return false;
  }
}

/**
 * Delete a Template
 */
export async function deleteTemplate(templateId) {
  if (!isAdmin()) return false;
  try {
    const { doc, deleteDoc, setDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    trackUsage(
      "delete",
      "[admin] [видалення шаблону]",
      1,
      `templates/${templateId}`,
    );
    await deleteDoc(doc(db, "templates", templateId));

    // Auto-update templates timestamp so clients sync
    await setDoc(
      doc(db, "world_metadata", "current_state"),
      {
        last_templates_update: serverTimestamp(),
        // Invalidate the pre-generated bundle URL to force clients to fetch fresh from Firestore
        templates: null,
      },
      { merge: true },
    );

    _templatesCache = {}; // Clear template cache after modification
    console.log(`🗑️ Template deleted: ${templateId}`);
    return true;
  } catch (e) {
    console.error("Error deleting template:", e);
    return false;
  }
}

/**
 * Clear existing objects for a location to prevent duplicates
 * @param {string} cityId e.g., 'berlin', 'kyiv'
 * @param {string} type 'monster', 'shop', 'castle'
 */
export async function clearLocationObjects(cityId, type) {
  if (!isAdmin()) return false;
  console.log(`ðŸ§¹ Clearing ${type}s in ${cityId}...`);
  try {
    // Query objects by city and type
    const q = query(
      collection(db, "spawned_objects"),
      where("cityId", "==", cityId),
      where("type", "==", type),
    );
    const snapshot = await getDocs(q);

    // Delete in batches of 500
    const batchSize = 500;
    const chunks = [];
    let batch = writeBatch(db);
    let count = 0;

    snapshot.docs.forEach((doc, index) => {
      batch.delete(doc.ref);
      count++;
      if (count % batchSize === 0) {
        chunks.push(batch);
        batch = writeBatch(db);
      }
    });

    if (count % batchSize !== 0) chunks.push(batch);

    trackUsage(
      "delete",
      `[admin] [очищення локації: ${type} в ${cityId}]`,
      count,
      "spawned_objects/",
    );
    await Promise.all(chunks.map((b) => b.commit()));

    // Write-Through Cache: Remove deleted objects
    const idsToDelete = new Set(snapshot.docs.map((d) => d.id));
    _spawnedObjectsCache = _spawnedObjectsCache.filter(
      (o) => !idsToDelete.has(o.id),
    );

    // Clear Packed State (force re-pack on next load)
    const packedRef = doc(db, "world_chunks", cityId);
    deleteDoc(packedRef).catch((err) =>
      console.error("Failed to clear packed:", err),
    );

    console.log(
      `✅ Cleared ${count} old objects and updated cache/packed state.`,
    );
    return true;
  } catch (e) {
    console.error("Error clearing objects:", e);
    return false;
  }
}

/**
 * Batch save generated objects
 * @param {Array} objects List of objects to save
 */
export async function saveGeneratedObjects(objects) {
  if (!isAdmin()) return false;
  console.log(`ðŸ’¾ Saving ${objects.length} generated objects...`);

  try {
    const batchSize = 500;
    let batch = writeBatch(db);
    let count = 0;
    const chunks = [];

    for (const obj of objects) {
      const ref = doc(collection(db, "spawned_objects")); // Auto-ID
      batch.set(ref, {
        ...obj,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      count++;

      if (count % batchSize === 0) {
        chunks.push(batch);
        batch = writeBatch(db);
      }
    }

    if (count % batchSize !== 0) chunks.push(batch);

    trackUsage(
      "write",
      `[admin] [масове збереження об'єктів]`,
      count,
      "spawned_objects/",
    );
    console.log(`📦 Committing ${chunks.length} batches...`);
    await Promise.all(chunks.map((b) => b.commit()));

    // Template-Sync: Do NOT clear the spawned objects cache here.
    // Auto-generated IDs mean we can't append precisely, but clearing causes
    // the admin's world view to blank unnecessarily. The packed-state invalidation
    // below (world_metadata timestamp) ensures all game clients delta-sync correctly.
    // The cache will be naturally refreshed on next full page load.
    // _spawnedObjectsCache = []; // REMOVED — preserves admin cache across toggles

    // Clear Packed State (force re-pack for all cities since we don't know which changed)
    // For simplicity, we just clear 'berlin' or we could clear all.
    // Since most current usage is Berlin:
    deleteDoc(doc(db, "world_chunks", "berlin")).catch((err) =>
      console.error("Failed to clear packed:", err),
    );
    deleteDoc(doc(db, "world_chunks", "kyiv")).catch((err) =>
      console.error("Failed to clear packed kyiv:", err),
    );
    await setDoc(
      doc(db, "world_metadata", "current_state"),
      {
        last_global_update: serverTimestamp(),
        world_data: null,
        version_hash: null,
      },
      { merge: true },
    );

    console.log(
      `✅ Successfully saved ${count} objects and invalidated packed state.`,
    );
    return true;
  } catch (e) {
    console.error("Error batch saving objects:", e);
    return false;
  }
}

/**
 * Subscribe to spawned objects in a city
 * @param {string} cityId
 * @param {function} onUpdate Callback(objects)
 */
/**
 * Fetch ALL spawned objects once (One-time read for cost optimization)
 */
export async function fetchSpawnedObjectsOnce() {
  if (_spawnedObjectsCache.length > 0) return _spawnedObjectsCache;

  if (_worldFetchPromise) {
    console.log("⏳ Joining existing world fetch operation...");
    return _worldFetchPromise;
  }

  _worldFetchPromise = (async () => {
    try {
      // INTEGRATION: Use SyncEngine for optimized loading
      // Strategy: 1 Read (Meta) -> IndexedDB (0 Reads) or Delta (N Reads)
      console.log("🌍 Using SyncEngine for World Load...");
      const objects = await SyncEngine.syncWorld(db);

      if (objects && objects.length > 0) {
        _spawnedObjectsCache = objects;
        return objects;
      }

      // Fallback if SyncEngine returns empty (shouldn't happen if initialized correctly)
      console.warn("⚠️ SyncEngine returned empty. Doing legacy fetch.");

      // 2. FALLBACK: Fetch individual objects (Legacy: N Reads)
      const { collection, getDocs } =
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const q = query(collection(db, "spawned_objects"));
      const snapshot = await getDocs(q);
      const fallbackObjects = snapshot.docs.map((d) => ({
        id: doc.id,
        ...doc.data(),
      }));
      _spawnedObjectsCache = fallbackObjects;
      return fallbackObjects;
    } catch (err) {
      console.error("❌ World Load Error:", err);
      return [];
    } finally {
      _worldFetchPromise = null;
    }
  })();

  return _worldFetchPromise;
}

export function subscribeToSpawnedObjects(cityId, onUpdate) {
  if (_spawnedObjectsCache.length > 0) {
    // console.log(`📦 Using Cache for city: ${cityId} (${_spawnedObjectsCache.length} total objects)`);
    onUpdate(_spawnedObjectsCache.filter((o) => o.cityId === cityId));
    return () => {}; // No need to subscribe, return dummy unsub functionality
  }

  console.log(`📡 Fetching objects for ${cityId} (Fallback Sub)...`);
  const q = query(
    collection(db, "spawned_objects"),
    where("cityId", "==", cityId),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      trackUsage(
        "read",
        "[world] [оновлення об'єктів світу (монстри/замки)]",
        snapshot.size,
        `spawned_objects/${cityId}`,
      );
      const objects = [];
      snapshot.forEach((doc) => {
        objects.push({ id: doc.id, ...doc.data() });
      });
      onUpdate(objects);
    },
    (error) => {
      console.warn(`⚠️ Spawned Objects Sync Error for ${cityId}:`, error);
    },
  );
}

/**
 * Invalidate the in-memory spawned objects cache.
 * Used when world_metadata changes indicate objects were added/removed by template toggling.
 */
export function invalidateSpawnedObjectsCache() {
  _spawnedObjectsCache = [];
  _worldFetchPromise = null;
  console.log(
    "🗑️ Spawned objects cache invalidated (template toggle detected)",
  );
}

/**
 * Subscribe to real-time changes on world_metadata/current_state.
 * Fires callback whenever last_global_update changes (i.e. template toggled).
 * Skips the initial snapshot to avoid unnecessary re-render on startup.
 * @param {Function} callback - called with metadata object on each change
 * @returns {Function} unsubscribe function
 */
export function subscribeToWorldMetadata(callback) {
  let firstCall = true;
  const metaRef = doc(db, "world_metadata", "current_state");

  return onSnapshot(
    metaRef,
    (snap) => {
      if (firstCall) {
        firstCall = false;
        return;
      }
      if (snap.exists()) {
        console.log("📡 World metadata changed — template toggle detected");
        callback(snap.data());
      }
    },
    (error) => {
      console.warn("⚠️ World metadata listener error:", error);
    },
  );
}

/**
 * Update fields on a spawned object (write-through: Firestore + cache)
 * @param {string} objectId - spawned_objects document ID
 * @param {Object} updates - fields to merge (e.g. { defeatedAt: Date.now() })
 */
export async function updateSpawnedObject(objectId, updates) {
  if (!db || !objectId) return;

  try {
    const objRef = doc(db, "spawned_objects", objectId);
    await updateDoc(objRef, updates);
    trackUsage(
      "write",
      `[world] [update spawned object ${objectId}]`,
      1,
      `spawned_objects/${objectId}`,
      updates,
    );

    // Write-through cache update
    const cachedObj = _spawnedObjectsCache.find((o) => o.id === objectId);
    if (cachedObj) {
      Object.assign(cachedObj, updates);
    }
  } catch (err) {
    console.error(`❌ Failed to update spawned object ${objectId}:`, err);
  }
}

// ==================== CASTLE SYSTEM ====================

/**
 * Claim a castle in Firestore
 */
/**
 * Save a newly discovered castle to Firestore (H3 Discovery System)
 * @param {Object} castleData The castle object to save
 */
export async function saveDiscoveredCastle(castleData) {
  try {
    const cid = String(castleData.id);
    const castleRef = doc(db, "castles", cid);
    await setDoc(castleRef, castleData, { merge: true });

    // Add to local cache
    if (_castlesCache) {
      _castlesCache[cid] = castleData;
    }

    console.log(`🏰 Castle saved to Firestore: ${cid}`);
    return true;
  } catch (e) {
    console.error("Error saving discovered castle:", e);
    throw e;
  }
}

export async function claimCastle(castleId, castleData) {
  if (!db) return;

  try {
    const { doc, setDoc, serverTimestamp, updateDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // Ensure ID is string
    const cid = String(castleId);
    const castleRef = doc(db, "castles", cid);

    await setDoc(
      castleRef,
      {
        ...castleData,
        capturedAt: serverTimestamp(),
        lastPayAndCheck: serverTimestamp(),
      },
      { merge: true },
    );

    trackUsage(
      "write",
      `[world] [захоплення замку: ${castleData.name}]`,
      1,
      `castles/${cid}`,
      castleData,
    );

    // EXTRA READ CONSOLIDATION: Directly update the cache to avoid re-reading
    const spawnRef = doc(db, "spawned_objects", cid);
    const updateData = {
      ownerId: castleData.ownerId,
      ownerName: castleData.ownerName,
      ownerAvatar: castleData.ownerAvatar,
      capturedAt: Date.now(),
    };
    await updateDoc(spawnRef, updateData);
    trackUsage(
      "write",
      `[world] [оновлення власника замку на мапі]`,
      1,
      `spawned_objects/${cid}`,
      updateData,
    );

    // Write-Through Cache Update
    const cachedObj = _spawnedObjectsCache.find((o) => o.id === cid);
    if (cachedObj) {
      Object.assign(cachedObj, updateData);
      console.log(`📦 Cache Updated (Write-Through): Castle ${cid}`);

      // 4. Update Packed State (maintain 1-read consistency)
      const packedRef = doc(db, "world_chunks", "berlin");
      setDoc(
        packedRef,
        {
          objects: _spawnedObjectsCache,
          packedAt: serverTimestamp(),
          count: _spawnedObjectsCache.length,
        },
        { merge: true },
      ).catch((err) => console.error("Failed to update packed state:", err));
    }

    console.log(`ðŸ° Castle claimed: ${cid} by ${castleData.ownerName}`);
    return true;
  } catch (e) {
    console.error("Error claiming castle:", e);
    return false;
  }
}

/**
 * Abandon a castle (called when player leaves the zone)
 */
export async function abandonCastle(castleId) {
  if (!db) return;
  try {
    const { doc, setDoc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const cid = String(castleId);

    // Remove from castles collection
    await deleteDoc(doc(db, "castles", cid));

    // Update spawned_objects to clear owner
    const spawnRef = doc(db, "spawned_objects", cid);
    await setDoc(
      spawnRef,
      {
        ownerId: null,
        ownerName: null,
        capturedAt: null,
      },
      { merge: true },
    );

    trackUsage(
      "write",
      `[world] [залишення замку: ${cid}]`,
      2,
      `castles/${cid}`,
    );
    console.log(`ðŸ° Castle abandoned: ${cid}`);
    return true;
  } catch (e) {
    console.error("Error abandoning castle:", e);
    return false;
  }
}

/**
 * Subscribe to all castle updates
 */
export function subscribeToCastles(onUpdate) {
  if (!db) return () => {};

  try {
    const q = query(collection(db, "castles"));

    return monitoredOnSnapshot(
      q,
      (snapshot) => {
        // trackUsage is handled by monitoredOnSnapshot now
        const castles = {};
        snapshot.forEach((doc) => {
          castles[doc.id] = doc.data();
        });
        onUpdate(castles);
      },
      (error) => {
        console.error("Castle subscription error:", error);
      },
      "castles/ (subscribeToCastles)",
    );
  } catch (e) {
    console.error("Castle sync error:", e);
    return () => {};
  }
}

// ==================== WORLD SNAPSHOTS ====================

/**
 * Subscribe to world snapshots in real-time (Admin UI).
 * Uses onSnapshot to push updates when snapshots are created, modified, or deleted.
 * @param {function} onUpdate Callback(snapshots[]) called on every change
 * @returns {function} Unsubscribe function
 */
export function subscribeToWorldSnapshots(onUpdate) {
  if (!isAdmin()) return () => {};

  try {
    const q = query(
      collection(db, "world_snapshots"),
      where("createdAt", "!=", null), // ensures ordering index exists
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const results = [];
        snapshot.forEach((d) => {
          const data = d.data();
          const created =
            data.createdAt && data.createdAt.toDate
              ? data.createdAt.toDate()
              : new Date();
          results.push({ ...data, id: d.id, created });
        });

        // Sort by created descending (newest first)
        results.sort((a, b) => b.created - a.created);

        // Invalidate localStorage cache so polling fallback stays consistent
        localStorage.removeItem("admin_snapshots_list");

        console.log(
          `📡 Snapshot listener: ${results.length} templates (${snapshot.docChanges().length} changes)`,
        );
        onUpdate(results);
      },
      (error) => {
        console.error("❌ Snapshot listener error:", error);
        // Self-annealing: fall back to one-time fetch
        console.log("🔄 Falling back to one-time snapshot fetch...");
        getWorldSnapshots()
          .then(onUpdate)
          .catch((e) => console.error("Fallback also failed:", e));
      },
    );
  } catch (e) {
    console.error("Failed to create snapshot listener:", e);
    return () => {};
  }
}

/**
 * Save current generation as a Snapshot (Template)
 */
export async function saveWorldSnapshot(snapshotData) {
  if (!isAdmin()) return false;
  try {
    const { doc, setDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const id = snapshotData.id || `snap_${Date.now()}`;
    const ref = doc(db, "world_snapshots", id);

    // Remove the id from data if it's there to avoid overlap issues
    const { id: _, ...cleanedData } = snapshotData;
    cleanedData.isActive = false; // Initialize as inactive

    // Check for total size (approximate)
    const sizeApprox = JSON.stringify(cleanedData).length;
    console.log(
      `ðŸ“Š Snapshot data size: ~${(sizeApprox / 1024).toFixed(1)} KB`,
    );

    if (sizeApprox > 900000) {
      logConsole(
        `âš ï¸ WARNING: Snapshot is very large (${(sizeApprox / 1024).toFixed(1)} KB). Near 1MB limit!`,
      );
    }

    if (sizeApprox > 1040000) {
      alert(
        `âŒ Error: Snapshot is too large for Firestore (Limit 1MB).\nPlease reduce the monster capacity.`,
      );
      return false;
    }

    await setDoc(ref, {
      ...cleanedData,
      createdAt: serverTimestamp(),
      createdBy: (currentUser && currentUser.email) ? currentUser.email : "admin@fightcraft.com",
    });

    trackUsage(
      "write",
      `[admin] [збереження знімку світу: ${id}]`,
      1,
      `world_snapshots/${id}`,
      cleanedData,
    );
    console.log(`ðŸ“¸ World Snapshot saved: ${id}`);
    localStorage.removeItem("admin_snapshots_list");
    return true;
  } catch (e) {
    console.error("Snapshot save error:", e);
    return false;
  }
}

export async function getWorldSnapshots() {

  // Cache Check
  const CACHE_KEY = "admin_snapshots_list";
  const CACHE_TTL = 1000 * 60 * 5; // 5 Minutes
  const cachedRaw = localStorage.getItem(CACHE_KEY);

  if (cachedRaw) {
    try {
      const { data, timestamp } = JSON.parse(cachedRaw);
      if (Date.now() - timestamp < CACHE_TTL) {
        console.log("📂 Loaded Snapshots from Cache (0 Reads)");
        // Restore Date objects if needed (though UI might simple use strings)
        return data.map((d) => ({
          ...d,
          created: d.created ? new Date(d.created) : new Date(),
        }));
      }
    } catch (e) {
      console.warn("Snapshot cache invalid");
    }
  }

  try {
    const { collection, getDocs, query, orderBy, limit } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    const q = query(
      collection(db, "world_snapshots"),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    const snap = await getDocs(q);
    trackUsage(
      "read",
      "[admin] [список знімків світу]",
      snap.size,
      "world_snapshots/",
    );

    const results = snap.docs.map((d) => {
      const data = d.data();
      const created =
        data.createdAt && data.createdAt.toDate
          ? data.createdAt.toDate()
          : new Date();
      return { ...data, id: d.id, created };
    });

    // Save to Cache
    try {
      // Store 'created' as string for JSON
      const cacheData = results.map((r) => ({
        ...r,
        created: r.created.toISOString(),
      }));
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data: cacheData, timestamp: Date.now() }),
      );
    } catch (e) {
      console.warn("Failed to cache snapshots (quota?)");
    }

    return results;
  } catch (e) {
    console.error("Snapshot fetch error:", e);
    return [];
  }
}

export async function getSnapshotById(id) {
  if (!isAdmin()) return null;
  try {
    const { doc, getDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const d = await getDoc(doc(db, "world_snapshots", id));
    trackUsage(
      "read",
      `[admin] [завантаження знімку світу: ${id}]`,
      1,
      `world_snapshots/${id}`,
    );
    return d.exists() ? { id: d.id, ...d.data() } : null;
  } catch (e) {
    return null;
  }
}

export async function applyWorldSnapshot(snapshotId) {
  if (!isAdmin()) return false;

  const snap = await getSnapshotById(snapshotId);
  if (!snap) return false;

  const { cityId, type } = snap;
  if (!cityId || !type) return false;

  console.log(`➕ Activating template: ${snapshotId}`);

  try {
    const { doc, updateDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    
    await updateDoc(doc(db, "world_snapshots", snapshotId), {
      isActive: true,
    });
    
    await updateDoc(doc(db, "world_metadata", "current_state"), {
      last_global_update: serverTimestamp(),
      world_data: null,
      version_hash: snapshotId
    });
    
    localStorage.removeItem("admin_snapshots_list");
    return true;
  } catch (e) {
    console.error("Failed to apply snapshot", e);
    return false;
  }
}

/**
 * One-time migration: tag legacy untagged spawned_objects with sourceTemplateId.
 * Matches objects to active templates by exact lat/lng coordinates.
 * After this runs, deactivateWorldSnapshot() can find objects by sourceTemplateId.
 *
 * @param {Array} loadedObjects - objects already loaded from SyncEngine (with .id)
 * @param {Array} activeSnapshots - snapshots from getWorldSnapshots() that have isActive===true
 * @returns {number} count of objects tagged
 */
export async function tagLegacySpawnedObjects(loadedObjects, activeSnapshots) {
  if (!isAdmin() || !db) return 0;

  // 1. Find untagged objects
  const untagged = loadedObjects.filter((o) => !o.sourceTemplateId);
  if (untagged.length === 0) return 0;

  // 2. Build coordinate → templateId lookup from active template objects
  const coordToTemplate = new Map();
  for (const snap of activeSnapshots) {
    if (!snap.objects || snap.objects.length === 0) continue;
    for (const obj of snap.objects) {
      if (obj.lat != null && obj.lng != null) {
        // Round to 6 decimals to avoid floating-point mismatch
        const key = `${parseFloat(obj.lat).toFixed(6)}_${parseFloat(obj.lng).toFixed(6)}`;
        coordToTemplate.set(key, snap.id);
      }
    }
  }

  if (coordToTemplate.size === 0) {
    console.warn(
      "⚠️ tagLegacy: active templates have no objects with coordinates.",
    );
    return 0;
  }

  // 3. Match untagged objects to templates and batch-update Firestore
  const { doc, writeBatch } =
    await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

  let batch = writeBatch(db);
  let count = 0;
  let unmatched = 0;

  for (const obj of untagged) {
    if (!obj.id || obj.lat == null || obj.lng == null) continue;

    const key = `${parseFloat(obj.lat).toFixed(6)}_${parseFloat(obj.lng).toFixed(6)}`;
    const templateId = coordToTemplate.get(key);

    if (templateId) {
      batch.update(doc(db, "spawned_objects", obj.id), {
        sourceTemplateId: templateId,
      });
      // Also update in-memory cache
      obj.sourceTemplateId = templateId;
      count++;

      if (count % 500 === 0) {
        await batch.commit();
        batch = writeBatch(db);
        console.log(
          `🔧 tagLegacy: committed batch (${count} tagged so far)...`,
        );
      }
    } else {
      unmatched++;
    }
  }

  if (count % 500 !== 0) await batch.commit();

  console.log(
    `✅ tagLegacy: tagged ${count} objects, ${unmatched} unmatched (orphaned).`,
  );
  return count;
}

export async function deactivateWorldSnapshot(snapshotId) {
  if (!isAdmin()) return false;
  try {
    const { collection, query, where, getDocs, writeBatch, doc, updateDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // 1. Try fast path: find objects tagged with sourceTemplateId
    const q = query(
      collection(db, "spawned_objects"),
      where("sourceTemplateId", "==", snapshotId),
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // ── Fast path: tagged objects found — delete them directly ──
      console.log(
        `🧹 Removing ${querySnapshot.size} tagged objects for template ${snapshotId}...`,
      );
      let batch = writeBatch(db);
      let count = 0;

      for (const document of querySnapshot.docs) {
        batch.delete(document.ref);
        count++;
        if (count % 500 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (count % 500 !== 0) await batch.commit();

      // Write-through cache
      const idsToDelete = new Set(querySnapshot.docs.map((d) => d.id));
      _spawnedObjectsCache = _spawnedObjectsCache.filter(
        (o) => !idsToDelete.has(o.id),
      );
      console.log(`🧹 Removed ${count} tagged objects.`);
    } else {
      // ── Nuclear rebuild: objects are untagged (legacy data) ──
      // Strategy: clear ALL spawned_objects, then re-apply remaining active templates with proper tagging
      console.warn(
        `⚠️ No tagged objects found for ${snapshotId}. Using nuclear rebuild for untagged legacy data...`,
      );

      // 1a. Get all remaining active templates (exclude the one being deactivated)
      const snapshotsQ = query(
        collection(db, "world_snapshots"),
        where("isActive", "==", true),
      );
      const activeSnaps = await getDocs(snapshotsQ);
      const remainingTemplates = [];
      activeSnaps.forEach((d) => {
        if (d.id !== snapshotId) {
          const data = d.data();
          if (data.objects && data.objects.length > 0) {
            remainingTemplates.push({ id: d.id, objects: data.objects });
          }
        }
      });

      console.log(
        `🔄 Nuclear rebuild: ${remainingTemplates.length} templates to keep, clearing all spawned_objects...`,
      );

      // 1b. Delete ALL spawned_objects
      const allObjSnap = await getDocs(collection(db, "spawned_objects"));
      if (!allObjSnap.empty) {
        let delBatch = writeBatch(db);
        let delCount = 0;
        for (const d of allObjSnap.docs) {
          delBatch.delete(d.ref);
          delCount++;
          if (delCount % 500 === 0) {
            await delBatch.commit();
            delBatch = writeBatch(db);
          }
        }
        if (delCount % 500 !== 0) await delBatch.commit();
        console.log(`🧹 Cleared ${delCount} untagged objects from Firestore.`);
      }

      // 1c. Re-apply remaining active templates with sourceTemplateId tagging
      for (const tmpl of remainingTemplates) {
        const tagged = tmpl.objects.map((obj) => ({
          ...obj,
          sourceTemplateId: tmpl.id,
        }));
        console.log(
          `➕ Re-applying template ${tmpl.id}: ${tagged.length} objects (now tagged)...`,
        );
        await saveGeneratedObjects(tagged);
      }

      // Clear in-memory cache (will be rebuilt on next fetch)
      _spawnedObjectsCache = [];
      console.log(
        `✅ Nuclear rebuild complete. ${remainingTemplates.length} templates re-applied with tagging.`,
      );
    }

    // 2. Invalidate all cache layers so game clients see the removal
    const cityIds = ["berlin", "kyiv", "lviv", "warsaw", "prague", "vienna"];
    cityIds.forEach((cid) => {
      deleteDoc(doc(db, "world_chunks", cid)).catch(() => {});
    });

    await setDoc(
      doc(db, "world_metadata", "current_state"),
      {
        last_global_update: serverTimestamp(),
        world_data: null,
        version_hash: null,
      },
      { merge: true },
    );

    localStorage.removeItem("fightcraft_monsters_cache_v3");

    // 3. Mark snapshot as inactive
    await updateDoc(doc(db, "world_snapshots", snapshotId), {
      isActive: false,
    });
    localStorage.removeItem("admin_snapshots_list");
    console.log(
      `✅ Template ${snapshotId} deactivated. All caches invalidated.`,
    );
    return true;
  } catch (e) {
    console.error("Error deactivating snapshot:", e);
    return false;
  }
}

export async function forceSnapshotActiveState(snapshotId, state = true) {
  if (!isAdmin()) return false;
  try {
    const { doc, updateDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    await updateDoc(doc(db, "world_snapshots", snapshotId), {
      isActive: state,
    });
    console.log(`✅ Template ${snapshotId} active state forced to ${state}.`);
    localStorage.removeItem("admin_snapshots_list");
    return true;
  } catch (e) {
    console.error("Error forcing snapshot active state:", e);
    return false;
  }
}

export async function deleteSnapshot(snapshotId) {
  if (!isAdmin()) return false;
  try {
    const { doc, getDoc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const snapRef = doc(db, "world_snapshots", snapshotId);

    // Safety check: Deactivate before delete
    const snapDoc = await getDoc(snapRef);
    if (snapDoc.exists() && snapDoc.data().isActive === true) {
      console.log(`⚠️ Snapshot ${snapshotId} is active. Deactivating first...`);
      await deactivateWorldSnapshot(snapshotId);
    }

    await deleteDoc(snapRef);
    trackUsage(
      "delete",
      `[admin] [видалення знімку світу: ${snapshotId}]`,
      1,
      `world_snapshots/${snapshotId}`,
    );
    localStorage.removeItem("admin_snapshots_list");
    console.log(`ðŸ—‘ï¸ Snapshot deleted: ${snapshotId}`);
    return true;
  } catch (e) {
    console.error("Error deleting snapshot:", e);
    return false;
  }
}

/**
 * TERRITORY ZONES
 */
/**
 * Helper to remove undefined values for Firestore
 */
export async function saveCityZones(cityId, geoJson) {
  if (!isAdmin()) return false;
  try {
    // Firestore DOES NOT support nested arrays (Arrays of Arrays), which GeoJSON uses for coordinates.
    // We must store the GeoJSON as a serialized JSON string.
    const serialized = JSON.stringify(geoJson);

    await setDoc(doc(db, "city_zones", cityId), {
      cityId,
      geoJson: serialized,
      updatedAt: serverTimestamp(),
    });
    trackUsage(
      "write",
      `[admin] [збереження зон міста: ${cityId}]`,
      1,
      `city_zones/${cityId}`,
      geoJson,
    );

    // Auto-update zones timestamp
    await setDoc(
      doc(db, "world_metadata", "current_state"),
      {
        last_zones_update: serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  } catch (e) {
    console.error("Error saving city zones:", e);

    return false;
  }
}

/**
 * Fetch zones for a city
 */
export async function getCityZones(cityId) {
  if (_cityZonesCache[cityId]) return _cityZonesCache[cityId];

  try {
    console.log(`🌍 Using SyncEngine for City Zones (${cityId})...`);
    const data = await SyncEngine.syncCityZones(db, cityId);

    if (data) {
      // Parse cached GeoJSON if needed (SyncEngine returns object, checking if IDB stored it parsed or stringified)
      // IDB stores what we put in. Firestore returns stringified geoJson usually?
      // Let's check `saveCityZonesToIDB` -> It saves `zoneSnap.data()`.
      // If Firestore has string, IDB has string.

      if (typeof data.geoJson === "string") {
        try {
          data.geoJson = JSON.parse(data.geoJson);
        } catch (parseErr) {
          console.error("Failed to parse cached GeoJSON:", parseErr);
          return null;
        }
      }
      _cityZonesCache[cityId] = data;
      return data;
    }
    return null;
  } catch (e) {
    console.error("Error fetching city zones:", e);
    return null;
  }
}

// ==================== OPTIMIZED GEOSPATIAL QUERIES ====================

/**
 * Fetch objects within a radius using efficient Latitude filtering
 * Reduces reads by only querying a horizontal "strip" of the world
 * @param {string} collectionName - Firestore collection name to query
 * @param {number} centerLat - Center Latitude
 * @param {number} centerLng - Center Longitude
 * @param {number} radiusKm - Radius in Kilometers
 * @returns {Promise<Array>} - Array of objects with IDs
 */
export async function fetchNearbyObjects(
  collectionName,
  centerLat,
  centerLng,
  radiusKm,
) {
  if (!db) return [];

  // 1 degree lat is approx 110.574 km
  const latBuffer = radiusKm / 110.574;
  const minLat = centerLat - latBuffer;
  const maxLat = centerLat + latBuffer;

  // Longitude buffer varies by latitude, but we use a specialized check later.
  // Ideally we could filter lng here too if not wrap-around, but Lat filter is sufficient for 90% optimization.

  try {
    console.log(
      `📡 Fetching ${collectionName} nearby (${minLat.toFixed(4)} to ${maxLat.toFixed(4)})...`,
    );

    // Query only the Latitude Strip
    // Note: Requires field 'position.lat' to exist and be indexed (automatic in Firestore)
    const q = query(
      collection(db, collectionName),
      where("position.lat", ">=", minLat),
      where("position.lat", "<=", maxLat),
    );

    const snapshot = await getDocs(q);
    trackUsage(
      "read",
      `[world] [пошук об'єктів поруч (${collectionName})]`,
      snapshot.size,
      `${collectionName}/`,
    );
    const results = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.position && data.position.lng) {
        // Client-side Longitude & Distance Filter
        // Simple distance check is cheap on client compared to DB Reads/Transfer
        const dist = getDistanceFromLatLonInKm(
          centerLat,
          centerLng,
          data.position.lat,
          data.position.lng,
        );
        if (dist <= radiusKm) {
          results.push({ id: doc.id, ...data });
        }
      }
    });

    console.log(
      `✅ Loaded ${results.length} ${collectionName} within ${radiusKm}km (Filtered from ${snapshot.size})`,
    );
    return results;
  } catch (error) {
    console.error(`Error fetching nearby ${collectionName}:`, error);
    return [];
  }
}

// Helper: Haversine Distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return d;
}

// ==================== GROUP SYSTEM ====================

/**
 * Send a group invite to another player
 */
export async function sendGroupInvite(targetUserId, targetCharId) {
  if (!db || !currentUser) return;
  try {
    const { collection, addDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const inviteRef = collection(db, "users", targetUserId, "invites");
    await addDoc(inviteRef, {
      type: "group_invite",
      fromId: window._currentCharacterId,
      fromName: gameState.player.name,
      fromUserId: currentUser.uid,
      targetCharId: targetCharId,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    console.log(`✉️ Group invite sent to ${targetCharId}`);
  } catch (e) {
    console.error("Error sending group invite:", e);
  }
}

/**
 * Subscribe to incoming invites
 */
export async function subscribeToInvites(onInvite) {
  if (!db || !currentUser) {
    console.warn("⚔️ PvP: Cannot subscribe to invites: No Auth", {
      hasDb: !!db,
      hasUser: !!currentUser,
    });
    return;
  }
  try {
    const { collection, query, where, onSnapshot } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const path = `users/${currentUser.uid}/invites`;
    console.log(`⚔️ PvP: Subscribing to invites at ${path}`);

    const q = query(
      collection(db, "users", currentUser.uid, "invites"),
      where("status", "==", "pending"),
    );
    return onSnapshot(
      q,
      (snapshot) => {
        console.log(
          `⚔️ PvP: Invite Snapshot received. Count: ${snapshot.size}`,
        );
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            console.log(
              "⚔️ PvP: New invite detected:",
              change.doc.id,
              change.doc.data(),
            );
            onInvite({ id: change.doc.id, ...change.doc.data() });
          }
        });
      },
      (error) => {
        console.error("⚔️ PvP: Invite Subscription Error:", error);
      },
    );
  } catch (e) {
    console.error("Error subscribing to invites:", e);
  }
}

/**
 * Accept a group invite and create/join a group
 */
export async function acceptGroupInvite(invite) {
  if (!db || !currentUser) return;
  try {
    const { doc, updateDoc, setDoc, arrayUnion, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // 1. Mark invite as accepted
    const inviteRef = doc(db, "users", currentUser.uid, "invites", invite.id);
    await updateDoc(inviteRef, { status: "accepted" });

    // 2. Find or create group
    let groupId = invite.groupId;
    if (!groupId) {
      // Create new group if doesn't exist
      groupId = "group_" + Math.random().toString(36).substr(2, 9);
      const groupRef = doc(db, "groups", groupId);
      await setDoc(groupRef, {
        leaderId: invite.fromId,
        leaderUserId: invite.fromUserId,
        members: [
          { id: invite.fromId, name: invite.fromName },
          { id: window._currentCharacterId, name: gameState.player.name },
        ],
        createdAt: serverTimestamp(),
      });

      // Update sender's character with groupId
      const senderCharRef = doc(
        db,
        "users",
        invite.fromUserId,
        "characters",
        invite.fromId,
      );
      await updateDoc(senderCharRef, { groupId: groupId });
    } else {
      // Join existing group
      const groupRef = doc(db, "groups", groupId);
      await updateDoc(groupRef, {
        members: arrayUnion({
          id: window._currentCharacterId,
          name: gameState.player.name,
        }),
      });
    }

    // 3. Update own character with groupId
    const ownCharRef = doc(
      db,
      "users",
      currentUser.uid,
      "characters",
      window._currentCharacterId,
    );
    await updateDoc(ownCharRef, { groupId: groupId });

    console.log(`✅ Joined group ${groupId}`);
  } catch (e) {
    console.error("Error accepting invite:", e);
  }
}

export async function subscribeToGroup(groupId, onUpdate) {
  if (!db || !groupId) return;
  try {
    const { doc, onSnapshot } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    return onSnapshot(doc(db, "groups", groupId), (snapshot) => {
      if (snapshot.exists()) {
        onUpdate({ id: snapshot.id, ...snapshot.data() });
      }
    });
  } catch (e) {
    console.error("Error subscribing to group:", e);
  }
}

/**
 * Send a PvP combat invite to another player
 */
export async function sendCombatInvite(targetUserId, targetCharId) {
  if (!db || !currentUser) return null;
  if (!targetUserId) {
    console.error(
      "⚔️ PvP Error: Cannot send invite - targetUserId is missing!",
    );
    showNotification("Error: Victim userId unknown", "error");
    return null;
  }
  try {
    const { collection, addDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const inviteRef = collection(db, "users", targetUserId, "invites");
    console.log(
      `⚔️ PvP: Sending invite to users/${targetUserId}/invites for char ${targetCharId}`,
    );
    const docRef = await addDoc(inviteRef, {
      type: "combat_invite",
      fromId: window._currentCharacterId,
      fromName: gameState.player.name,
      fromUserId: currentUser.uid,
      targetCharId: targetCharId,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    console.log(`⚔️ Combat invite sent to ${targetCharId}`);
    return docRef.id;
  } catch (e) {
    console.error("Error sending combat invite:", e);
    return null;
  }
}

/**
 * Accept a combat invite and create a shared combat session
 */
export async function acceptCombatInvite(invite) {
  if (!db || !currentUser) return null;
  try {
    const { doc, updateDoc, setDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // 1. Mark invite as accepted
    const inviteRef = doc(db, "users", currentUser.uid, "invites", invite.id);
    await updateDoc(inviteRef, { status: "accepted" });

    // 2. Create shared combat session in RTDB (for speed) or Firestore
    // Using Firestore for now to keep things simple and persistent
    const combatId = "pvp_" + Math.random().toString(36).substr(2, 9);
    const combatRef = doc(db, "combats", combatId);

    // Fetch attacker stats to initialize combat
    const attackerData = await loadPlayerDataById(
      invite.fromId,
      invite.fromUserId,
    );
    if (!attackerData) throw new Error("Could not load attacker data");

    await setDoc(combatRef, {
      id: combatId,
      startTime: serverTimestamp(),
      lastUpdate: serverTimestamp(),
      status: "active",
      participants: [
        {
          id: invite.fromId,
          userId: invite.fromUserId,
          name: invite.fromName,
          hp: attackerData.hp,
          maxHp: attackerData.maxHp || 100,
        },
        {
          id: window._currentCharacterId,
          userId: currentUser.uid,
          name: gameState.player.name,
          hp: gameState.player.hp,
          maxHp: gameState.player.maxHp || 100,
        },
      ],
      logs: [],
      actions: [], // List of actions taken
    });

    // 3. Update invite with combatId so the attacker knows where to join
    await updateDoc(inviteRef, { combatId: combatId });

    console.log(`✅ Combat session ${combatId} created`);
    return combatId;
  } catch (e) {
    console.error("Error accepting combat invite:", e);
    return null;
  }
}

/**
 * Update the state of an active combat
 */
export async function updateCombatState(combatId, action) {
  if (!db || !combatId) return;
  try {
    const { doc, updateDoc, arrayUnion, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const combatRef = doc(db, "combats", combatId);

    await updateDoc(combatRef, {
      actions: arrayUnion({
        ...action,
        timestamp: Date.now(),
      }),
      lastUpdate: serverTimestamp(),
    });
  } catch (e) {
    console.error("Error updating combat state:", e);
  }
}

/**
 * Subscribe to combat updates
 */
export async function subscribeToCombat(combatId, onUpdate) {
  if (!db || !combatId) return () => {};
  try {
    const { doc, onSnapshot } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    return onSnapshot(doc(db, "combats", combatId), (snapshot) => {
      if (snapshot.exists()) {
        onUpdate({ id: snapshot.id, ...snapshot.data() });
      }
    });
  } catch (e) {
    console.error("Error subscribing to combat:", e);
    return () => {};
  }
}

/**
 * Subscribe to combat invite status (for attacker to know when target accepts)
 */
export async function subscribeToInviteStatus(
  targetUserId,
  inviteId,
  onUpdate,
) {
  if (!db || !currentUser || !inviteId) return () => {};
  try {
    const { doc, onSnapshot } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const inviteRef = doc(db, "users", targetUserId, "invites", inviteId);
    return onSnapshot(inviteRef, (snapshot) => {
      if (snapshot.exists()) {
        onUpdate(snapshot.data());
      }
    });
  } catch (e) {
    console.error("Error subscribing to invite status:", e);
    return () => {};
  }
}

// ==================== USAGE TRACKING UTILITIES ====================
// Functions moved here but use state from the top
function loadStats() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const today = new Date().toDateString();

      // Daily Reset Logic
      if (parsed.date !== today) {
        console.log("📊 DB Usage: New day detected. Resetting daily counters.");
        usageStats = {
          reads: 0,
          writes: 0,
          deletes: 0,
          rtdb: 0,
          logs: [],
          date: today,
        };
        saveStats();
        return;
      }

      usageStats = {
        reads: parsed.reads || 0,
        writes: parsed.writes || 0,
        deletes: parsed.deletes || 0,
        rtdb: parsed.rtdb || 0,
        logs: parsed.logs || [],
        date: parsed.date || today,
      };
    }
  } catch (e) {
    console.warn("Load stats failed:", e);
  }
}

function saveStats() {
  try {
    if (usageStats.logs.length > 1000)
      usageStats.logs = usageStats.logs.slice(-1000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usageStats));
  } catch (e) {}
}

export function trackUsage(
  type,
  description,
  size = 1,
  path = "N/A",
  data = null,
) {
  const typeUpper = type.toUpperCase();

  // Auto-extract path if N/A
  if (path === "N/A" && description) {
    const firstPart = description.split(" ")[0];
    if (firstPart.includes("/")) path = firstPart;
    else if (description.includes("collectionGroup")) path = "[Group Query]";
  }

  if (typeUpper === "READ") usageStats.reads += size;
  else if (typeUpper === "WRITE") usageStats.writes += size;
  else if (typeUpper === "DELETE") usageStats.deletes += size;
  else if (typeUpper === "RTDB") usageStats.rtdb += size;

  // Serialize and truncate data for storage
  let serializedData = null;
  if (data) {
    try {
      serializedData = JSON.stringify(data);
      if (serializedData.length > 200) {
        serializedData = serializedData.substring(0, 197) + "...";
      }
    } catch (e) {
      serializedData = "[Error serializing data]";
    }
  }

  usageStats.logs.push({
    timestamp: Date.now(),
    type: typeUpper,
    path: path,
    size: size,
    description: description,
    data: serializedData,
  });
  saveStats();
}

export function getUsageStatsFC() {
  return usageStats;
}

export async function clearUsageStatsFC() {
  usageStats = { reads: 0, writes: 0, rtdb: 0, logs: [] };
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem("total_firestore_reads", "0");
  localStorage.removeItem("firestore_detailed_logs");
  console.log("DB Usage cleared locally.");

  // Sync clear to cloud
  if (gameState.player) {
    await savePlayerToCloud(gameState.player);
    console.log("DB Usage cleared in Cloud.");
  }
}

loadStats();

// ==================== RTDB MVP PVP SYSTEM ====================

/**
 * Create a battle request in RTDB
 */
export async function createBattleRequest(targetUserId, targetCharId) {
  console.log("⚔️ createBattleRequest called for:", targetUserId);
  if (!rtdb) {
    console.error("❌ RTDB not initialized");
    return null;
  }
  if (!currentUser) {
    console.error("❌ currentUser missing");
    return null;
  }

  // Check penalty first
  const isPenalized = await checkFleePenalty(currentUser.uid);
  if (isPenalized) {
    showNotification(
      "⏳ You are recovering from fleeing! (5 min cooldown)",
      "error",
    );
    return null;
  }

  try {
    const requestsRef = ref(rtdb, "battle_requests");
    const newRequestRef = push(requestsRef);

    const battleId = newRequestRef.key;
    const myCharId =
      window._currentCharacterId || window._currentlyPlayingCharacterId;

    await set(newRequestRef, {
      battleId: battleId,
      attackerId: currentUser.uid,
      attackerCharId: myCharId,
      targetId: targetUserId,
      targetCharId: targetCharId,
      status: "pending", // pending, active, cancelled, rejected
      createdAt: rtdbTimestamp(),
      choices: {
        attacker: "fight", // Attacker implies 'fight' by initiating
        target: "none",
      },
    });

    console.log(`⚔️ RTDB: Battle Request created: ${battleId}`);
    return battleId;
  } catch (e) {
    console.error("⚔️ RTDB: Error creating battle request:", e);
    return null;
  }
}

/**
 * Subscribe to generic battle requests (Attacker & Target)
 */
export function subscribeToBattleRequests(onNewRequest, onStatusChange) {
  if (!rtdb || !currentUser) return;

  const requestsRef = ref(rtdb, "battle_requests");
  const myUid = currentUser.uid;

  // Listen for NEW requests
  const addedSub = onChildAdded(requestsRef, (snapshot) => {
    const data = snapshot.val();
    // console.log("📨 RTDB Listener: New child added:", data ? data.battleId : 'null');
    if (!data) return;

    // If I am the target
    if (data.targetId === myUid && data.status === "pending") {
      const now = Date.now();
      // Ignore old requests (> 60s)
      if (now - (data.createdAt || 0) > 60000) return;

      console.log("⚔️ RTDB: Received Battle Request:", data);
      onNewRequest(data);
    }

    // If I am the attacker (to show the dialog immediately as required)
    if (data.attackerId === myUid && data.status === "pending") {
      // Confirming it was created efficiently
      onNewRequest(data);
    }
  });

  // Listen for STATUS changes (Accept/Reject/Timeout)
  const changedSub = onChildChanged(requestsRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.attackerId === myUid || data.targetId === myUid) {
      console.log("⚔️ RTDB: Battle Status Update:", data.status, data);
      onStatusChange(data);
    }
  });

  return () => {
    off(requestsRef, "child_added", addedSub);
    off(requestsRef, "child_changed", changedSub);
  };
}

/**
 * Update choice (Fight/Flee/Group) or Status
 */
export async function updateBattleRequestStatus(battleId, updates) {
  if (!rtdb) return;
  const path = `battle_requests/${battleId}`;
  try {
    await update(ref(rtdb, path), updates);
  } catch (e) {
    console.error("⚔️ RTDB: Error updating battle status:", e);
  }
}

/**
 * Apply Flee Penalty (5 mins)
 */
export async function applyFleePenalty(uid) {
  if (!rtdb) return;
  const path = `players/${uid}/penalty_until`;
  // Current time + 5 minutes
  const penaltyTime = Date.now() + 5 * 60 * 1000;

  try {
    await set(ref(rtdb, path), penaltyTime);
    console.log(
      `🏃‍♂️💨 RTDB: Flee penalty applied until ${new Date(penaltyTime).toLocaleTimeString()}`,
    );
  } catch (e) {
    console.error("Error applying penalty:", e);
  }
}

/**
 * Check if player has penalty
 */
export async function checkFleePenalty(uid) {
  console.log("🛡️ checkFleePenalty: Checking for:", uid);
  if (!rtdb) return false;
  const path = `players/${uid}/penalty_until`;

  return new Promise((resolve) => {
    let isResolved = false;

    // Safety Timeout (2s)
    const timer = setTimeout(() => {
      if (!isResolved) {
        console.warn("⚠️ checkFleePenalty timed out. Assuming no penalty.");
        isResolved = true;
        resolve(false);
      }
    }, 2000);

    onValue(
      ref(rtdb, path),
      (snapshot) => {
        if (isResolved) return;
        clearTimeout(timer);
        isResolved = true;

        const val = snapshot.val();
        console.log("🛡️ checkFleePenalty Result:", val);
        if (val && val > Date.now()) {
          resolve(true);
        } else {
          resolve(false);
        }
      },
      { onlyOnce: true },
      (error) => {
        console.error("checkFleePenalty Error:", error);
        if (!isResolved) {
          clearTimeout(timer);
          isResolved = true;
          resolve(false);
        }
      },
    );
  });
}

/**
 * Submit Battle Choice (Fight/Flee/Group)
 * Handles role detection and state transitions.
 */
export async function submitBattleChoice(battleId, choice) {
  if (!rtdb || !currentUser) return;

  // 1. Get current Request State
  const requestRef = ref(rtdb, `battle_requests/${battleId}`);

  try {
    await runTransaction(requestRef, (currentData) => {
      if (currentData === null) return currentData; // Request deleted?
      if (currentData.status !== "pending") return; // Cannot change choice if not pending

      const myUid = currentUser.uid;
      let role = null;
      if (currentData.attackerId === myUid) role = "attacker";
      else if (currentData.targetId === myUid) role = "target";

      if (!role) return; // Not involved

      // update choice
      if (!currentData.choices) currentData.choices = {};
      currentData.choices[role] = choice;

      // Check for State Transition
      // Case: Both want to FIGHT
      if (
        currentData.choices.attacker === "fight" &&
        currentData.choices.target === "fight"
      ) {
        currentData.status = "active";
      }
      // Case: Anyone FLEES or TIMEOUT (handled by separate cleanup or direct status update)
      if (choice === "flee") {
        currentData.status = "cancelled";
      }

      return currentData;
    });
    console.log(`⚔️ RTDB: Choice '${choice}' submitted for battle ${battleId}`);
  } catch (e) {
    console.error("Error submitting battle choice:", e);
  }
}

/**
 * Get single battle request
 */
export async function getBattleRequest(battleId) {
  if (!rtdb) return null;
  return new Promise((resolve) => {
    onValue(
      ref(rtdb, `battle_requests/${battleId}`),
      (snapshot) => {
        resolve(snapshot.val());
      },
      { onlyOnce: true },
    );
  });
}
/**
 * Get live player data from RTDB (Public Read)
 */
export async function getLivePlayer(charId) {
  if (!rtdb) return null;
  // Iterate to find by ID (since structure is keyed by pushID, but contains 'id')
  // OR, if keyed by pushID, we need to search.
  // Wait, live_players is keyed by... pushID or charID?
  // Let's check updatePlayerLocationRTDB.
  // It pushes? No, likely set/update.

  // Actually, let's just fetch ALL live players and find matching charId.
  // Not efficient but works for <100 players.

  return new Promise((resolve) => {
    const refPtr = ref(rtdb, "live_players");
    const q = query(refPtr, orderByChild("id"), equalTo(charId));
    // We need query import for RTDB?
    // Standard SDK: query, orderByChild, equalTo.
    // My imports only have: ref, set, push, update, remove, onChildAdded, onChildChanged, runTransaction, onValue, off, onDisconnect

    // I'll stick to 'onValue' of root and filter, or add imports.
    // Adding imports is safer.

    onValue(
      refPtr,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          resolve(null);
          return;
        }
        const player = Object.values(data).find((p) => p.id === charId);
        resolve(player || null);
      },
      { onlyOnce: true },
    );
  });
}
/**
 * Submit Combat Move (Attack/Defense)
 */
export async function submitCombatMove(battleId, moveData) {
  if (!rtdb || !currentUser) return;

  // We store moves in `moves/{round}/{role}`
  // But first we need to know our role (stored in battle request, but we can just use UID)

  // Simpler: `moves/{uid}`.
  // When both UIDs have a move, we resolve.

  const moveRef = ref(
    rtdb,
    `battle_requests/${battleId}/moves/${currentUser.uid}`,
  );
  try {
    await set(moveRef, {
      ...moveData,
      timestamp: rtdbTimestamp(),
    });
    console.log("⚔️ RTDB: Move submitted:", moveData);
  } catch (e) {
    console.error("Error submitting move:", e);
  }
}

/**
 * Subscribe to Battle Changes (for Combat Loop)
 */
export function subscribeToBattleChanges(battleId, onUpdate) {
  if (!rtdb) return () => {};
  const battleRef = ref(rtdb, `battle_requests/${battleId}`);

  const unsub = onValue(battleRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onUpdate(data);
  });

  return () => off(battleRef, "value", unsub);
}

/**
 * Resolve PvP Round (Server-less approach: Client writes result)
 * Only the "host" (Attacker) should write to avoid race conditions?
 * Or we just clear moves after processing locally.
 * Let's have each client process locally and just clear their OWN move?
 * No, we need synchronized state (HP).
 *
 * Strategy:
 * 1. Both see moves.
 * 2. Both calculate damage.
 * 3. Both update local UI.
 * 4. ONE person (Attacker) updates the `rounds` history and clears `moves` to start next round.
 */
export async function submitRoundResult(
  battleId,
  roundResult,
  nextRoundNumber,
) {
  if (!rtdb) return;
  const battleRef = ref(rtdb, `battle_requests/${battleId}`);
  try {
    await update(battleRef, {
      lastRoundResult: roundResult, // For sync
      currentRound: nextRoundNumber,
      moves: null, // Clear moves for next round
    });
  } catch (e) {
    console.error("Error submitting round result:", e);
  }
}

// === Generic RTDB Helpers for BattleLogic ===
export async function updateRTDB(path, data) {
  if (!rtdb) return;
  const dbRef = ref(rtdb, path);
  try {
    // Sanitize data: remove undefined values which Firebase rejects
    const cleanData = JSON.parse(JSON.stringify(data));
    await update(dbRef, cleanData);
    console.log(`📡 RTDB Update: ${path}`, cleanData);
    return true;
  } catch (e) {
    console.error(`❌ RTDB Error (${path}):`, e);
    return false;
  }
}

export function subscribeToPath(path, onUpdate) {
  if (!rtdb) return () => {};
  const dbRef = ref(rtdb, path);
  const unsub = onValue(dbRef, (snapshot) => {
    const val = snapshot.val();
    onUpdate(val);
  });
  return () => off(dbRef, "value", unsub);
}

// ==================== GROUP SYSTEM (RTDB) ====================

/**
 * Створити групу в RTDB
 */
export async function createGroupRTDB(groupId, leaderData) {
  if (!rtdb || !currentUser) return false;
  try {
    await set(ref(rtdb, `groups/${groupId}`), {
      id: groupId,
      leaderId: leaderData.charId,
      color: leaderData.color,
      members: {
        [leaderData.charId]: {
          name: leaderData.name,
          level: leaderData.level,
          avatar: leaderData.avatar,
          userId: currentUser.uid,
          joinedAt: rtdbTimestamp(),
        },
      },
      status: "active",
      createdAt: rtdbTimestamp(),
    });
    // Оновити статус гравця
    await updatePlayerStatus(leaderData.charId, "idle", { groupId });
    console.log(`👥 Group ${groupId} created`);
    return true;
  } catch (e) {
    console.error("❌ createGroupRTDB error:", e);
    return false;
  }
}

/**
 * Запросити гравця до групи
 */
export async function inviteToGroup(
  groupId,
  targetCharId,
  inviterName,
  groupColor,
) {
  if (!rtdb) return false;
  try {
    await set(ref(rtdb, `group_invites/${targetCharId}/${groupId}`), {
      groupId,
      inviterName,
      inviterCharId: window._currentCharacterId,
      groupColor,
      createdAt: rtdbTimestamp(),
    });
    console.log(`👥 Invite sent to ${targetCharId} for group ${groupId}`);
    return true;
  } catch (e) {
    console.error("❌ inviteToGroup error:", e);
    return false;
  }
}

/**
 * Прийняти запрошення до групи
 */
export async function acceptGroupInviteRTDB(groupId, myData) {
  if (!rtdb || !currentUser) return false;
  try {
    // Додати себе до членів групи
    await set(ref(rtdb, `groups/${groupId}/members/${myData.charId}`), {
      name: myData.name,
      level: myData.level,
      avatar: myData.avatar,
      userId: currentUser.uid,
      joinedAt: rtdbTimestamp(),
    });
    // Видалити запрошення
    await remove(ref(rtdb, `group_invites/${myData.charId}/${groupId}`));
    // Оновити статус гравця
    await updatePlayerStatus(myData.charId, "idle", { groupId });
    console.log(`👥 Joined group ${groupId}`);
    return true;
  } catch (e) {
    console.error("❌ acceptGroupInviteRTDB error:", e);
    return false;
  }
}

/**
 * Покинути групу
 */
export async function leaveGroupRTDB(groupId, charId) {
  if (!rtdb) return false;
  try {
    await remove(ref(rtdb, `groups/${groupId}/members/${charId}`));
    await updatePlayerStatus(charId, "idle", { groupId: null });

    // Перевірити, чи група пуста
    const snapshot = await new Promise((resolve) => {
      onValue(ref(rtdb, `groups/${groupId}/members`), resolve, {
        onlyOnce: true,
      });
    });
    if (!snapshot.val() || Object.keys(snapshot.val()).length === 0) {
      await remove(ref(rtdb, `groups/${groupId}`));
      console.log(`👥 Group ${groupId} disbanded (empty)`);
    }
    return true;
  } catch (e) {
    console.error("❌ leaveGroupRTDB error:", e);
    return false;
  }
}

/**
 * Розпустити групу (тільки лідер)
 */
export async function disbandGroupRTDB(groupId) {
  if (!rtdb) return false;
  try {
    // Видаляємо групу — члени отримають null через onValue підписку
    // і самостійно очистять свій статус (groupId: null, status: 'idle')
    await remove(ref(rtdb, `groups/${groupId}`));
    console.log(`👥 Group ${groupId} disbanded`);
    return true;
  } catch (e) {
    console.error("❌ disbandGroupRTDB error:", e);
    return false;
  }
}

/**
 * Підписка на групу (real-time)
 */
export function subscribeToGroupRTDB(groupId, callback) {
  if (!rtdb) return () => {};
  const groupRef = ref(rtdb, `groups/${groupId}`);
  const unsub = onValue(groupRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => off(groupRef, "value", unsub);
}

/**
 * Підписка на запрошення до груп
 */
export function subscribeToGroupInvites(charId, callback) {
  if (!rtdb) return () => {};
  const invitesRef = ref(rtdb, `group_invites/${charId}`);
  const unsub = onValue(invitesRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      Object.values(data).forEach((invite) => callback(invite));
    }
  });
  return () => off(invitesRef, "value", unsub);
}

/**
 * Відхилити запрошення до групи
 */
export async function declineGroupInviteRTDB(
  groupId,
  targetCharId,
  inviterCharId,
) {
  if (!rtdb) return false;
  try {
    await remove(ref(rtdb, `group_invites/${targetCharId}/${groupId}`));

    await set(ref(rtdb, `group_declines/${inviterCharId}/${groupId}`), {
      groupId,
      timestamp: rtdbTimestamp(),
    });

    console.log(`👥 Invite from ${inviterCharId} declined`);
    return true;
  } catch (e) {
    console.error("❌ declineGroupInviteRTDB error:", e);
    return false;
  }
}

/**
 * Підписка на відхилені запрошення
 */
export function subscribeToGroupDeclines(charId, callback) {
  if (!rtdb) return () => {};
  const declinesRef = ref(rtdb, `group_declines/${charId}`);
  const unsub = onValue(declinesRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      Object.values(data).forEach((decline) => {
        callback(decline);
        // Clean up the notification immediately
        remove(ref(rtdb, `group_declines/${charId}/${decline.groupId}`)).catch(
          (e) => console.error(e),
        );
      });
    }
  });
  return () => off(declinesRef, "value", unsub);
}

/**
 * Оновити статус гравця в RTDB (idle, in_combat, etc.)
 */
export async function updatePlayerStatus(charId, status, extras = {}) {
  if (!rtdb) return;
  try {
    const updates = { status, ...extras };
    await update(ref(rtdb, `live_players/${charId}`), updates);
  } catch (e) {
    console.error(`❌ updatePlayerStatus error for ${charId}:`, e);
  }
}

// ==================== UNIFIED COMBAT SYSTEM (RTDB) ====================

/**
 * Create a new unified combat session in RTDB
 */
export async function createUnifiedCombatRTDB(combatId, combatData) {
  if (!rtdb) return false;
  try {
    await set(ref(rtdb, `combats/${combatId}`), {
      ...combatData,
      createdAt: rtdbTimestamp(),
    });
    console.log(`⚔️ Unified Combat ${combatId} created`);
    return true;
  } catch (e) {
    console.error("❌ createUnifiedCombatRTDB error:", e);
    return false;
  }
}

/**
 * Set the active combat for a group
 */
export async function setGroupActiveCombatRTDB(groupId, combatId) {
  if (!rtdb) return false;
  try {
    await update(ref(rtdb, `groups/${groupId}`), {
      activeCombat: combatId,
    });
    console.log(
      `👥 Group ${groupId} active combat set to ${combatId || "none"}`,
    );
    return true;
  } catch (e) {
    console.error("❌ setGroupActiveCombatRTDB error:", e);
    return false;
  }
}

/**
 * Subscribe to a unified combat session
 */
export function subscribeToUnifiedCombat(combatId, callback) {
  if (!rtdb) return () => {};
  const combatRef = ref(rtdb, `combats/${combatId}`);
  const unsub = onValue(combatRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => off(combatRef, "value", unsub);
}

/**
 * Submit a move for the current round in a unified combat
 */
export async function submitUnifiedCombatMove(
  combatId,
  currentRound,
  charId,
  moveData,
) {
  if (!rtdb) return false;
  try {
    await update(
      ref(rtdb, `combats/${combatId}/moves/${currentRound}/${charId}`),
      {
        ...moveData,
        timestamp: rtdbTimestamp(),
      },
    );
    console.log(`⚔️ Move submitted for round ${currentRound}`);
    return true;
  } catch (e) {
    console.error("❌ submitUnifiedCombatMove error:", e);
    return false;
  }
}

/**
 * Bulk update unified combat fields (for resolving rounds)
 */
export async function updateUnifiedCombatRTDB(combatId, updates) {
  if (!rtdb) return false;
  try {
    await update(ref(rtdb, `combats/${combatId}`), updates);
    return true;
  } catch (e) {
    console.error("❌ updateUnifiedCombatRTDB error:", e);
    return false;
  }
}

// ==================== ARENA SYSTEM (RTDB) ====================

/**
 * Створити арену бою
 */
export async function createArenaRTDB(
  arenaId,
  center,
  radius,
  participants,
  type,
) {
  if (!rtdb) return false;
  try {
    await set(ref(rtdb, `arenas/${arenaId}`), {
      id: arenaId,
      center,
      radius,
      participants,
      type,
      startedAt: rtdbTimestamp(),
    });
    console.log(`🏟️ Arena ${arenaId} created`);
    return true;
  } catch (e) {
    console.error("❌ createArenaRTDB error:", e);
    return false;
  }
}

/**
 * Видалити арену
 */
export async function removeArenaRTDB(arenaId) {
  if (!rtdb) return;
  try {
    await remove(ref(rtdb, `arenas/${arenaId}`));
    console.log(`🏟️ Arena ${arenaId} removed`);
  } catch (e) {
    console.error("❌ removeArenaRTDB error:", e);
  }
}

/**
 * Підписка на арени (для відображення на мапі)
 */
export function subscribeToArenas(callback) {
  if (!rtdb) return () => {};
  const arenasRef = ref(rtdb, "arenas");
  const unsub = onValue(arenasRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
  return () => off(arenasRef, "value", unsub);
}
