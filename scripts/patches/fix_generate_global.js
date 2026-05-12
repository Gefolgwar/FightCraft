const fs = require('fs');
const path = require('path');

const adminWorldPath = path.join(__dirname, '../../www/maintenance/admin-world.js');
let content = fs.readFileSync(adminWorldPath, 'utf8');

if (!content.includes('import { WORLD_CITIES }')) {
    content = content.replace('import { CITY_ANCHORS } from "../gameplay/data.js";', 'import { CITY_ANCHORS } from "../gameplay/data.js";\nimport { WORLD_CITIES } from "../gameplay/world_cities.js";');
}

const generateGlobalStart = content.indexOf('window.generateGlobalWorld = async () => {');
if (generateGlobalStart !== -1) {
    const newGenerateGlobal = `window.generateGlobalWorld = async () => {
  const globalSeed = Math.floor(Math.random() * 2147483647);
  const rng = new SeededRandom(globalSeed);

  const totalCities = WORLD_CITIES.length;

  const container = document.getElementById("world-progress-container");
  const text = document.getElementById("world-progress-text");
  const bar = document.getElementById("world-progress-bar");
  const status = document.getElementById("world-progress-status");

  if (!container || !text || !bar || !status) return;

  container.classList.remove("hidden");

  try {
    status.textContent = "Generating 10,000+ citadels globally...";
    bar.style.width = "5%";
    await delay(100);

    let allGeneratedCitadels = [];

    for (let i = 0; i < totalCities; i++) {
      const city = WORLD_CITIES[i];
      const population = city.population || 100000;
      // Citadel formula: pop / 100,000 (min 1) to get ~10,000+ total globally
      const citadelCount = Math.max(1, Math.round(population / 100000));

      for (let j = 0; j < citadelCount; j++) {
        // Random spread ~5km
        const latOffset = (rng.next() - 0.5) * 0.1;
        const lngOffset = (rng.next() - 0.5) * 0.1;

        allGeneratedCitadels.push({
          id: \`citadel_\${city.id}_\${j}\`,
          name: \`Citadel \${city.name} \${j + 1}\`,
          cityId: city.id || "GLOBAL",
          lat: city.lat + latOffset,
          lng: city.lng + lngOffset,
          icon: "🏯",
          templateId: "citadel",
          level: 15,
          hp: 3000,
          maxHp: 3000,
          generatedAt: Date.now()
        });
      }

      // Update UI every 500 cities to not freeze the browser
      if (i % 500 === 0 || i === totalCities - 1) {
        text.textContent = \`\${i + 1} / \${totalCities} Cities\`;
        bar.style.width = \`\${5 + ((i + 1) / totalCities) * 90}%\`;
        status.textContent = \`Generated \${allGeneratedCitadels.length} citadels so far...\`;
        await delay(10); // yield to event loop
      }
    }

    status.textContent = \`Saving \${allGeneratedCitadels.length} citadels to Local IndexedDB...\`;
    await delay(100);
    
    const localData = {
      id: "local_" + Date.now(),
      name: "Global Map Run " + new Date().toLocaleTimeString(),
      created: Date.now(),
      cityId: "GLOBAL",
      type: "mixed",
      objects: allGeneratedCitadels
    };

    if (window.LocalSnapshotsManager) {
      await window.LocalSnapshotsManager.saveSnapshot(localData);
      if (window.loadSnapshots) {
        await window.loadSnapshots();
      } else {
        // force reload of the page if function not exposed
        window.location.reload();
      }
    } else {
      console.error("LocalSnapshotsManager not found on window");
      alert("LocalSnapshotsManager not found! Generation completed but not saved.");
    }

    console.log(\`📊 Global World Generation Complete: \${allGeneratedCitadels.length} citadels generated.\`);

    bar.style.width = \`100%\`;
    status.textContent = \`✅ GLOBAL TEMPLATES CREATED SUCCESSFULLY!\`;
    status.classList.remove("text-gray-500", "text-gray-400");
    status.classList.add("text-green-400");

    setTimeout(() => {
      container.classList.add("hidden");
      status.classList.remove("text-green-400");
      status.classList.add("text-gray-500");
      status.textContent = \`Initializing...\`;
      bar.style.width = \`0%\`;
      text.textContent = \`\`;
    }, 5000);
  } catch (error) {
    console.error("World Generation Error:", error);
    status.textContent = \`❌ Error: \${error.message}\`;
    status.classList.remove("text-gray-400");
    status.classList.add("text-red-500");
  }
};
`;

    content = content.substring(0, generateGlobalStart) + newGenerateGlobal;
    fs.writeFileSync(adminWorldPath, content);
    console.log("Successfully patched admin-world.js");
} else {
    console.log("Could not find generateGlobalWorld in admin-world.js");
}
