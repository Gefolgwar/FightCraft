import { chromium } from 'playwright';

(async () => {
  console.log('Launching browser in headful mode...');
  // Launch in headful mode
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const url = 'http://localhost:5000/map/templates_map.html';
    console.log(`Navigating to ${url}...`);
    // Changed to 'load' because 'networkidle' might hang due to websockets/firebase
    await page.goto(url, { waitUntil: 'load' });
    
    // Give it an extra moment to settle any client-side rendering
    await page.waitForTimeout(2000);

    console.log('Checking for "Generate Zones" button or calling generateSnapshotZones()...');
    
    const btn = page.locator('button', { hasText: /Generate/i });
    if (await btn.count() > 0) {
      console.log('Found "Generate" button, clicking...');
      await btn.first().click();
    } else {
      console.log('Button not found. Trying to evaluate window.generateSnapshotZones()...');
      await page.evaluate(() => {
        if (typeof window.generateSnapshotZones === 'function') {
          window.generateSnapshotZones();
        } else {
          console.log('window.generateSnapshotZones is not a function on this page.');
        }
      });
    }

    console.log('Waiting 5 seconds for generation and rendering to settle...');
    await page.waitForTimeout(5000);

    const screenshotPath = 'docs/playwright-test-results/visual-test.png';
    console.log(`Taking screenshot at ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('Test completed successfully.');
  } catch (error) {
    console.error('An error occurred during the test:', error);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
})();
