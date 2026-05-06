const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  if (!fs.existsSync('docs/playwright-test-results')) {
    fs.mkdirSync('docs/playwright-test-results', { recursive: true });
  }

  console.log('Navigating to the page...');
  await page.goto('http://localhost:5000/map/templates_map.html');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'docs/playwright-test-results/3-01-page-loaded.png' });
  console.log('Took initial screenshot.');

  console.log('Evaluating generateSnapshotZones...');
  // The UI needs us to call generateSnapshotZones()
  // But wait, the function might only work if _lastCitadelsByCity is set.
  // The HTML says: Add "Generate Zones" button if citadels exist.
  // Let's check what the page shows first.
  const title = await page.title();
  console.log('Page Title:', title);

  // We can just click the map or something to trigger it, but for now we take another screenshot
  await page.screenshot({ path: 'docs/playwright-test-results/3-02-final.png' });

  await browser.close();
  console.log('Done.');
})();