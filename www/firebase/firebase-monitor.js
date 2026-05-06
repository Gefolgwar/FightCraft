import {
    getDoc,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Key used for storing the total read count in LocalStorage.
 * This allows db-usage.html to read the value across tabs/pages.
 */
const STORAGE_KEY_READS = 'total_firestore_reads';

/**
 * Helper to safely increment the global counter.
 * @param {number} count - Number of reads to add
 * @param {string} source - Label for logging (optional)
 */
function incrementReadCount(count, source = 'unknown') {
    if (count <= 0) return;

    // 1. Get current
    let current = parseInt(localStorage.getItem(STORAGE_KEY_READS) || '0', 10);

    // 2. Increment
    current += count;

    // 3. Save
    localStorage.setItem(STORAGE_KEY_READS, current.toString());

    // 4. Store detailed log entry
    const logEntry = {
        timestamp: Date.now(),
        type: 'READ',
        path: source,
        size: count,
        data: '',
        description: source
    };

    // Get existing logs (limit to last 500 entries to avoid localStorage overflow)
    const LOGS_KEY = 'firestore_detailed_logs';
    let logs = [];
    try {
        const stored = localStorage.getItem(LOGS_KEY);
        if (stored) {
            logs = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('Failed to parse logs, resetting:', e);
        logs = [];
    }

    // Add new entry
    logs.push(logEntry);

    // Keep only last 500 entries
    if (logs.length > 500) {
        logs = logs.slice(-500);
    }

    // Save back
    try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
        console.warn('Failed to save log entry:', e);
        // If quota exceeded, clear old entries and try again
        logs = logs.slice(-100);
        try {
            localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
        } catch (e2) {
            console.error('Critical: Cannot save logs even after cleanup');
        }
    }

    // Optional: Log to console for verifying dev-side
    // console.debug(`[Firestore Monitor] +${count} reads from [${source}]. Total: ${current}`);
}

/**
 * WRAPPER: getDoc
 * Counts 1 read if the document exists or if the check is performed.
 * (Even checking existence costs 1 read in many cases, but here we count calls that return)
 */
export async function monitoredGetDoc(docRef, sourceLabel = 'getDoc') {
    const snap = await getDoc(docRef);
    // In Firestore, a get() calls costs 1 read even if doc doesn't exist (it reads the index/absence)
    incrementReadCount(1, sourceLabel);
    return snap;
}

/**
 * WRAPPER: getDocs (QuerySnapshot)
 * Counts N reads where N = number of docs returned.
 * If 0 docs, it still costs 1 read for the query execution (minimum 1 per query).
 */
export async function monitoredGetDocs(queryRef, sourceLabel = 'getDocs') {
    const snap = await getDocs(queryRef);

    // Minimum 1 read for the query itself if empty, otherwise size
    const cost = snap.empty ? 1 : snap.size;

    incrementReadCount(cost, sourceLabel);
    return snap;
}

/**
 * WRAPPER: onSnapshot
 * This is the critical one.
 * 1. Initial Load: Counts `snap.size` (or 1 if empty query cost).
 * 2. Updates: Counts `snap.docChanges().length`.
 */
export function monitoredOnSnapshot(queryOrRef, onNext, onError, sourceLabel = 'onSnapshot') {
    let isFirstEmit = true;

    return onSnapshot(queryOrRef, (snap) => {
        let cost = 0;

        if (isFirstEmit) {
            // First time: Cost is usually the size of the result set
            // If empty, it's 1 read for the query
            cost = snap.empty ? 1 : snap.size;
            isFirstEmit = false;
        } else {
            // Subsequent updates: Cost is only the CHANGED/ADDED docs
            // docChanges() includes 'added', 'modified', 'removed'
            // In Firestore, we pay for reads of documents that are added or modified.
            // 'removed' notifications don't strictly cost a "document read" in the same way, 
            // but usually implies we read the state to know it's gone? 
            // Actually, official docs say: "You are charged for a read for each document returned by the query."
            // For updates: "listening to query results -> charged for each change"

            // We'll count all changes as reads to be safe/conservative, or strictly 'added'/'modified'.
            // Let's rely on docChanges().length as a fair proxy.
            const changes = snap.docChanges();
            cost = changes.length;
        }

        if (cost > 0) {
            incrementReadCount(cost, `${sourceLabel} (update)`);
        }

        // Forward to original callback
        onNext(snap);

    }, (err) => {
        if (onError) onError(err);
    });
}
