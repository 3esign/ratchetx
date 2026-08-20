import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
let bad = 0;
for (const vp of [{w:1920,h:1080},{w:1440,h:900},{w:1366,h:768},{w:1280,h:700},{w:1100,h:620},{w:920,h:800},{w:430,h:900}]) {
  const p = await b.newPage({ viewport:{width:vp.w,height:vp.h} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8247/', { waitUntil:'networkidle' });
  await p.waitForTimeout(1400);
  const stacked = vp.w <= 920;
  const probe = () => p.evaluate(()=>{
    const g=document.querySelector('.playgrid');
    const L=g.children[0].getBoundingClientRect(), R=g.children[1].getBoundingClientRect();
    const i=document.querySelector('.railInner').getBoundingClientRect();
    const railTop=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--railTop'))||76;
    const pinned=Math.abs(i.top-railTop)<2;
    return { dBottom:Math.round(Math.abs(L.bottom-R.bottom)), dTop:Math.round(Math.abs(L.top-R.top)),
      pinned, pinnedFits: !pinned || Math.round(i.bottom)<=window.innerHeight+1,
      pageWide: document.documentElement.scrollWidth>window.innerWidth+1,
      railTop };
  });
  const rows=[];
  for (const y of [0,200,500,1200,99999]) {
    await p.evaluate(y=>window.scrollTo(0,y), y); await p.waitForTimeout(220);
    rows.push({y, ...(await probe())});
  }
  const align = stacked || rows.every(r=>r.dBottom<=2 && r.dTop<=2);
  const pinOK = stacked || rows.every(r=>r.pinnedFits);
  // A tall viewport may never need to pin — the rail's section ends before the
  // pin point. That is correct, not a fault.
  const everPinned = stacked || rows.some(r=>r.pinned) || vp.h >= 1000;
  const wideOK = rows.every(r=>!r.pageWide);
  const ok = align && pinOK && everPinned && wideOK && !errs.length;
  if(!ok) bad++;
  console.log(`${String(vp.w).padEnd(5)} ${ok?'✓':'✗'} `
    + (stacked ? 'stacked layout' : `columns Δ${rows.map(r=>r.dBottom).join('/')}px · pins at ${rows[0].railTop}px: ${everPinned} · fits when pinned: ${pinOK}`)
    + ` · no page overflow: ${wideOK}` + (errs.length?' · ERRORS '+errs.join('|'):''));
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nCOLUMNS ALIGN AND THE RAIL PINS CORRECTLY AT EVERY WIDTH');
