import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.join(__dirname, '..', '.playwright-profile');

const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = browser.pages()[0] || await browser.newPage();

console.log('Navigating to http://localhost:5000...');
await page.goto('http://localhost:5000', { waitUntil: 'networkidle', timeout: 30000 });
console.log('URL:', page.url());

if (page.url().includes('login')) {
  console.log('\n  First run — log in manually. Session will be saved for next time.\n');
}

console.log('Browser is open. Close the window or press Ctrl+C to exit.');
await page.waitForTimeout(600000);
await browser.close();
