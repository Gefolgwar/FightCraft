import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.join(__dirname, '.playwright-profile');

async function run() {
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, { 
    headless: true, 
    viewport: { width: 1280, height: 900 } 
  });
  
  const page = browser.pages()[0] || await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  // Automatically accept all dialogs (prompts, alerts, confirms)
  page.on('dialog', async dialog => {
    console.log('Dialog opened:', dialog.message(), dialog.type());
    if (dialog.type() === 'prompt') {
      await dialog.accept('6'); // Provide input to the prompt
    } else {
      await dialog.accept();
    }
  });

  console.log('Navigating to templates_map.html...');
  await page.goto('http://localhost:5000/map/templates_map.html', { waitUntil: 'load', timeout: 30000 });
  
  await page.waitForTimeout(5000); 

  console.log('Taking first screenshot...');
  await page.screenshot({ path: 'docs/playwright-test-results/2-01-page.png' });

  console.log('Evaluating generateGlobalWorld()...');
  try {
    const result = await page.evaluate(async () => {
      try {
        // Run generation without awaiting, as it might be async and we want to let it run
        window.generateGlobalWorld();
        return "Started window.generateGlobalWorld()";
      } catch(e) {
        return "Error in generateGlobalWorld: " + e.message;
      }
    });
    console.log(result);
  } catch (err) {
    console.error("Evaluate error:", err);
  }

  // Wait for the generation progress bar to finish.
  // The generateGlobalWorld updates #world-progress-status. We can wait for it to have "Complete" or just wait 20s.
  console.log('Waiting for generation to finish...');
  await page.waitForTimeout(20000);

  console.log('Taking second screenshot...');
  await page.screenshot({ path: 'docs/playwright-test-results/2-02-result.png' });

  await browser.close();
}

run().catch(console.error);
