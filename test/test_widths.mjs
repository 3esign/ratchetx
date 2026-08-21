// A width sweep. The layout has now broken three times in the same way — some
// child forcing the page wider than the screen — so this checks every width in
// the real range rather than the four I happened to think of.
import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';
const BASE = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : process.platform === 'win32' ? { channel:'chrome' } : {};
const b = await chromium.launch(launch);
const p = await b.newPage({ viewport:{width:1440,height:900} });
await installFixtureRoutes(p);
await p.goto(BASE, { waitUntil:'networkidle' });
await p.waitForTimeout(1400);
const bad = [];
for (let w = 360; w <= 1920; w += 20) {
  await p.setViewportSize({ width:w, height:900 });
  await p.waitForTimeout(60);
  const r = await p.evaluate(()=>{
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return null;
    const e = [...document.querySelectorAll('body *')].find(el=>{
      const b = el.getBoundingClientRect();
      return b.width>0 && b.right>vw+1 && getComputedStyle(el).position!=='fixed';
    });
    return { over: document.documentElement.scrollWidth - vw,
      who: e ? (e.id || (''+e.className).slice(0,24) || e.tagName) : '?' };
  });
  if (r) bad.push(`${w}px overflows by ${r.over} (${r.who})`);
}
await b.close();
console.log(bad.length ? bad.slice(0,12).join('\n') + `\n\n${bad.length} WIDTHS OVERFLOW`
  : 'NO HORIZONTAL OVERFLOW AT ANY WIDTH FROM 360 TO 1920');
process.exitCode = bad.length ? 1 : 0;
