import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(html);
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
  // The first request is deliberately hung for 13s. The claim under test is
  // that the page recovers BY ITSELF, without a reload — not that it manages it
  // within a particular number of seconds. The old 22s deadline left only ~9s
  // of margin for the abort to propagate, the retry to fire, the second request
  // to complete and STATE to populate, which is enough on an idle CI box and not
  // enough on a loaded or thermally throttled laptop. Widen the patience; the
  // assertion is unchanged.
  await page.waitForFunction(() => typeof STATE !== 'undefined' && STATE && STATE.ok, null, {timeout:45000});
  // WAIT for the banner to clear rather than sampling it one tick after
  // recovery. "It clears" is a condition, and a condition is waited for; reading
  // it at an instant races the very repaint it is asserting about.
  await page.waitForFunction(
    () => document.getElementById('mode').style.display === 'none',
    null, {timeout:15000},
  ).catch(() => {});
  const result = await page.evaluate(() => ({
    version: STATE && STATE.v,
    banner: document.getElementById('mode').textContent,
    bannerDisplay: document.getElementById('mode').style.display,
  }));
  const elapsed = Date.now() - started;
  assert.ok(stateCalls >= 2, `a second state request ran automatically (calls=${stateCalls})`);
  assert.ok(elapsed >= 12000, `the first hung request reached its timeout (elapsed=${elapsed}ms)`);
  assert.ok(result.version, 'the retry recovered a valid game state');
  assert.equal(result.bannerDisplay, 'none',
    `the temporary error banner clears after recovery (banner="${result.banner}", elapsed=${elapsed}ms)`);
  console.log('hung initial state request timed out and recovered automatically without page reload');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}