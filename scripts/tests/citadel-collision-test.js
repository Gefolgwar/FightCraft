const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Listen to console logs
  page.on('console', msg => console.log(`[Browser Console]: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[Browser Error]: ${err.message}`));

  // Handle dialogs (alerts/prompts)
  page.on('dialog', async dialog => {
    console.log(`[Dialog]: ${dialog.message()}`);
    if (dialog.type() === 'prompt') {
      await dialog.accept("Test Citadel 2");
    } else {
      await dialog.accept();
    }
  });

  try {
    console.log("Navigating to login page...");
    await page.goto('http://localhost:5000/auth-ui/login.html', { waitUntil: 'networkidle' });

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
        await page.waitForTimeout(3000);
    }

    console.log("Navigating to citadel admin panel...");
    await page.goto('http://localhost:5000/gameplay/gameplay_citadels.html', { waitUntil: 'domcontentloaded' });

    console.log("Waiting for templates to load...");
    await page.waitForTimeout(3000);

    // Let's create a snapshot or select one.
    // If there is no snapshot, we can't save. Let's create one by calling the DB directly or clicking a UI element.
    // Wait, the test can just mock the configManager.snapshotId = "test-snap" inside the page context.
    await page.evaluate(() => {
        window.configManager.snapshotId = "test-snap";
    });

    console.log("Creating default templates via magic wand...");
    await page.evaluate(async () => {
        if (window.createDefaultCitadelTemplates) {
            await window.createDefaultCitadelTemplates();
        }
    });
    await page.waitForTimeout(2000);

    console.log("Injecting a second template via UI...");
    await page.evaluate(() => {
        if (window.openTemplateModal) window.openTemplateModal();
    });
    await page.waitForTimeout(500);
    await page.fill('#tpl-name', 'Test Citadel 2');
    await page.fill('#tpl-icon', '🏯');
    await page.fill('#tpl-level', '15');
    await page.evaluate(() => {
        if (window.saveTemplateForm) window.saveTemplateForm();
    });
    await page.waitForTimeout(2000);

    // Click on the first two templates in the sidebar to add them to the config table
    console.log("Adding templates to config table...");
    const templateItems = await page.locator('#template-list > div').all();
    console.log(`Found ${templateItems.length} templates in sidebar`);
    if (templateItems.length >= 3) {
        await templateItems[1].click();
        await page.waitForTimeout(500);
        await templateItems[2].click();
        await page.waitForTimeout(500);
    } else {
        throw new Error("Not enough templates loaded in sidebar");
    }

    // Now set them to 'manual' and assign same coordinates
    console.log("Setting templates to manual and entering colliding coordinates...");

    // Select all type dropdowns and change to manual
    const selects = await page.locator('#config-table-body select').all();
    console.log(`Found ${selects.length} select dropdowns in config table`);
    for (const select of selects) {
        await select.selectOption('manual');
        await page.waitForTimeout(200);
    }

    // Enter lat/lng
    // We need to re-query the inputs because the DOM is re-rendered when the select is changed
    const latInputs = await page.locator('#config-table-body input[placeholder="lat"]').all();
    const lngInputs = await page.locator('#config-table-body input[placeholder="lng"]').all();
    const countInputs = await page.locator('#config-table-body input[type="number"]:not([placeholder])').all();

    console.log(`Found ${countInputs.length} count inputs, ${latInputs.length} lat inputs and ${lngInputs.length} lng inputs.`);

    for (let i = 0; i < 2; i++) {
        await countInputs[i].fill('1');
        await countInputs[i].dispatchEvent('change');
        await page.waitForTimeout(200);

        await latInputs[i].fill('50.4501');
        await lngInputs[i].fill('30.5234');
        // trigger onchange
        await latInputs[i].dispatchEvent('change');
        await lngInputs[i].dispatchEvent('change');
        await page.waitForTimeout(200);
    }

    // Set snapshotId so it doesn't abort early
    await page.evaluate(() => {
        if (window.configManager) window.configManager._snapshotId = "test-snapshot";
    });

    console.log("Clicking Apply Changes...");
    await page.click('#btn-apply-changes');

    await page.waitForTimeout(1000);

    // Assert that rows have the red error class
    console.log("Asserting visual error feedback...");
    const errorRows = await page.locator('#config-table-body tr.border-red-500').count();
    console.log(`Found ${errorRows} rows with error highlight.`);

    if (errorRows >= 2) {
        console.log("✅ SUCCESS: Collision validation blocked save and highlighted rows.");
    } else {
        console.error("❌ FAILED: Collision validation did not highlight rows.");
        process.exit(1);
    }

  } catch (err) {
    console.error(`❌ Test failed: ${err.message}`);
    process.exit(1);
  } finally {
    console.log("Closing browser...");
    await browser.close();
  }
})();