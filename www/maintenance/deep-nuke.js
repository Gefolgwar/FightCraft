// DEEP NUKE - Scan ALL 'characters' collections across the entire DB
// Paste into console

(async function deepNuke() {
    console.log('☢️ STARTING DEEP SCAN (Collection Group)...');

    // Import collectionGroup
    const { getDb } = await import('./js/firebase-service.js');
    const { collectionGroup, getDocs, deleteDoc, query } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getDb();
    if (!db) return console.error('DB not ready');

    // Scan ALL "characters" collections in the entire database
    const charsQuery = query(collectionGroup(db, 'characters'));
    const snapshot = await getDocs(charsQuery);

    console.log(`📋 Found ${snapshot.size} total characters in DB`);

    let count = 0;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const name = data.player?.name || data.name || 'Unknown';
        const id = docSnap.id;
        const parentId = docSnap.ref.parent.parent?.id || 'unknown_parent'; // User ID

        console.log(`🔍 Checking: ${name} (ID: ${id}, Owner: ${parentId})`);

        // CHECK IF TARGET
        if (name.includes('TestPlayer')) {
            console.log(`🎯 TARGET LOCKED: ${name} (ID: ${id}, Owner: ${parentId})`);

            try {
                await deleteDoc(docSnap.ref); // Delete using document reference
                console.log(`💥 DESTROYED ${name}`);
                count++;
            } catch (e) {
                console.error(`❌ FAILED to delete ${name}:`, e);
                console.warn('⚠️ You might not have permission to delete other users data!');

                // Fallback: If we can't delete from DB, we can at least try to corrupt it or hide it
                // (Though with Firestore security rules, likely blocked)
            }
        }
    }

    console.log(`🏁 Deep Scan Complete. Nuked ${count} targets.`);
    if (count > 0) {
        setTimeout(() => location.reload(), 2000);
    }
})();
