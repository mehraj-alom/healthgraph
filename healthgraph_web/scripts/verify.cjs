/* DOM-level verification of the redesign. */
const { chromium } = require('playwright-core');
const os = require('os');

const exe = os.homedir() + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:4173/', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(2400); // splash + reveals

  const checks = await page.evaluate(() => {
    const out = {};
    out.bodyFont = getComputedStyle(document.body).fontFamily.slice(0, 60);
    out.bodyBg = getComputedStyle(document.body).backgroundColor;
    out.noHorizOverflow = document.documentElement.scrollWidth <= window.innerWidth;
    out.sections = ['home', 'features', 'capabilities', 'app', 'privacy', 'videos', 'pricing', 'early-access']
      .map((id) => ({ id, present: !!document.getElementById(id) }));
    out.heroCta = document.querySelector('#home a[href="#early-access"]')?.textContent?.trim() ?? null;
    out.heroTitle = document.querySelector('#home h1')?.textContent?.trim().replace(/\s+/g, ' ') ?? null;
    out.navCta = document.querySelector('header a[href="#early-access"]')?.textContent?.trim() ?? null;
    out.splashGone = !document.querySelector('.z-\\[100\\]');
    const text = document.body.innerText;
    out.emDashes = (text.match(/—|–/g) || []).length;
    out.form = {
      name: !!document.getElementById('ea-name'),
      email: !!document.getElementById('ea-email'),
      city: !!document.getElementById('ea-city'),
      submit: !!document.querySelector('#early-access button[type="submit"]'),
    };
    // headline tracking sanity: h1 should not be default weight
    out.h1Weight = getComputedStyle(document.querySelector('#home h1')).fontWeight;
    return out;
  });
  console.log(JSON.stringify(checks, null, 2));

  // Form flow: submit empty -> errors; fill -> success
  await page.click('#early-access button[type="submit"]');
  await page.waitForTimeout(300);
  const errorCount = await page.evaluate(() => document.querySelectorAll('#early-access [id$="-error"]').length);
  console.log('empty-submit error count:', errorCount);

  await page.fill('#ea-name', 'Ada Lovelace');
  await page.fill('#ea-email', 'ada@example.com');
  await page.fill('#ea-city', 'Berlin');
  await page.click('#early-access button[type="submit"]');
  await page.waitForTimeout(600);
  const success = await page.evaluate(() => document.body.innerText.includes("You're on the list."));
  const stored = await page.evaluate(() => localStorage.getItem('hg-early-access'));
  console.log('success state shown:', success);
  console.log('localStorage backup:', stored);

  // German locale check
  const page2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page2.goto('http://localhost:4173/', { waitUntil: 'load', timeout: 20000 });
  await page2.evaluate(() => localStorage.setItem('hg-locale', 'de'));
  await page2.reload({ waitUntil: 'load' });
  await page2.waitForTimeout(2400);
  const deText = await page2.evaluate(() => document.querySelector('#early-access h2')?.textContent);
  console.log('DE early-access title:', deText);

  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
