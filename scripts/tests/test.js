const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const resultsDir = path.join(process.cwd(), 'docs', 'playwright-test-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  try {
    console.log('Navigating to http://localhost:5000/map/templates_map.html...');
    await page.goto('http://localhost:5000/map/templates_map.html');
    await page.screenshot({ path: path.join(resultsDir, '1-initial.png') });

    // Assuming we need to fill out a form or something. Let's wait for elements.
    console.log('Waiting for template form...');
    // We don't know the exact DOM elements without looking at the page. Let's get the HTML.
    const html = await page.content();
    fs.writeFileSync('/tmp/page.html', html);

    await browser.close();
    console.log('Done for now, please inspect /tmp/page.html to write the rest of the test.');
  } catch (e) {
    console.error(e);
    await browser.close();
  }
})();
