import { chromium } from 'playwright';
import { installFixtureRoutes } from './browser_fixture.mjs';
const BASE = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : process.platform === 'win32' ? { channel:'chrome' } : {};
const b = await chromium.launch(launch);
let bad=0; const check=(c,l)=>{ if(!c)bad++; console.log((c?'PASS  ':'FAIL  ')+l); };
const p = await b.newPage({ viewport:{width:1440,height:1000} });
await installFixtureRoutes(p);
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(new URL('?reset=1', BASE).href, { waitUntil:'domcontentloaded' });
await p.evaluate(()=>localStorage.setItem('ratchet_auth', JSON.stringify(
  { wallet:'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM', ts:Date.now(), sig:'x' })));
await p.goto(BASE, { waitUntil:'networkidle' });
await p.evaluate(()=>{ const a=[...document.querySelectorAll('a,button')].find(x=>x.textContent.trim()==='WARDEN'); if(a)a.click(); });
await p.waitForTimeout(1800);
const m = await p.evaluate(()=>({
  n:(document.getElementById('chalN')||{}).textContent,
  rows:[...document.querySelectorAll('#chalBox .crow')].map(r=>r.textContent.replace(/\s+/g,' ').trim()),
  takes:[...document.querySelectorAll('[data-take]')].map(x=>x.textContent.trim()),
  pctHidden:(document.getElementById('cPct')||{}).style?.display,
  hasForm:!!document.getElementById('cGo'),
  wide:document.documentElement.scrollWidth>window.innerWidth+1 }));
console.log(m.n); m.rows.forEach(r=>console.log('  '+r));
check(/2 OPEN/.test(m.n||''), 'the open board is counted');
check(m.rows.length===2, 'both challenges render');
check(m.takes.join(',')==='TAKE NO,TAKE YES', 'the button offers the OPPOSITE side of each');
check(m.pctHidden==='none', 'the % field is hidden until a threshold kind is chosen');
check(m.hasForm, 'and there is a form to write one');
// choosing a threshold kind reveals the % field
await p.selectOption('#cKind','thr'); await p.waitForTimeout(200);
check((await p.evaluate(()=>document.getElementById('cPct').style.display))==='block',
      'choosing "rises by" reveals the % field');
check(!m.wide, 'no horizontal overflow');
check(errs.length===0, 'no js errors'+(errs.length?': '+errs.join('|'):''));
await b.close();
console.log(bad?`\n${bad} PROBLEM(S)`:'\nCHALLENGE BOARD OK');
process.exitCode = bad ? 1 : 0;
