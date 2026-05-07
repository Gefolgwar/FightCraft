const fs = require('fs');
const file = 'www/firebase/firebase-service.js';
let data = fs.readFileSync(file, 'utf8');

data = data.replace(/export async function applyWorldSnapshot\(snapshotId\) \{[\s\S]*?return success;\n\}/, `export async function applyWorldSnapshot(snapshotId) {
  if (!isAdmin()) return false;

  const snap = await getSnapshotById(snapshotId);
  if (!snap) return false;

  const { cityId, type } = snap;
  if (!cityId || !type) return false;

  console.log(\`➕ Activating template: \${snapshotId}\`);

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
}`);

// Also remove isAdmin check from getWorldSnapshots
data = data.replace(/export async function getWorldSnapshots\(\) \{\n  if \(\!isAdmin\(\)\) return \[\];\n/, 'export async function getWorldSnapshots() {\n');

fs.writeFileSync(file, data);
console.log("Patched firebase-service.js");
