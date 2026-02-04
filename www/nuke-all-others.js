// NUKE ALL OTHERS - Delete EVERYONE except YOU
// Paste into console

(async function nukeAllOthers() {
    console.log('☢️ STARTING TOTAL PURGE (Except YOU)...');

    const { getDb, getCurrentUser } = await import('./js/firebase-service.js');
    const { collection, getDocs, deleteDoc, doc, query, collectionGroup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const db = getDb();
    const currentUser = getCurrentUser();

    if (!db || !currentUser) return console.error('DB not ready or User not logged in');

    const myId = currentUser.uid;
    console.log(`👤 You are: ${myId}`);

    let deletedCount = 0;

    // 1. SCAN ROOT 'users' COLLECTION
    console.log('📂 Scanning root users...');
    const usersSnapshot = await getDocs(collection(db, 'users'));

    for (const docSnap of usersSnapshot.docs) {
        // SKIP YOURSELF
        if (docSnap.id === myId) {
            console.log(`🛡️ Skipping YOU (ID: ${docSnap.id})`);
            continue;
        }

        const data = docSnap.data();
        const name = data.player?.name || data.name || docSnap.id;

        // Skip based on name if needed (Geopardyonok) just in case ID mismatches
        if (name === 'Geopardyonok') {
            console.log(`🛡️ Skipping Geopardyonok by name`);
            continue;
        }

        console.log(`🔫 Nuking User: ${name} (${docSnap.id})`);
        try {
            await deleteDoc(docSnap.ref);
            console.log(`✅ Deleted user ${name}`);
            deletedCount++;
        } catch (e) {
            console.warn(`❌ Failed to delete ${name}:`, e);
        }
    }

    // 2. SCAN ALL 'characters' (Deep Scan)
    console.log('📂 Scanning all character subcollections...');
    const charSnapshot = await getDocs(query(collectionGroup(db, 'characters')));

    for (const docSnap of charSnapshot.docs) {
        const parentId = docSnap.ref.parent.parent?.id;
        const data = docSnap.data();

        // SKIP IF BELONGS TO YOU
        if (parentId === myId) {
            console.log(`🛡️ Skipping your character: ${data.player?.name}`);
            continue;
        }

        const name = data.player?.name || 'Unknown';
        console.log(`🔫 Nuking Character: ${name} (Owner: ${parentId})`);

        try {
            await deleteDoc(docSnap.ref);
            console.log(`✅ Deleted char ${name}`);
            deletedCount++;
        } catch (e) {
            console.warn(`❌ Failed to delete ${name}:`, e);
        }
    }

    console.log(`🏁 Total Purge Complete. Deleted ${deletedCount} entities.`);
    if (deletedCount > 0) {
        setTimeout(() => location.reload(), 2000);
    }
})();
