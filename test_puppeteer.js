const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('[PAGE LOG]', msg.text()));
    page.on('pageerror', err => console.log('[PAGE ERROR]', err.toString()));
    
    await page.goto('http://localhost:5000/map/templates_map.html', { waitUntil: 'networkidle2' });
    
    console.log("Clicking button...");
    await page.evaluate(() => {
        const btn = document.getElementById('btn-preview-global');
        if(btn) btn.click();
    });
    
    console.log("Waiting up to 45 seconds for generation to complete...");
    let timeWaited = 0;
    while(timeWaited < 45000) {
        await new Promise(r => setTimeout(r, 2000));
        timeWaited += 2000;
        const status = await page.evaluate(() => document.getElementById('preview-status')?.textContent);
        if (status && (status.includes('complete') || status.includes('Error'))) {
            console.log("Final status reached:", status);
            break;
        }
    }
    
    const finalStatus = await page.evaluate(() => document.getElementById('preview-status')?.textContent);
    console.log("Status at end:", finalStatus);
    
    await browser.close();
})();
