import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url));
// The client is modular now (app.js + style.css split out of index.html) —
// the page under test is dead without them, so the fixture serves all three.
const appJs = readFileSync(new URL('../app.js', import.meta.url));
const styleCss = readFileSync(new URL('../style.css', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(html);
  } else if (req.url === '/app.js') {
    res.writeHead(200, {'content-type':'text/javascript; charset=utf-8'});
    res.end(appJs);
  } else if (req.url === '/style.css') {
    res.writeHead(200, {'content-type':'text/css; charset=utf-8'});
    res.end(styleCss);
  } else {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const launch = process.platform === 'win32' ? {channel:'chrome'} : {};
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage();
  await installFixtureRoutes(page);
  let stateCalls = 0;
  await page.route('**/api/game?action=state*', async route => {
    stateCalls++;
    if (stateCalls === 1) {
      await new Promise(resolve => setTimeout(resolve, 13000));
      await route.abort('timedout').catch(() => {});
      return;
    }
    await route.fallback();
  });
  const started = Date.now();
  await page.goto('http://127.0.0.1:' + port + '/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => typeof STATE !== 'undefined' && STATE && STATE.ok, null, {timeout:22000});
  const result = await page.evaluate(() => ({
    version: STATE && STATE.v,
    banner: document.getElementById('mode').textContent,
    bannerDisplay: document.getElementById('mode').style.display,
  }));
  assert.ok(stateCalls >= 2, 'a second state request ran automatically');
  assert.ok(Date.now() - started >= 12000, 'the first hung request reached its timeout');
  assert.ok(result.version, 'the retry recovered a valid game state');
  assert.equal(result.bannerDisplay, 'none', 'the temporary error banner clears after recovery');
  console.log('hung initial state request timed out and recovered automatically without page reload');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}