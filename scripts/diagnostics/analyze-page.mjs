import { chromium } from 'playwright';
import fs from 'fs';

const ANALYSIS_DIR = '/mnt/d/Project/FightCraft/.analysis';
fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

console.log('Navigating to http://localhost:5000...');
await page.goto('http://localhost:5000', { waitUntil: 'networkidle', timeout: 30000 });
console.log('Page loaded:', await page.title());

// Wait for any redirects / SPA init
await page.waitForTimeout(3000);
console.log('Current URL:', page.url());

// Screenshot after initial load
await page.screenshot({ path: `${ANALYSIS_DIR}/01-initial.png`, fullPage: true });
console.log('Screenshot: 01-initial.png');

// Accessibility tree
try {
  const snapshot = await page.locator('body').ariaSnapshot();
  fs.writeFileSync(`${ANALYSIS_DIR}/accessibility.txt`, snapshot);
  console.log('Accessibility snapshot saved');
} catch (e) {
  console.log('Accessibility snapshot skipped:', e.message);
}

// Full HTML
const html = await page.content();
fs.writeFileSync(`${ANALYSIS_DIR}/page-content.html`, html);
console.log('HTML content saved');

// Console messages
const consoleMessages = [];
page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));

// Network requests
const requests = [];
page.on('request', req => requests.push({ method: req.method(), url: req.url(), type: req.resourceType() }));

// Visible text content
const visibleText = await page.evaluate(() => document.body?.innerText || '');
fs.writeFileSync(`${ANALYSIS_DIR}/visible-text.txt`, visibleText);
console.log('Visible text saved');

// All links
const links = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim(), href: a.href }))
);
fs.writeFileSync(`${ANALYSIS_DIR}/links.json`, JSON.stringify(links, null, 2));

// All buttons
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].map(b => ({
    text: b.textContent?.trim() || b.value || '',
    id: b.id,
    class: b.className?.substring?.(0, 80) || '',
    visible: b.offsetParent !== null
  }))
);
fs.writeFileSync(`${ANALYSIS_DIR}/buttons.json`, JSON.stringify(buttons, null, 2));

// All forms and inputs
const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('input, select, textarea')].map(i => ({
    tag: i.tagName, type: i.type, id: i.id, name: i.name, placeholder: i.placeholder,
    visible: i.offsetParent !== null
  }))
);
fs.writeFileSync(`${ANALYSIS_DIR}/inputs.json`, JSON.stringify(inputs, null, 2));

// CSS/JS resources loaded
const resources = await page.evaluate(() => ({
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.src),
  styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href),
  modules: [...document.querySelectorAll('script[type="module"]')].map(s => s.src || '(inline)')
}));
fs.writeFileSync(`${ANALYSIS_DIR}/resources.json`, JSON.stringify(resources, null, 2));

// Z-index layers
const zLayers = await page.evaluate(() => {
  const els = document.querySelectorAll('*');
  const layers = [];
  for (const el of els) {
    const z = getComputedStyle(el).zIndex;
    if (z !== 'auto' && parseInt(z) > 0) {
      layers.push({ tag: el.tagName, id: el.id, class: el.className?.substring?.(0, 60) || '', zIndex: z, visible: el.offsetParent !== null });
    }
  }
  return layers.sort((a, b) => parseInt(b.zIndex) - parseInt(a.zIndex));
});
fs.writeFileSync(`${ANALYSIS_DIR}/z-layers.json`, JSON.stringify(zLayers, null, 2));

// Meta tags
const meta = await page.evaluate(() =>
  [...document.querySelectorAll('meta')].map(m => ({ name: m.name, content: m.content, property: m.getAttribute('property') }))
);
fs.writeFileSync(`${ANALYSIS_DIR}/meta.json`, JSON.stringify(meta, null, 2));

console.log('\n=== All analysis data collected ===');
console.log('Keeping browser open for 60 seconds...');

// Take a few more screenshots over time to capture any animations/transitions
for (let i = 1; i <= 3; i++) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${ANALYSIS_DIR}/02-after-${i * 5}s.png`, fullPage: true });
  console.log(`Screenshot: 02-after-${i * 5}s.png`);
}

// Save console and network at the end
fs.writeFileSync(`${ANALYSIS_DIR}/console-log.json`, JSON.stringify(consoleMessages, null, 2));
fs.writeFileSync(`${ANALYSIS_DIR}/network.json`, JSON.stringify(requests, null, 2));
console.log('Console log and network requests saved');

// Keep browser open for remaining time
await page.waitForTimeout(45000);

console.log('Closing browser...');
await browser.close();
console.log('Done.');
