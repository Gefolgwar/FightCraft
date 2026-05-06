// GLOBAL CLEANUP - Scan root 'users' collection
// Paste into console

(async function globalCleanup() {
    console.log('🌍 Starting GLOBAL cleanup of root users collection...');

    const { getDb } = await import('./js/firebase-service.js');
    const { collection, getDocs, deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getDb();
    if (!db) return console.error('DB not ready');

    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);

    console.log(`📋 Found ${snapshot.size} docs in 'users' collection`);

    let deletedCount = 0;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const name = data.player?.name || data.name || 'Unknown';
        const id = docSnap.id;

        // Check if it looks like a test player
        if (name.includes('TestPlayer')) {
            console.log(`❌ FOUND GHOST in root collection: ${name} (${id})`);

            try {
                await deleteDoc(doc(db, 'users', id));
                console.log(`✅ Deleted ${name}`);
                deletedCount++;
            } catch (e) {
                console.error(`Failed to delete ${name}:`, e);
            }
        }
    }

    console.log(`🎉 Global cleanup complete. Deleted ${deletedCount} ghosts.`);
    if (deletedCount > 0) {
        setTimeout(() => location.reload(), 1000);
    }
})();
