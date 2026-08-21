// Walk the funnel a real visitor walks and assert every dead end offers a way out.
import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';
const BASE = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : process.platform === 'win32' ? { channel:'chrome' } : {};
const b = await chromium.launch(launch);
const MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
let bad = 0;
const check = (c, label) => { if(!c) bad++; console.log((c?'PASS  ':'FAIL  ')+label); };

for (const [who, expect] of [['guest',null],['unqual','UNVERIFIED'],['broke','OUT OF CREDITS'],['rich',null]]) {
  const p = await b.newPage({ viewport:{width:1440,height:900} });
  await installFixtureRoutes(p);
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  // The page restores a connected wallet from localStorage, which is the only
  // way to reach the branches past the guest check without a real wallet.
  await p.goto(BASE, { waitUntil:'domcontentloaded' });
  await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
    { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
  await p.goto(new URL(`?who=${who}`, BASE).href, { waitUntil:'networkidle' });
  // the page fetches /api/game?action=state...; make it carry the mode through
  await p.evaluate(w=>{ const f=window.fetch; window.fetch=(u,o)=>
    f(typeof u==='string'&&u.includes('action=state')?u+'&who='+w:u,o); }, who);
  await p.waitForTimeout(1600);
  await p.evaluate(()=>{ if(document.getElementById('reloadP')) document.getElementById('reloadP').style.display='block'; });
  await p.waitForTimeout(400);
  const m = await p.evaluate(()=>{
    const st=document.getElementById('standing');
    const links=[...document.querySelectorAll('.getrcx')].map(a=>({
      t:a.textContent.trim(), h:a.href||buyUrl()||'' }));
    return { standing:(st?st.textContent:'').replace(/\s+/g,' ').trim().slice(0,120),
             getrcx: links, row:(document.getElementById('getRcxRow')||{}).textContent||'' };
  });
  console.log(`\n[${who}] ${m.standing}`);
  if (expect) {
    check(m.standing.includes(expect), `${who}: the state is named plainly`);
    check(m.getrcx.some(l=>l.h.includes(MINT)), `${who}: and carries a working way out`);
  } else if (who === 'rich') {
    check(!m.getrcx.length && !m.row.trim(), 'rich: no buy prompt shown to someone who does not need one');
  }
  if (errs.length) { check(false, who+': js errors — '+errs.join('|')); }
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nEVERY DEAD END HAS A DOOR');
process.exitCode = bad ? 1 : 0;
