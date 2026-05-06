const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const resultsDir = path.join(process.cwd(), 'docs', 'playwright-test-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Listen to console logs
  page.on('console', msg => {
    console.log(`[Browser Console]: ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`[Browser Error]: ${err.message}`);
  });

  try {
      console.log("Navigating to login page...");
      await page.goto('http://localhost:5000/auth-ui/login.html', { waitUntil: 'domcontentloaded' });

      console.log("Attempting to login...");
      await page.fill('#login-email', 'playwright_test@example.com');
      await page.fill('#login-password', 'password123');
      await page.click('#login-form button[type="submit"]');

      await page.waitForTimeout(3000);

      const errorMsg = await page.locator('#login-error').innerText().catch(() => '');
      if (errorMsg || page.url().includes('login.html')) {
          console.log("Login failed or didn't redirect. Trying to register...");
          await page.evaluate(() => {
              if (window.showRegisterForm) window.showRegisterForm();
          });
          await page.waitForTimeout(1000);
          await page.fill('#register-name', 'Playwright Test');
          await page.fill('#register-email', 'playwright_test@example.com');
          await page.fill('#register-password', 'password123');
          await page.fill('#register-confirm', 'password123');
          await page.click('#register-form button[type="submit"]');
          await page.waitForTimeout(4000);
      }

      console.log("Navigating to templates map page...");
      await page.goto('http://localhost:5000/map/templates_map.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000); // Wait for scripts to initialize
      await page.screenshot({ path: path.join(resultsDir, '1_initial_load.png') });
      console.log("Screenshot: 1_initial_load.png");

      // Inject a dummy snapshot if none exist
      console.log("Injecting a dummy snapshot to ensure we have something to test...");
      await page.evaluate(async () => {
          // This creates a minimal snapshot with citadels so we can generate zones
          const dummyCitadels = {
            "type": "FeatureCollection",
            "features": [
              {
                "type": "Feature",
                "geometry": {
                  "type": "Point",
                  "coordinates": [13.404954, 52.520008] // Berlin
                },
                "properties": {
                  "name": "Test Citadel 1",
                  "power": 100
                }
              },
              {
                "type": "Feature",
                "geometry": {
                  "type": "Point",
                  "coordinates": [13.414954, 52.530008]
                },
                "properties": {
                  "name": "Test Citadel 2",
                  "power": 100
                }
              }
            ]
          };

          const dummySnapshot = {
              id: `snap_playwright_${Date.now()}`,
              name: "Playwright Test Snapshot",
              cityId: "berlin",
              created: Date.now(),
              citadels: JSON.stringify(dummyCitadels)
          };

          if (window.firebaseService && window.firebaseService.saveWorldSnapshot) {
              await window.firebaseService.saveWorldSnapshot(dummySnapshot);
          } else {
              // Try to invoke it directly if it's imported in the module scope
              // We'll dispatch a custom event to tell the page to save it
              window.__testSnapshot = dummySnapshot;
              console.log("Set window.__testSnapshot. Need to save it manually if possible.");
          }
      });
      await page.waitForTimeout(2000); // Wait for snapshot to load or save

      // Let's actually expose a global function in templates_map.html to make testing easier,
      // or we can just run the test since we're using Playwright.
      // Since it's a module, we can't easily access its internals without a hook.
      // But we can just use the DOM!

      console.log("Clicking first snapshot...");
      const snapshotSelector = '#snapshot-list > div[id^="snap-"]';
      await page.waitForSelector(snapshotSelector, { timeout: 10000 }).catch(() => console.log("No snapshots found within 10s."));

      const snapshotCount = await page.locator(snapshotSelector).count();
      if (snapshotCount === 0) {
          console.log("Still no snapshots found. We need a way to create one.");
          // We can use the browser context to directly call the Firebase API via the page.
          await page.evaluate(async () => {
             const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
             const db = window.firebaseDb || window.db; // Need to find db reference
             if (db) {
                 await setDoc(doc(db, "world_snapshots", "playwright_test"), window.__testSnapshot);
                 console.log("Saved test snapshot via Firestore SDK directly.");
             } else {
                 console.log("Could not find db reference.");
             }
          });
          await page.waitForTimeout(3000);
      }

      // Try clicking again
      const newSnapshotCount = await page.locator(snapshotSelector).count();
      if (newSnapshotCount > 0) {
          await page.click(snapshotSelector, { timeout: 5000 });
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(resultsDir, '3_snapshot_selected.png') });
          console.log("Screenshot: 3_snapshot_selected.png");

          console.log("Clicking Generate Zones button...");
          await page.evaluate(() => {
              if (window.generateSnapshotZones) {
                  window.generateSnapshotZones();
              } else {
                  console.log("generateSnapshotZones is undefined");
              }
          });

          // Wait for generation to finish
          await page.waitForTimeout(10000);
          await page.screenshot({ path: path.join(resultsDir, '4_zones_generated_and_saved.png') });
          console.log("Screenshot: 4_zones_generated_and_saved.png");
      } else {
          console.log("Could not create or find a snapshot to test generating zones.");
      }
  } catch (e) {
      console.log("Error interacting:", e.message);
      await page.screenshot({ path: path.join(resultsDir, 'error.png') });
  }

  await browser.close();
})();
