import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const logs = [];
page.on('console', msg => {
  const text = msg.text();
  logs.push(text);
  // Print important logs in real-time
  if (text.includes('rror') || text.includes('character') || text.includes('Character') ||
      text.includes('INIT') || text.includes('Firebase') || text.includes('Auth') ||
      text.includes('Waiting') || text.includes('permission') || text.includes('📥') ||
      text.includes('📋') || text.includes('getAllCharacters') || text.includes('db')) {
    console.log(`  [CONSOLE] ${text}`);
  }
});
page.on('pageerror', err => console.log(`  [PAGE_ERROR] ${err.message}`));

console.log('Navigating to localhost:5000...');
await page.goto('http://localhost:5000', { waitUntil: 'networkidle', timeout: 30000 });

if (page.url().includes('login')) {
  console.log('\n=== LOG IN MANUALLY, I WILL MONITOR ===\n');
  try {
    await page.waitForURL('**/core/index.html**', { timeout: 120000 });
  } catch {
    console.log('Timeout. URL:', page.url());
    await browser.close();
    process.exit(1);
  }
}

console.log('On core/index.html — monitoring #char-loading every second for 20s...\n');

for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);

  const state = await page.evaluate(() => {
    const charLoading = document.getElementById('char-loading');
    const charList = document.getElementById('char-list');
    const charScreen = document.getElementById('character-selection-screen');
    const charError = document.querySelector('.char-error, [id*="char-error"]');

    // Count how many #character-selection-screen exist
    const screenCount = document.querySelectorAll('#character-selection-screen').length;
    const charLoadingCount = document.querySelectorAll('#char-loading').length;

    return {
      screenCount,
      charLoadingCount,
      charLoading: charLoading ? { hidden: charLoading.classList.contains('hidden'), display: getComputedStyle(charLoading).display, text: charLoading.innerText?.substring(0, 80) } : null,
      charList: charList ? { hidden: charList.classList.contains('hidden'), children: charList.children.length, text: charList.innerText?.substring(0, 80) } : null,
      charScreen: charScreen ? { hidden: charScreen.classList.contains('hidden'), display: getComputedStyle(charScreen).display } : null,
      error: charError ? charError.innerText : null,
      gameStarted: !!window._currentCharacterId,
    };
  });

  const t = `${i + 1}s`;
  if (state.charLoading && !state.charLoading.hidden) {
    console.log(`  ${t}: ⏳ #char-loading VISIBLE — "${state.charLoading.text}" (${state.charLoadingCount} duplicates, ${state.screenCount} screens)`);
  } else if (state.charList && !state.charList.hidden) {
    console.log(`  ${t}: ✅ #char-list VISIBLE — ${state.charList.children} chars: "${state.charList.text}"`);
  } else if (state.gameStarted) {
    console.log(`  ${t}: 🎮 Game started!`);
    break;
  } else if (state.error) {
    console.log(`  ${t}: ❌ Error: "${state.error}"`);
  } else {
    console.log(`  ${t}: ❓ charLoading=${JSON.stringify(state.charLoading)}, charList=${JSON.stringify(state.charList)}, screens=${state.screenCount}`);
  }
}

// Final state dump
const finalLogs = logs.filter(l =>
  l.includes('rror') || l.includes('permission') || l.includes('denied') ||
  l.includes('📥') || l.includes('📋') || l.includes('getAllCharacters') ||
  l.includes('Found') || l.includes('Retrieved') || l.includes('Loading characters')
);
if (finalLogs.length) {
  console.log('\n--- Key console messages ---');
  finalLogs.forEach(l => console.log(`  ${l}`));
}

await page.screenshot({ path: 'diag-charload.png', fullPage: true });
console.log('\nScreenshot: diag-charload.png');
console.log('Browser stays open 120s...');
await page.waitForTimeout(120000);
await browser.close();
