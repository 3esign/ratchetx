const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const input = path.join(root, 'token', 'dexscreener-header.html');
  const output = path.join(root, 'token', 'dexscreener-header.png');
  const iconInput = path.join(root, 'token', 'dexscreener-icon.html');
  const iconOutput = path.join(root, 'token', 'dexscreener-icon.png');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });
    await page.screenshot({ path: output, type: 'png', fullPage: false });
    const iconPage = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    await iconPage.goto(pathToFileURL(iconInput).href, { waitUntil: 'load' });
    await iconPage.screenshot({ path: iconOutput, type: 'png', fullPage: false });
  } finally {
    await browser.close();
  }
  process.stdout.write(output + '\n' + iconOutput + '\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
