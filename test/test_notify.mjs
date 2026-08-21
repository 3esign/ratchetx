// A shot settles while the player is elsewhere. Do they find out?
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
let bad=0; const check=(c,l)=>{ if(!c)bad++; console.log((c?'PASS  ':'FAIL  ')+l); };

// --- 1. tab hidden: the title has to carry it ---
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8255/', { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
  await p.goto('http://127.0.0.1:8255/?who=settle&reset=1', { waitUntil:'networkidle' });
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
  await p.goto('http://127.0.0.1:8255/', { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
  await p.goto('http://127.0.0.1:8255/?who=settle&reset=1', { waitUntil:'networkidle' });
  let m={flashed:false,banner:'',hasBtn:false};
  for (let i=0;i<30;i++){ await p.waitForTimeout(400);
    m = await p.evaluate(()=>({
      flashed: !!document.querySelector('.cham.justsettled'),
      banner: (document.getElementById('mode')||{}).textContent||'',
      hasBtn: !!document.getElementById('notifYes') }));
    if(m.flashed||m.hasBtn) break; }
  const _unused = (()=>({
    flashed: !!0,
    banner:'', hasBtn:false }))();
  check(m.flashed, 'the settled card flashes when you are looking at it');
  check(/Want to know when the next one does/.test(m.banner) && m.hasBtn,
        'and the permission ask arrives AFTER a settlement, with a button');
  await ctx.close();
}

// --- 3. it asks once, ever ---
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8255/', { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>{ localStorage.setItem('ratchet_notif_asked','1');
    localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })); });
  await p.goto('http://127.0.0.1:8255/?who=settle&reset=1', { waitUntil:'networkidle' });
  await p.waitForTimeout(9000);
  check(!(await p.evaluate(()=>!!document.getElementById('notifYes'))),
        'someone who already answered is never asked again');
  await ctx.close();
}
await b.close();
console.log(bad? `\n${bad} PROBLEM(S)` : '\nTHE PLAYER FINDS OUT');
