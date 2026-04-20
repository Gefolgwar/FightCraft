// CLEANUP OLD TEST PLAYERS DUPLICATES
// Paste this in console (F12) to remove old duplicate test players

(async function cleanupDuplicates() {
    console.log('🧹 Starting cleanup of duplicate test players...');

    const { getDb, getCurrentUser } = await import('./js/firebase-service.js');
    const { collection, getDocs, deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getDb();
    const currentUser = getCurrentUser();

    if (!currentUser) return console.error('❌ Not logged in');

    const charRef = collection(db, 'users', currentUser.uid, 'characters');
    const snapshot = await getDocs(charRef);

    // Group characters by name
    const byName = {};
    snapshot.forEach(doc => {
        const name = doc.data().player?.name || 'Unknown';
        if (!byName[name]) byName[name] = [];
        byName[name].push({ id: doc.id, ref: doc.ref, data: doc.data() });
    });

    let deleted = 0;

    // For each name, keep newest, delete rest
    for (const [name, chars] of Object.entries(byName)) {
        if (chars.length > 1) {
            console.log(`Found ${chars.length} copies of "${name}"`);

            // Sort by createdAt (newest first)
            chars.sort((a, b) => {
                const aTime = a.data.createdAt?.toMillis() || 0;
                const bTime = b.data.createdAt?.toMillis() || 0;
                return bTime - aTime;
            });

            // Delete all except first (newest)
            for (let i = 1; i < chars.length; i++) {
                console.log(`  🗑️ Deleting old copy: ${chars[i].id}`);
                await deleteDoc(chars[i].ref);
                deleted++;
            }
        }
    }

    console.log(`✅ Cleanup complete. Deleted ${deleted} duplicates.`);
    if (deleted > 0) {
        setTimeout(() => location.reload(), 1000);
    }
})();
