// A shot settles while the player is elsewhere. Do they find out?
import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';
const BASE = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : process.platform === 'win32' ? { channel:'chrome' } : {};
const b = await chromium.launch(launch);
let bad=0; const check=(c,l)=>{ if(!c)bad++; console.log((c?'PASS  ':'FAIL  ')+l); };

// --- 1. tab hidden: the title has to carry it ---
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await installFixtureRoutes(p,'settle');
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE, { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
  await p.goto(new URL('?who=settle&reset=1', BASE).href, { waitUntil:'networkidle' });
  await p.waitForTimeout(1200);
  const base = await p.title();
  check(!/SETTLED/.test(base), 'a fresh load announces nothing — history is recorded, not replayed');
  // hide the tab, then let the next poll bring the settlement
  await p.evaluate(()=>{ Object.defineProperty(document,'hidden',{value:true,configurable:true});
                         Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}); });
  let hidden = '';
  for (let i=0;i<30;i++){ await p.waitForTimeout(500); hidden = await p.title(); if(/SETTLED/.test(hidden)) break; }
  console.log('  title while hidden:', hidden);
  check(/^\(1\) SETTLED/.test(hidden), 'the tab title reports it while you are away');
  // come back
  await p.evaluate(()=>{ Object.defineProperty(document,'hidden',{value:false,configurable:true});
    Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
    document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(400);
  check((await p.title()) === base, 'and clears the moment you look');
  if(errs.length) check(false,'js errors: '+errs.join('|'));
  await ctx.close();
}

// --- 2. tab visible: the card itself announces ---
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  // The ask is shown only to somebody who has not answered yet -- the page
  // checks `Notification.permission === "default"`, and correctly says nothing
  // to a browser that already said no. Headless Chromium reports "denied" out
  // of the box because it has no permission UI at all, so without this the
  // fixture is not testing a fresh visitor, it is testing a visitor who
  // declined -- and the assertion below asks for the opposite of what the code
  // should do. Present the state the branch is about.
  await p.addInitScript(() => {
    if (!window.Notification) return;
    Object.defineProperty(Notification, 'permission', { value: 'default', configurable: true });
  });
  await installFixtureRoutes(p,'settle');
  await p.goto(BASE, { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
  await p.goto(new URL('?who=settle&reset=1', BASE).href, { waitUntil:'networkidle' });
  // TWO SIGNALS OF DIFFERENT KINDS, SO TWO OBSERVATIONS.
  //
  // The flash is transient by definition -- `.justsettled` is added and taken
  // away again -- while the permission ask persists once it appears. Sampling
  // both at the same instant and requiring both at once is a race, and it lost
  // on the owner's machine against real Chrome while passing in a container:
  // the flash had already faded by the time the ask landed. A transient signal
  // has to be LATCHED (did it ever happen) and a persistent one read (is it
  // here now).
  let sawFlash=false;
  let m={flashed:false,banner:'',hasBtn:false};
  for (let i=0;i<30;i++){ await p.waitForTimeout(400);
    m = await p.evaluate(()=>({
      flashed: !!document.querySelector('.cham.justsettled'),
      banner: (document.getElementById('mode')||{}).textContent||'',
      hasBtn: !!document.getElementById('notifYes') }));
    sawFlash = sawFlash || m.flashed;
    if(m.hasBtn) break; }
  check(sawFlash, 'the settled card flashes when you are looking at it');
  check(/Want to know when the next one does/.test(m.banner) && m.hasBtn,
        'and the permission ask arrives AFTER a settlement, with a button');
  await ctx.close();
}

// --- 3. it asks once, ever ---
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await installFixtureRoutes(p,'settle');
  await p.goto(BASE, { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>{ localStorage.setItem('ratchet_notif_asked','1');
    localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })); });
  await p.goto(new URL('?who=settle&reset=1', BASE).href, { waitUntil:'networkidle' });
  await p.waitForTimeout(9000);
  check(!(await p.evaluate(()=>!!document.getElementById('notifYes'))),
        'someone who already answered is never asked again');
  await ctx.close();
}
await b.close();
console.log(bad? `\n${bad} PROBLEM(S)` : '\nTHE PLAYER FINDS OUT');
process.exitCode = bad ? 1 : 0;
