const admin = require('firebase-admin');
const serviceAccount = require('../../.claude/firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  try {
    const snapshotRef = db.collection('world_snapshots');
    const snapshotDocs = await snapshotRef.get();
    
    let deletedCount = 0;
    for (const doc of snapshotDocs.docs) {
      const data = doc.data();
      if (data.name && data.name.includes('(with Zones)')) {
        console.log(`Deleting: ${doc.id} - ${data.name}`);
        await doc.ref.delete();
        deletedCount++;
      }
    }
    console.log(`Successfully deleted ${deletedCount} faulty templates.`);
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
