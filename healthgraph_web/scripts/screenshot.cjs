/* Screenshot the redesigned page at desktop + mobile, plus the form section. */
const { chromium } = require('playwright-core');
const os = require('os');

const exe = os.homedir() + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

  const shots = [
    { name: 'desktop-hero', w: 1440, h: 900, url: 'http://localhost:4173/#home' },
    { name: 'desktop-form', w: 1440, h: 900, url: 'http://localhost:4173/#early-access' },
    { name: 'desktop-pricing', w: 1440, h: 900, url: 'http://localhost:4173/#pricing' },
    { name: 'mobile-hero', w: 390, h: 844, url: 'http://localhost:4173/#home' },
    { name: 'mobile-form', w: 390, h: 844, url: 'http://localhost:4173/#early-access' },
  ];

  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
    await page.goto(s.url, { waitUntil: 'load', timeout: 20000 });
    // let splash finish + reveals settle
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `/tmp/shot-${s.name}.png` });
    console.log('saved', s.name);
    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
