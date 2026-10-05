/* Re-encode image.png to a web-sized JPEG via headless Chromium canvas. */
const { chromium } = require('playwright-core');
const os = require('os');
const fs = require('fs');
const path = require('path');

const exe = os.homedir() + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const SRC = path.resolve(__dirname, '..', 'image.png');
const OUT = path.resolve(__dirname, '..', 'public', 'founders.jpg');

(async () => {
  const b64 = fs.readFileSync(SRC).toString('base64');
  const dataUrl = 'data:image/png;base64,' + b64;

  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.goto('about:blank');

  const out = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const maxW = 1200;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }, dataUrl);

  fs.writeFileSync(OUT, Buffer.from(out.split(',')[1], 'base64'));
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
