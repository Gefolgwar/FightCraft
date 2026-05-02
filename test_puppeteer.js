const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    await page.goto('http://localhost:5000/map/templates_map.html', { waitUntil: 'networkidle0' });
    
    console.log("Page loaded!");
    
    // Click the Global Preview button
    await page.evaluate(() => {
        const btn = document.getElementById('btn-preview-global');
        if (btn) {
            console.log("Clicking preview button...");
            btn.click();
        } else {
            console.log("Preview button not found!");
        }
    });
    
    // Wait for a few seconds for the map to render
    await new Promise(r => setTimeout(r, 6000));
    
    const stats = await page.evaluate(() => {
        const paths = document.querySelectorAll('path.leaflet-interactive');
        return {
            pathCount: paths.length,
            statusText: document.getElementById('preview-status') ? document.getElementById('preview-status').textContent : 'N/A'
        };
    });
    
    console.log(JSON.stringify(stats, null, 2));
    
    await browser.close();
})();
