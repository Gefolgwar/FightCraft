const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Create a Chrome DevTools Protocol session
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');

  console.log('Navigating to procedural-demo.html...');
  page.on('console', msg => {
    if (msg.text().includes('Viewport:')) {
      console.log(`[PAGE LOG] ${msg.text()}`);
    }
  });

  await page.goto('http://localhost:5000/maintenance/procedural-demo.html', { waitUntil: 'networkidle' });

  // Wait for the "Generating citadels..." or initial render to finish
  await page.waitForTimeout(3000);

  console.log('Zooming in to level 15 (Berlin)...');
  await page.evaluate(() => {
    window._map.setView([52.52, 13.405], 15);
  });
  await page.waitForTimeout(2000);

  console.log('Starting monitoring...');
  const metricsData = [];

  for (let i = 0; i < 20; i++) {
    // Pan the map to force re-renders
    console.log(`\nIteration ${i + 1}...`);

    // Pan the map reliably
    await page.evaluate((iteration) => {
      window._map.panBy([iteration % 2 === 0 ? 100 : -100, iteration % 2 === 0 ? 100 : -100]);
    }, i);

    // Wait a bit for map to render
    await page.waitForTimeout(1000);

    // Get Performance metrics
    const perfMetrics = await client.send('Performance.getMetrics');

    const metrics = {};
    perfMetrics.metrics.forEach(m => {
      if (['JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration'].includes(m.name)) {
        metrics[m.name] = m.value;
      }
    });

    const domNodeCount = await page.evaluate(() => document.getElementsByTagName('*').length);
    metrics['DOMNodes'] = domNodeCount;

    console.log(`JSHeapUsedSize: ${(metrics['JSHeapUsedSize'] / 1024 / 1024).toFixed(2)} MB`);
    console.log(`DOM Nodes: ${metrics['DOMNodes']}`);
    console.log(`JS Event Listeners (CDP): ${metrics['JSEventListeners']}`);
    console.log(`LayoutCount: ${metrics['LayoutCount']}`);
    console.log(`RecalcStyleCount: ${metrics['RecalcStyleCount']}`);

    metricsData.push({
      iteration: i + 1,
      ...metrics
    });
  }

  // Save results
  fs.writeFileSync('docs/reports/perf-metrics.json', JSON.stringify(metricsData, null, 2));
  console.log('Metrics saved to docs/reports/perf-metrics.json');

  await browser.close();
})();
