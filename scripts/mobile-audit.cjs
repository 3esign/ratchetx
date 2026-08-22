const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://www.ratchetx.xyz/';
const sizes = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'pixel', width: 412, height: 915 },
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/127 Mobile Safari/537.36',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push('page: ' + error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    page.on('requestfailed', request => { if (!request.url().startsWith('https://phantom.app/')) errors.push('request: ' + request.url() + ' ' + (request.failure()?.errorText || 'failed')); });
    page.on('response', response => { if (response.status() >= 400) errors.push('http ' + response.status() + ': ' + response.url()); });
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const before = await page.evaluate(() => {
      const rect = selector => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const hudBottom = document.querySelector('.hudbottom');
      return {
        viewport: [innerWidth, innerHeight],
        document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        body: [document.body.scrollWidth, document.body.scrollHeight],
        hud: rect('.hud'),
        top: rect('.hudtop'),
        bottom: rect('.hudbottom'),
        logo: rect('.logo'),
        connect: rect('#cx'),
        machine: rect('.machine'),
        playgrid: rect('.playgrid'),
        navScroll: hudBottom ? [hudBottom.clientWidth, hudBottom.scrollWidth, hudBottom.scrollLeft] : null,
        targets: document.querySelectorAll('.target').length,
        fireVisible: !![...document.querySelectorAll('button')].find(b => /fire|pick a target/i.test(b.textContent) && b.offsetParent),
        stateVersion: window.STATE?.v || null,
        walletProvider: !!(window.solana || window.phantom?.solana),
      };
    });
    await page.locator('nav button[data-go="warden"]').click();
    await page.waitForTimeout(200);
    const wardenVisible = await page.locator('#warden').evaluate(el => el.classList.contains('on'));
    await page.locator('nav button[data-go="play"]').click();
const phantomHandoff = await page.evaluate(() => {
      if (window.solana || window.phantom?.solana || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return null;
      return `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
    });
    const toast = await page.locator('#toast').textContent().catch(() => '');
    results.push({ size, status: response?.status(), before, wardenVisible, phantomHandoff, connectToast: toast, errors: errors.slice(0, 12) });
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
