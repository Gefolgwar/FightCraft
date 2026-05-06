import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  console.log('Starting Playwright test for templates_map.html...');
  const browser = await chromium.launch({
    executablePath: '/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  console.log('Navigating to http://localhost:5000/map/templates_map.html...');
  await page.goto('http://localhost:5000/map/templates_map.html');

  // Wait for the map or initial load
  await page.waitForTimeout(2000);

  console.log('Taking initial screenshot...');
  await page.screenshot({ path: 'docs/playwright-test-results/01-initial.png' });

  // Get the HTML content to find inputs
  const html = await page.content();
  fs.writeFileSync('docs/playwright-test-results/page.html', html);

  console.log('Test setup completed. HTML saved.');

  await browser.close();
})();
