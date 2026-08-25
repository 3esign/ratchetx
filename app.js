
const $=id=>document.getElementById(id);
const API='/api/game';
let AUTH=null, DEMO=null, STATE=null, sel={t:null,side:null,stake:500}, dead=false;
// SEALED means sealed: the server no longer returns open shots' sides to
// anyone — including this client. Your own sides live here, locally.
let SIDES={};try{SIDES=JSON.parse(localStorage.getItem("ratchet_sides"))||{}}catch(e){if(e&&e.message&&e.message.includes("slow down")) { PB.slow = (PB.slow||0)+1; if(PB.slow>3) { toast("Reload paused due to rate limits. Click CREDIT manually."); setPB(null); paintBurnBtn(); } }}
function rememberSide(shot){if(!shot||!shot.id)return;SIDES[shot.id]=shot.side;
  const ks=Object.keys(SIDES);if(ks.length>80)delete SIDES[ks[0]];
  localStorage.setItem("ratchet_sides",JSON.stringify(SIDES));}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.remove("on"));
  document.querySelectorAll("section").forEach(x=>x.classList.remove("on"));
  b.classList.add("on");$(b.dataset.go).classList.add("on");});
function copyCA(){const c=$("caChip").dataset.ca;if(c){navigator.clipboard.writeText(c);toast("CA copied: "+c.slice(0,10)+"…")}}
function toast(m){const t=$("toast");t.textContent=String(m);t.classList.add("show");
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),2800);}
const short=w=>w.length>10?w.slice(0,4)+"…"+w.slice(-4):w;
const fmt$=(n,d)=>n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:0}):(n>=0.01||n===0)?n.toFixed(d??2):Number(n.toPrecision(2)).toString();
// fmt$ is tuned for a price CHIP, where two decimals is plenty. A live readout
// compares two nearby numbers — "WIF $0.15 needs below $0.15" is true, useless,
// and reads like a bug. This keeps enough significant digits for the comparison
// to mean something at any feed's scale.
const fmtCmp=n=>{
  if(!Number.isFinite(n))return "—";
  const a=Math.abs(n);
  if(a>=1000)return n.toLocaleString(undefined,{maximumFractionDigits:0});
  if(a>=1)return n.toFixed(2);
  if(a>=0.01)return n.toFixed(4);
  return Number(n.toPrecision(4)).toString();
};
// paint-without-flicker: only touch the DOM when the content actually
// changed, so entry animations play once instead of on every repaint.
const setHTML=(el,html)=>{if(el&&el._h!==html){el._h=html;el.innerHTML=html;}};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ---------- wallet ----------
// Every visitor gets a demo identity immediately, so the game is playable on
// arrival instead of behind a CONNECT button. Demo shots never touch a ladder,
// a pot or the feed — that is enforced on the server, not just labelled here.
function guestId(){
  if(DEMO)return DEMO;
  DEMO=localStorage.getItem("ratchet_demo")||("demo-"+Math.random().toString(36).slice(2,8));
  localStorage.setItem("ratchet_demo",DEMO);
  return DEMO;
}
async function connect(){
  const prov=window.solana||window.phantom&&window.phantom.solana;
  if(!prov){
    // Ordinary mobile browsers cannot inject a wallet provider. A user click
    // may safely open this page inside Phantom, where the normal provider path
    // below works unchanged.
    const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if(mobile){
      const page=encodeURIComponent(location.href), ref=encodeURIComponent(location.origin);
      location.assign(`https://phantom.app/ul/browse/${page}?ref=${ref}`);
      return;
    }
    guestId();
    $("cx").textContent="GUEST · "+DEMO.slice(5);$("cx").classList.add("done");
    toast("No wallet found — playing as a guest. Install Phantom to enter ranked play.");
    refresh();return;
  }
  try{
    const r=await prov.connect();
    const wallet=r.publicKey.toString();
    const nr=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"nonce"})}).then(x=>x.json());
    if(!nr.ok) throw new Error(nr.reason||"nonce failed");
    const nonce=nr.nonce;
    const msg=new TextEncoder().encode(`RATCHET | ${wallet} | ${nonce}`);
    const sg=await prov.signMessage(msg,"utf8");
    const sig=btoa(String.fromCharCode(...sg.signature));
    const lr=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",wallet,nonce,sig})}).then(x=>x.json());
    if(!lr.ok) throw new Error(lr.reason||"login failed");
    AUTH={wallet,token:lr.token};
    localStorage.setItem("ratchet_auth",JSON.stringify(AUTH));
    $("cx").textContent=short(wallet);$("cx").classList.add("done");
    toast("Connected — you are on the ladder.");
    refresh();
  }catch(e){if(e instanceof SyntaxError){toast("Server is busy (429) - wait a minute");}else{toast("Connect cancelled");}}
}
// The logo is the one thing everybody tries to click to get home, and it did
// nothing. It goes back to the board and to the top of it.
{ const go = () => { const b = document.querySelector('[data-go=play]'); if (b) b.click();
    window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const L = $("logoHome");
  if (L) { L.style.cursor = 'pointer'; L.onclick = go;
    L.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; } }

// ---------- the wallet menu ----------
// Clicking a connected wallet used to do nothing at all, so there was no way
// to disconnect, no way to see the full address, and no way to get to Solscan.
const SCAN = 'https://solscan.io/account/';
function closeWMenu(e){ const m=$("wmenu"); if(!m||m.style.display==="none")return;
  if(e&&(e.target===$("cx")||m.contains(e.target)))return; m.style.display="none"; }
document.addEventListener("click",closeWMenu);
$("cx").onclick=(e)=>{
  if(!AUTH){ connect(); return; }
  e.stopPropagation();
  const m=$("wmenu"); if(!m)return;
  const open=m.style.display!=="none";
  if(open){ m.style.display="none"; return; }
  $("wmAddr").textContent=AUTH.wallet;
  const r=STATE&&STATE.player&&STATE.player.rcx;
  $("wmBal").innerHTML = !r ? "" : (r.bal==null
    ? '<span style="color:var(--dim)">$RCX balance unreadable right now</span>'
    : `${r.bal.toLocaleString()} $RCX${r.stale?' <span style="color:var(--dim)">· last known</span>':''}`);
  $("wmScan").href=SCAN+AUTH.wallet;
  m.style.display="block";
};
$("wmAddr")&&($("wmAddr").onclick=()=>{navigator.clipboard.writeText(AUTH.wallet);toast("wallet address copied")});
$("wmOut")&&($("wmOut").onclick=()=>{
  AUTH=null; localStorage.removeItem("ratchet_auth");
  $("wmenu").style.display="none";
  $("cx").classList.remove("done");
  guestId(); $("cx").textContent="GUEST · "+DEMO.slice(5);
  for(const id of ["hRcxWrap","hCrWrap"]){const el=$(id); if(el)el.classList.add("hide");}
  toast("disconnected — your signature is forgotten on this device");
  refresh();
});
// (the connect path lives inside the handler above — this used to reassign over it)
(function restore(){
  try{const a=JSON.parse(localStorage.getItem("ratchet_auth"));
    if(a&&Date.now()-a.ts<2*3600e3){AUTH=a;$("cx").textContent=short(a.wallet);$("cx").classList.add("done");}
  }catch{}
  // no wallet connected -> you are a GUEST and can fire immediately. The button
  // still says CONNECT, because connecting is what makes a shot count.
  if(!AUTH){guestId();$("cx").textContent="GUEST · "+DEMO.slice(5);}
})();
const who=()=>AUTH?AUTH.wallet:DEMO;

// ---------- state ----------
let refreshing=false;
let refreshFailures=0, recoveryTimer=null;
const STATE_TIMEOUT_MS=12000;
function scheduleRecovery(){
  if(recoveryTimer||dead)return;
  const delay=Math.min(30000,1500*Math.pow(2,Math.min(refreshFailures-1,4)));
  recoveryTimer=setTimeout(()=>{recoveryTimer=null;refresh();},delay);
}
async function refresh(){
  if(dead||refreshing)return;
  refreshing=true;
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),STATE_TIMEOUT_MS);
  try{
    const w=who();
    const r=await fetch(API+"?action=state"+(w?("&wallet="+encodeURIComponent(w)):""),
      {signal:ctrl.signal,cache:"no-store"});
    if(!r.ok)throw new Error("server "+r.status);
    STATE=await r.json();
    if(!STATE.ok)throw new Error(STATE.reason);
    refreshFailures=0;
    if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null;}
    paint();
  }catch(e){
    refreshFailures++;
    $("mode").style.display="block";
    const why=e&&e.name==="AbortError"?"request timed out":String(e&&e.message||e);
    $("mode").textContent="Game service is temporarily unavailable. Your wallet and funds are safe — reconnecting automatically… ("+why+")";
    scheduleRecovery();
  }finally{clearTimeout(timeout);refreshing=false;}
}
function paint(){
  const s=STATE;
  $("mode").style.display=s.durable?"none":"block";
  if(!s.durable)$("mode").textContent="RUNNING WITHOUT A DATABASE — state resets on cold starts. Configure the production database in Vercel before accepting play. The game remains available for local testing only.";
  $("floorNum").innerHTML=s.stats.floor.toFixed(6)+"<small>SOL</small>";
  $("hF").textContent=s.stats.floor.toFixed(6);
  $("fedN").textContent=s.stats.shots.toLocaleString();
  if(s.mint){
    $("tokbar").style.display="flex";
    $("caChip").textContent="CA "+s.mint.slice(0,6)+"…"+s.mint.slice(-6);
    $("caChip").dataset.ca=s.mint;
    $("pfLink").href="https://pump.fun/coin/"+s.mint;
    $("pfLink").textContent="PUMP.FUN"+(s.mcap?" · MC $"+(s.mcap>=1e6?(s.mcap/1e6).toFixed(2)+"M":s.mcap>=1e3?(s.mcap/1e3).toFixed(1)+"K":s.mcap):"")+" ↗";
  }
  const SRCTXT={"pyth-onchain":"PYTH · READ ON-CHAIN","pyth":"PYTH · HERMES","coinbase":"COINBASE (FALLBACK)"};
  const srcTxt=SRCTXT[s.prices.src]||String(s.prices.src).toUpperCase();
  $("beat").innerHTML=`<b style="color:var(--grn)">● LIVE</b> · ORACLE ${srcTxt} · STATE ${s.durable?"DURABLE":"EPHEMERAL"} · LOG ${s.log?("#"+s.log.i):"—"}`;
  const cell=(k,v,c)=>`<div class="mcell"><u>${k}</u><b${c?` style="color:${c}"`:""}>${v}</b></div>`;
  setHTML($("machStats"),
    cell("BURNED FOREVER",`${Math.floor(s.stats.realBurned||0).toLocaleString()}<small>RCX</small>`,"var(--red)")+
    cell("SHOTS FIRED",s.stats.shots.toLocaleString())+
    cell("POT · TODAY",`${Math.floor(s.stats.potD||0).toLocaleString()}`,"var(--gold)")+
    cell("POT · SEASON",`${Math.floor(s.stats.pot||0).toLocaleString()}`,"var(--gold)")+
    cell("CHAMPION PAY",`${Math.floor(s.stats.champPaid||0).toLocaleString()}<small>RCX</small>`,"var(--grn)")+
    cell("STAKERS",(s.stats.stakers||0).toLocaleString()));
  if(s.v)$("footV").textContent="build "+s.v+" · ";
  // if the oracle fell back, the page has to say so — the whole claim is
  // that a shot settles on the same source it was sealed with.
  // The banner must distinguish "still Pyth, different route" from "not Pyth
  // at all" — those are very different promises to a player.
  if(s.prices.degraded){const m=$("mode");if(m){m.style.display="block";
    m.textContent=(s.prices.src==="coinbase"
      ? "ORACLE DEGRADED — running on the fallback price source, not Pyth: "
      : "ORACLE NOTE — still Pyth, but not the on-chain route: ")+s.prices.degraded;}}
  // Only numeric feeds become chips. src/degraded/ages/partial are metadata and
  // would otherwise render as "$[object Object]".
  const AGES=s.prices.ages||{};
  $("prices").innerHTML=Object.entries(s.prices).filter(([k,v])=>Number.isFinite(v)).map(([k,v])=>
    `<span class="pr">${k} <b>$${fmt$(v)}</b>${Number.isFinite(AGES[k])?`<i style="font-style:normal;opacity:.45"> ${AGES[k]}s</i>`:""}</span>`
  ).join("")+`<span class="pr">SRC <b>${srcTxt}</b></span>`;
  // MARKET CONTEXT: every question also states the level it is asking about,
  // priced off the same oracle the shot will settle on. Thresholds are struck
  // from the price at YOUR seal, so the level shown is the level you would get
  // by sealing right now.
  const mkt=t=>{
    const p=s.prices[t.feed];if(!Number.isFinite(p))return"";
    const d=x=>"$"+fmt$(x);
    if(t.kind==="race"){const q=s.prices[t.feed2];
      return `<span>${t.feed} <b>${d(p)}</b></span><span>${t.feed2} <b>${Number.isFinite(q)?d(q):"—"}</b></span>`;}
    if(t.kind==="thr")     return `<span>NOW <b>${d(p)}</b></span><span>CLEARS <b style="color:var(--grn)">${d(p*(1+t.pct))}</b></span>`;
    if(t.kind==="thrDown") return `<span>NOW <b>${d(p)}</b></span><span>BREAKS <b style="color:var(--red)">${d(p*(1-t.pct))}</b></span>`;
    if(t.kind==="range")   return `<span>NOW <b>${d(p)}</b></span><span>BAND <b>${d(p*(1-t.pct))} – ${d(p*(1+t.pct))}</b></span>`;
    return `<span>NOW <b>${d(p)}</b></span><span>STRIKE <b>AT SEAL</b></span>`;};
  // During the SOL-only seal beta, surface the eligible target first without
  // changing the deterministic board, its odds, windows or settlement terms.
  const mirrorFeeds=new Set(s.mirror&&s.mirror.enabled?(s.mirror.feeds||[]):[]);
  const mirrorable=t=>mirrorFeeds.has(t.feed)&&['dir','thr','thrDown'].includes(t.kind);
  const targetRows=Object.entries(s.targets).sort((a,b)=>Number(mirrorable(b[1]))-Number(mirrorable(a[1])));
  setHTML($("targets"),targetRows.map(([k,t])=>`
    <button class="tgt ${sel.t===k?'pick':''} ${mirrorable(t)?'onchain':''}" data-k="${k}">
      <div class="tq">${t.label}?</div>
      <div class="tmeta"><span>WINDOW <s>${t.mins>=60?(t.mins/60)+"H":t.mins+"M"}</s></span><span>BASE ${t.baseXp} XP</span></div>
      <div class="tmkt">${mkt(t)}</div>
      ${mirrorable(t)?'<div class="chainTag">⚓ ON-CHAIN SEAL BETA</div>':''}
      <div class="updown">
        <span class="ud up ${sel.t===k&&sel.side==='YES'?'on':''}" data-k="${k}" data-side="YES">YES</span>
        <span class="ud dn ${sel.t===k&&sel.side==='NO'?'on':''}" data-k="${k}" data-side="NO">NO</span>
      </div></button>`).join(""));
  document.querySelectorAll(".tgt").forEach(b=>b.onclick=e=>{
    sel.t=b.dataset.k;const sd=e.target.dataset.side;if(sd)sel.side=sd;paint();});
  const ok=sel.t&&sel.side&&who();
  $("fire").disabled=!ok;
  payLine();standing();fleet();
  const guest=!AUTH;
  $("fire").textContent=ok?(guest?`SEAL THE SHOT — ${sel.stake.toLocaleString()} (GUEST, UNRANKED) 🔒`
    :`SEAL THE SHOT — STAKE ${sel.stake.toLocaleString()} 🔥`):"PICK A TARGET AND A SIDE";
  // warden
  // The Warden is allowed to have nothing to say. Its probability comes from
  // volatility measured off the price log, and when there is not enough log to
  // measure, a blank is the honest output — the version that always had a
  // number was the version whose number meant nothing.
  $("wq").textContent=s.warden.q+(s.warden.p==null?"":"?");
  $("wp").innerHTML=s.warden.p==null?'<small style="color:var(--dim)">NO LINE</small>':s.warden.p+"<small>%</small>";
  $("wr").textContent=s.warden.r;
  // THE WARDEN'S RECORD IS THE MOST PROMINENT CREDIBILITY CLAIM ON THE PAGE,
  // so it gets the strictest treatment. It used to print a hit rate AND a
  // Brier score to three decimal places off as few as one settled call:
  // "1 SETTLED CALLS · 1 RIGHT (100%) · BRIER 0.130" reads as materially
  // better-than-chance calibration (0.25 is the coin-flip baseline) from a
  // single coin flip. Below WMIN the raw count is the whole truth.
  const WMIN=10;
  // The retired model's record is shown, not hidden. A scoreboard that resets
  // quietly is not a scoreboard — and the reset itself is in the on-chain-
  // anchorable log, so this line can be checked against it.
  const pv=s.wardenPrev;
  const prevTxt = pv&&pv.n>0
    ? ` · PREVIOUS MODEL: ${pv.hits}/${pv.n} — RETIRED, ITS PROBABILITY WAS A CONSTANT`
    : "";
  if(s.wardenRec&&s.wardenRec.n>0){const r=s.wardenRec;
    $("wrecN").textContent=(r.n>=WMIN
      ? `RECORD · ${r.n} SETTLED CALLS · ${r.hits} RIGHT (${Math.round(r.hits/r.n*100)}%) · BRIER ${(r.brier/r.n).toFixed(3)} — WINS AND LOSSES ALIKE`
      : `RECORD · ${r.hits} RIGHT OF ${r.n} SETTLED — TOO FEW TO SCORE. RATE AND BRIER APPEAR AT ${WMIN} CALLS, BECAUSE ${r.n} IS NOT A TRACK RECORD`)+prevTxt;}
  else $("wrecN").textContent="RECORD · THIS MODEL HAS NOT SETTLED A CALL YET — IT ACCRUES FROM THE FIRST, WINS AND LOSSES ALIKE"+prevTxt;
  // player
  const p=s.player;
  if(p){
    $("hR").textContent=p.rank;$("hB").textContent=p.rank[0];$("mB").textContent=p.rank[0];
    $("hCr").textContent=Math.floor(p.cr||0).toLocaleString();
    // $RCX beside CREDITS. Holding the token is the on-ramp to everything —
    // credits, ranking, the podium — and it was the one number the page never
    // showed a connected holder.
    { const w=$("hRcxWrap"), b=$("hRcx"), r=p.rcx;
      if(w&&b){
        if(AUTH&&r){ w.classList.remove("hide"); w.href=SCAN+AUTH.wallet;
          b.textContent = r.bal==null ? "—" : r.bal.toLocaleString();
          b.style.color = r.bal==null ? "var(--dim)" : "var(--gold)";
          w.title = r.bal==null ? "the chain did not answer — this is not a balance of zero"
                  : (r.stale?"last known balance":"on-chain balance"); }
        else w.classList.add("hide");
      } }
    $("hS").textContent=p.streak+"🔥";
      if($("hShots")) $("hShots").textContent=p.shots||0;
      if($("hWinPct")) $("hWinPct").textContent=(p.shots?(p.hits||0)/p.shots*100:0).toFixed(1)+"%";
    const curTh=[0,300,900,2200,5000][p.rankIdx]||0;
    $("hX").style.width=(p.next?Math.max(0,Math.min(100,(p.xp-curTh)/(p.next[1]-curTh)*100)):100)+"%";
    $("mR").textContent=p.rank+(DEMO?" · DEMO (UNRANKED)":"");
    $("mN").textContent=p.next?`${p.next[1]-p.xp} XP to ${p.next[0]} · ${p.chambers} chambers`:"MAX RANK";
    $("mXP").textContent=p.xp;$("mBest").textContent=p.best;
    // A BARE PERCENTAGE WITH NO DENOMINATOR NEXT TO IT.
    // One settled shot that landed used to render as "100%" under the word
    // ACCURACY, in the same row as XP and BEST STREAK, with the count living
    // in a different panel further down. Under about ten shots the fraction
    // IS the honest figure and the percentage is theatre, so show the
    // fraction until there is enough to divide.
    $("mAcc").textContent=!p.shots?"—":p.shots<10?`${p.hits}/${p.shots}`:Math.round(p.hits/p.shots*100)+"%";
    { const lab=$("mAccL"); if(lab) lab.textContent=p.shots&&p.shots<10?"HITS / SHOTS":"ACCURACY"; }
    // A streak is only a mechanic if you can see what it is currently worth
    // and therefore what a miss would cost you.
    const sr=stakeRule(), sm=Math.min(sr.streakCap||2,1+(p.streak||0)*(sr.streakStep||0.15));
    const sEl=$("mBest");
    if(sEl&&sEl.parentElement){
      let tag=document.getElementById("streakTag");
      if(!tag){tag=document.createElement("div");tag.id="streakTag";
        tag.style.cssText="font:700 9px/1.4 var(--mono);letter-spacing:.08em;margin-top:3px";
        sEl.parentElement.appendChild(tag);}
      tag.innerHTML=(p.streak>0&&sm>1)
        ? `<span style="color:var(--gold)">NEXT HIT ×${sm.toFixed(2)} XP</span>`
        : `<span style="color:var(--dim)">BUILD A RUN FOR BONUS XP</span>`;
    }
    $("chC").textContent=`${p.open.length} / ${p.chambers}`;
    const rows=[...p.open.map(c=>{
      const sd=c.side||SIDES[c.id];
      const L=liveShot(c,sd);
      const canMirror=AUTH&&STATE.mirror&&STATE.mirror.enabled&&(STATE.mirror.feeds||[]).includes(c.feed)&&['dir','thr','thrDown'].includes(c.kind)&&c.id&&c.commit&&!c.mirrored;
      const mirror=c.mirrored
        ? '<div class="mirrorRow"><span style="color:var(--ice);font:700 9.5px var(--mono);letter-spacing:.05em">⚓ SEALED ON-CHAIN</span></div>'
        : canMirror?`<div class="mirrorRow"><button class="mirrorb shareb" data-id="${c.id}" data-feed="${c.feed}" data-exp="${c.exp}" data-kind="${c.kind}" data-thresh="${c.thresh||0}" data-pct="${c.pct||0}" data-feed2="${c.feed2||''}" data-commit="${c.commit}" style="border-color:var(--ink2);color:var(--ice)">SEAL ON-CHAIN · BETA</button></div>`:'';
      return`<div class="cham${L.cls}"><div class="ch1"><span>${L.head}</span><span class="cd" data-exp="${c.exp}">…</span></div>
        <div class="ch2">${c.label} — <b>${sd?sd:"🔒 side sealed"}</b> · entry $${fmtCmp(c.entry)}</div>
        ${L.bar}${mirror}</div>`;}),
      ...p.closed.slice(0,3).map(c=>`<div class="cham ${c.res}" data-settled="${c.id||''}" data-path="${c.feed||''}" data-from="${c.t||''}" data-to="${c.settledAt||c.exp||''}" data-entry="${c.entry||''}" data-exit="${c.exitPx||''}"><div class="ch1"><span>${c.res==="hit"?"HIT ✓":c.res==="miss"?"MISS ✕":"VOID — refunded"}</span><span>${c.side}</span></div>
        <div class="ch2">${c.label}</div>
        <div class="xps" style="color:${c.res==='hit'?'var(--grn)':c.res==='miss'?'var(--red)':'var(--dim)'}">${settlementReceipt(c)}${settlementMargin(c)}${
          AUTH&&c.id?` <button class="shareb" data-share="${c.id}">SHARE PROOF</button>`:''}</div></div>`)];
    

    setHTML($("chams"),rows.length?rows.join(""):'<div class="empty">EMPTY — FIRE A SHOT</div>');
    drawPaths();
    scanSettlements(p);
    if(p.history&&p.history.length){$("histP").style.display="block";
      $("histN").textContent=` · ${p.hits}/${p.shots} LIFETIME · BEST STREAK ${p.best}`;
      setHTML($("histRows"),p.history.map(e=>{
        const d=new Date(e.t);
        const col=e.res==='hit'?'var(--grn)':e.res==='miss'?'var(--red)':'var(--dim)';
        return`<div class="kl"><span class="t">${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}</span>
          <span style="color:${col};width:40px;flex:none;font-weight:800">${e.res.toUpperCase()}</span>
          <span style="flex:1">${e.label} — <b>${e.side}</b> ${missMargin(e)}</span>
          <span style="color:${col};font-weight:700;white-space:nowrap">${settlementReceipt(e)}</span></div>`;}).join(""));}
    else if($("histP"))$("histP").style.display="none";
    // A guest who has just watched a shot settle is the only moment worth
    // interrupting. Once, ever, and never again.
    if(!AUTH&&p.history&&p.history.length&&!localStorage.getItem("ratchet_asked")){
      localStorage.setItem("ratchet_asked","1");
      const won=p.history[0]&&p.history[0].res==="hit";
      toast(won?"You called that one right — connect a wallet to make the next one count: XP, ladders, pots and real $RCX."
               :"That one settled against you. Connect a wallet and the next one counts for XP, the ladders and the pots.");
    }
    if(p.champion&&STATE.champ){const c=p.champion;
      $("champP").style.display="block";
      const hist=(c.history||[]).slice(0,12).map(x=>{
        const when=x.t?new Date(x.t).toLocaleString():"—";
        const tx=x.id?` · <a href="https://solscan.io/tx/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" style="color:var(--ice)">tx ↗</a>`:"";
        if(x.kind==="received") return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b style="color:var(--grn)">+${Number(x.rcx||0).toLocaleString()} RCX RECEIVED</b> · from ${esc(x.from||"another reloader")}${tx}<span style="float:right;color:var(--dim)">${esc(when)}</span></div>`;
        return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b style="color:var(--gold)">YOUR RELOAD</b> · ${Number(x.burned||0).toLocaleString()} burned · ${Number(x.credits||0).toLocaleString()} credits${x.retained?` · <b style="color:var(--grn)">${Number(x.retained).toLocaleString()} RCX stayed with you</b>`:""}${x.podiumPaid?` · ${Number(x.podiumPaid).toLocaleString()} paid to other champions`:""}${tx}<span style="float:right;color:var(--dim)">${esc(when)}</span></div>`;
      }).join("");
      $("champTitle").textContent=c.active?(c.source==="previous"?"CHAMPION CONSOLE — DEFENDING SEAT":"CHAMPION CONSOLE — LIVE SEAT TODAY"):"PODIUM RECEIPTS — LAST 7 DAYS";
      $("champBody").innerHTML=`${c.active?`Your ${c.source==="previous"?"inherited":"live"} seat currently receives <b style="color:var(--gold)">${Math.round(c.pct*STATE.champ.pct*100)}% of each reload</b>. ${c.source==="previous"?"It remains only while today's ladder has an empty seat.":"A settled XP change can move its rank immediately."}`:`You are not in the current payout set, but your recent receipts remain visible.`}<br>
      From other players' reloads: <b style="color:var(--grn)">${Number(c.received7||0).toLocaleString()} RCX</b> ·
      kept in your wallet on your own reloads: <b style="color:var(--gold)">${Number(c.retained7||0).toLocaleString()} RCX</b> ·
      total podium value: <b style="color:var(--ink)">${Number(c.total7||0).toLocaleString()} RCX</b>.<br>
      <span style="color:var(--dim)">Seats follow today's settled XP; yesterday only fills empty seats. No hold requirement, sell condition or forfeiture.</span>      ${hist?`<div style="margin-top:9px;font:600 10px/1.45 var(--mono)">${hist}</div>`:`<div style="margin-top:8px;color:var(--dim)">No reload receipts in this account yet.</div>`}`;}
    else $("champP").style.display="none";
    const r=p.rankIdx;
    $("rkrow").innerHTML=[["COG",0],["PISTON",300],["FLYWHEEL",900],["TURBINE",2200],["REACTOR",5000]]
      .map((k,i)=>`<div class="rkc ${i===r?'now':''}"><b style="color:${i<=r?'var(--gold)':'var(--dim)'}">${k[0]}</b><span>${k[1]} XP</span></div>`).join("");
  }
  // reload panel
  if(s.mint&&AUTH){$("reloadP").style.display="block";$("incin").textContent=s.incinerator;
    const cl=(s.champ&&s.champ.podium)||[];
    $("podiumBox").style.display="block";
    $("podiumBox").innerHTML=cl.length
      ?"THIS RELOAD PAYS THE CURRENT SNAPSHOT: "+cl.map((c,i)=>`${i+1}. <span style="color:var(--gold)">${c.w}</span> ${Math.round((s.champ.pct*c.pct)*100)}% <span style="color:var(--dim)">${c.source==="today"?"TODAY":"PREVIOUS-DAY FALLBACK"}</span>`).join(" · ")+" — THE REST🔥 BURNS"
      :"NO CURRENT OR PREVIOUS-DAY PODIUM — ALL OF THIS RELOAD🔥 BURNS";}  else $("reloadP").style.display="none";
  { const g=$("getRcxRow");
    if(g){ const u=buyUrl();
      // Only when it is the actual next step — a prompt to buy shown to
      // someone who already holds plenty is just noise.
      // Only to someone who genuinely holds none, and never while the
      // balance is unreadable.
      const none = holdsRcx(p) === false;
      g.innerHTML=(u&&none)?`<span style="font:600 9.5px var(--mono);letter-spacing:.06em;color:var(--dim)">NO $RCX YET?</span> ${buyBtn("GET SOME")}`:""; } }
  if(s.mint&&AUTH){ setBurnSol(solAmt); setBurnRcx(burnAmt); }
  // feed + ladder
  const fx=el=>setHTML(el,s.feed.map(f=>{
    const d=new Date(f.t);
    // every money event carries its signature: the feed line IS the receipt
    const tx=f.sig?` · <a href="https://solscan.io/tx/${f.sig}" target="_blank" rel="noopener" style="color:var(--ice);text-decoration:none">tx ↗</a>`:"";
    return`<div class="kl"><span class="t">${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}</span>
      <span class="wl">${f.w}</span><span style="color:${f.c==='hit'?'var(--grn)':f.c==='miss'?'var(--red)':'var(--ink2)'}">${f.a}${tx}</span></div>`}).join("")||'<div class="empty">QUIET — BE FIRST</div>');
  fx($("kill"));fx($("duelfeed"));
  $("seas").textContent=s.season.toUpperCase();
  $("potN").textContent=" · POT "+Math.floor(s.stats.pot||0).toLocaleString()+" 🔥";
  $("dayK").textContent=(s.day||"").toUpperCase();
  $("potDN").textContent=" · POT "+Math.floor(s.stats.potD||0).toLocaleString()+" 🔥";
  setHTML($("ladderDay"),(s.ladderDay&&s.ladderDay.length)?s.ladderDay.map((l,i)=>`
    <div class="lr ${l.me?'me':''}"><span class="pos">${i+1}</span><span class="wl2">${l.me?'YOU':l.w}</span><span class="sc">${l.xp} XP</span></div>`).join("")
    :'<div class="empty" style="margin:6px 0">NOBODY ON TODAY\'S LADDER YET — FIRST HIT LEADS</div>');
  if(s.lastDay&&s.lastDay.winners&&s.lastDay.winners.length){
    $("lastDayP").style.display="block";
    $("lastDay").innerHTML=s.lastDay.winners.map((v,i)=>`
      <div class="lr"><span class="pos">${i+1}</span><span class="wl2">${v.w}</span>
      <span class="sc" style="color:var(--gold)">+${v.share.toLocaleString()} 🔥</span></div>`).join("")+
      (s.lastDay.rolled>0?`<div style="font:600 9.5px var(--mono);color:var(--dim);padding:8px 14px">+ ${s.lastDay.rolled.toLocaleString()} ROLLED INTO TODAY</div>`:"");
  }
  if(s.lastSeason&&s.lastSeason.winners&&s.lastSeason.winners.length){
    $("lastSeasonP").style.display="block";
    $("lastSeason").innerHTML=s.lastSeason.winners.map((v,i)=>`
      <div class="lr"><span class="pos">${i+1}</span><span class="wl2">${v.w}</span>
      <span class="sc" style="color:var(--gold)">+${v.share.toLocaleString()} 🔥</span></div>`).join("")+
      (s.lastSeason.rolled>0?`<div style="font:600 9.5px var(--mono);color:var(--dim);padding:8px 14px">+ ${s.lastSeason.rolled.toLocaleString()} ROLLED INTO THIS SEASON</div>`:"");
  }
  // stake tab
  const si=p&&p.stakeInfo;
  if(!AUTH||!s.mint){$("stakeBtn").disabled=true;$("stakeBtn").textContent=!s.mint?"ARMS AT TGE":"CONNECT A REAL WALLET TO STAKE";}
  else{$("stakeBtn").disabled=false;
    $("stakeBtn").textContent=si&&si.on?"UNMESH — STOP EARNING":"MESH MY GEARS — START EARNING";}
  $("stakeMe").innerHTML=!AUTH?"Connect a real wallet, then mesh your gears."
    :si&&si.on?`STATUS <b style="color:var(--grn)">MESHED ⚙</b><br>
      On-chain balance: ${si.bal==null
        ? '<b style="color:var(--dim)">unreadable right now</b>'
        : `<b>${si.bal.toLocaleString()} RCX</b>${si.balStale?' <span style="color:var(--dim)">· last known</span>':''}`}<br>
      Today's output: ${si.perDay==null
        ? '<b style="color:var(--dim)">—</b> <span style="color:var(--dim)">yield waits until your balance can be read; the day is not spent</span>'
        : `<b style="color:var(--gold)">${si.perDay.toLocaleString()} credits/day</b>`}<br>
      Earned so far: <b style="color:var(--gold)">${si.earned.toLocaleString()} credits</b><br>
      <span style="color:var(--dim)">${si.bal==null?"Nothing is lost while this is unreadable — the day only counts once we have read your balance."
        :si.bal<si.minBal?"Below "+si.minBal.toLocaleString()+" RCX — hold more to produce output.":"Yield lands on your first visit each day (UTC)."}</span>`
    :`STATUS <b style="color:var(--dim)">UNMESHED</b><br><span style="color:var(--dim)">One click to register — your tokens never move.</span>`;
  $("stakeGlob").innerHTML=`Wallets meshed: <b>${(s.stats.stakers||0).toLocaleString()}</b><br>
    Credits paid to stakers: <b style="color:var(--gold)">${(s.stats.stakePaid||0).toLocaleString()}</b><br>
    <span style="color:var(--dim)">Rate: 0.1%/day of held balance · min 1,000 · counted up to 1,000,000.</span>`;
  drawPodium(s);
  setHTML($("ladderAll"),(s.ladderAll&&s.ladderAll.length)?s.ladderAll.map((l,i)=>`
    <div class="lr ${l.me?'me':''}"><span class="pos">${i+1}</span><span class="wl2">${l.me?'YOU':l.w}</span><span class="sc">${l.xp} XP</span></div>`).join("")
    :'<div class="empty" style="margin:6px 0">NO ALL-TIME RANKED XP YET</div>');
  setHTML($("ladder"),s.ladder.length?s.ladder.map((l,i)=>`
    <div class="lr ${l.me?'me':''}"><span class="pos">${i+1}</span><span class="wl2">${l.me?'YOU':l.w}</span><span class="sc">${l.xp} XP</span></div>`).join("")
    :'<div class="empty" style="margin:6px 0">NOBODY ON THE LADDER YET — SEASON '+s.season.toUpperCase()+'</div>');
}
// the multiplier is sqrt(stake/min) — the same curve the server scores with, so
// the number on screen can never disagree with the number you are awarded.
const stakeRule=()=>(STATE&&STATE.stakeRule)||{min:100,max:100000,xpMultCap:20,xpCapAt:40000};
// mirrors the server exactly: sqrt growth, then a hard ceiling
const stakeMult=st=>{const r=stakeRule();return Math.min(r.xpMultCap||20,Math.sqrt(st/r.min));};
// THE FLEET. Four named agents, published methods, public records including
// their losses. They are opponents, not players — nothing they do touches a
// ladder, a pot or a counter.
function fleet(){
  const box=$("fleetBox"); if(!box||!STATE||!STATE.agents)return;
  const f=STATE.agents.fleet||[], open=STATE.agents.open||[];
  const n=$("fleetN"); if(n)n.textContent=f.length?`${f.length} AGENTS · ${f.reduce((a,x)=>a+x.n,0)} CALLS SETTLED`:"";
  const html=f.map(a=>{
    const mine=open.filter(o=>o.agent===a.id);
    // Same rule the ARENA panel below applies to guests: no percentage
    // until there are enough calls for one to mean anything.
    const acc=a.acc==null?'<span style="color:var(--dim)">NO RECORD YET</span>'
      :a.listed===false
        ?`<span style="color:var(--dim)">${a.hits}/${a.n} · UNRANKED, ${Math.max(0,(a.minCalls||10)-a.n)} MORE CALLS</span>`
        :`<span style="color:${a.acc>=50?'var(--grn)':'var(--red)'}">${a.acc}%</span> <span style="color:var(--dim)">(${a.hits}/${a.n})</span>`;
    const call=mine.length?mine.map(o=>
      `<span style="color:var(--dim)">OPEN CALL:</span> ${o.label} — <b style="color:${o.side==='YES'?'var(--grn)':'var(--red)'}">${o.side}</b>`
      +` · <span class="cd" data-exp="${o.exp}"></span>`).join("<br>")
      :'<span style="color:var(--dim)">no open call this hour</span>';
    return `<div class="agrow"><span class="an">${esc(a.name)}</span><span class="ac">${acc}</span>`+
      `<span class="ab">${esc(a.blurb)}</span><span class="call">${call}</span></div>`;
  }).join("");
  setHTML(box,html||'<span style="color:var(--dim)">the fleet has not woken up yet</span>');
}

// CHALLENGES. Written by players, taken by players, settled by the same
// oracle as everything else. Polled on its own slow interval — an offer board
// does not need six-second freshness, and the accept path re-checks anyway.
let CHALS=null;
const FEEDS_UI=["SOL","BTC","ETH","BONK","WIF","JUP","PUMP"];
async function loadChals(){
  try{ const r=await fetch(API+"?action=challenges"); const j=await r.json();
    if(j.ok){ CHALS=j; drawChals(); } }catch{}
}
function drawChals(){
  const box=$("chalBox"); if(!box||!CHALS)return;
  const open=CHALS.open||[];
  const n=$("chalN"); if(n)n.textContent=open.length?`${open.length} OPEN`:"NONE OPEN";
  if(!open.length){
    setHTML(box,'<span style="color:var(--dim)">Nobody has posted one. Write the question you think '+
      'the room has wrong — it costs you the stake only if somebody takes it.</span>');
    return;
  }
  const me=AUTH&&AUTH.wallet;
  setHTML(box, open.map(c=>{
    const mine=me&&shortW_eq(c.by,me);
    const left=Math.max(0,Math.round((c.expiresAt-Date.now())/60000));
    const opposite=c.side==="YES"?"NO":"YES";
    return `<div class="crow"><div>
      <div class="cl">${c.label}</div>
      <div class="cm">${c.by} SAYS <b style="color:${c.side==="YES"?"var(--grn)":"var(--red)"}">${c.side}</b>`+
      ` · ${c.stake.toLocaleString()} EACH · EXPIRES IN ${left}M</div></div>`+
      (mine?'<span class="cm">YOURS</span>'
           :`<button class="takeb" data-take="${c.id}" ${AUTH?"":"disabled"}>TAKE ${opposite}</button>`)+
      `</div>`;
  }).join(""));
}
// the board only ever shows a shortened author, so compare on that
function shortW_eq(shortA, full){ return shortA === short(full); }

(()=>{
  const f=$("cFeed"); if(f&&!f.options.length)
    for(const x of FEEDS_UI){ const o=document.createElement("option"); o.value=o.textContent=x; f.appendChild(o); }
  const k=$("cKind"), pct=$("cPct");
  if(k) k.onchange=()=>{ if(pct) pct.style.display = k.value==="dir" ? "none" : "block"; };
  const go=$("cGo");
  if(go) go.onclick=async()=>{
    const err=$("cErr"); if(err)err.textContent="";
    if(!AUTH){ if(err)err.textContent="connect a real wallet first"; return; }
    go.disabled=true;
    try{
      const body={ action:"challenge", auth:AUTH, kind:$("cKind").value, feed:$("cFeed").value,
        mins:Math.round(+$("cMins").value||0), stake:Math.round(+$("cStake").value||0),
        side:$("cSide").value };
      if(body.kind!=="dir") body.pct=(+$("cPct").value||0)/100;
      const j=await post(body);
      if(j.ok){ toast("Challenge posted — it costs you nothing unless somebody takes it"); loadChals(); refresh(); }
      else if(err) err.textContent=j.reason||"refused";
    }catch(e){ if(err)err.textContent=String(e.message||e); }
    go.disabled=false;
  };
})();

document.addEventListener("click", async e=>{
  const b=e.target.closest&&e.target.closest("[data-take]");
  if(!b||!AUTH)return;
  b.disabled=true;
  try{
    const j=await post({ action:"accept", auth:AUTH, id:b.dataset.take });
    if(j.ok) toast(`Taken against ${j.against} — both sides struck at $${fmtCmp(j.struckAt)}`);
    else toast(j.reason||"could not take it");
  }catch(err){ toast(String(err.message||err)); }
  loadChals(); refresh();
});
loadChals(); setInterval(loadChals, 30000);

// THE ARENA. Fetched separately from state and polled slowly: it is not on the
// six-second path and an empty arena costs one read.
let ARENA=null;
async function loadArena(){
  try{ const r=await fetch(API+"?action=arena"); const j=await r.json(); if(j.ok){ARENA=j;drawArena();} }catch{}
}
function drawArena(){
  const box=$("arenaBox"); if(!box||!ARENA)return;
  const rows=ARENA.agents||[];
  const n=$("arenaN");
  if(n)n.textContent=rows.length?`${rows.length} REGISTERED · ${rows.filter(a=>a.listed).length} RANKED`:"OPEN";
  if(!rows.length){
    setHTML(box,'<span style="color:var(--dim)">No agents registered yet. The four house agents above are '+
      'the ones to beat — and one of them is currently losing badly.</span>');
    return;
  }
  setHTML(box, rows.map(a=>{
    // The ranking was already gated on `listed`, but the PERCENTAGE was
    // printed anyway — a green 100% beside the caveat, on a CORS-open feed
    // we describe as a record that is not self-reported. Gate the figure too.
    const acc=a.acc==null?'<span style="color:var(--dim)">NO RECORD YET</span>'
      :a.listed
        ?`<span style="color:${a.acc>=50?'var(--grn)':'var(--red)'}">${a.acc}%</span> `+
         `<span style="color:var(--dim)">(${a.hits}/${a.n})</span>`
        :`<span style="color:var(--dim)">${a.hits}/${a.n}</span>`;
    const rank=a.listed?"":' <span style="color:var(--dim)">· UNRANKED, '+Math.max(0,ARENA.minCalls-a.n)+' MORE CALLS</span>';
    // No Brier column. It was mean((0.5-outcome)^2) over a flat prior, which
    // is exactly 0.25 for every agent at every record — a constant printed to
    // four decimals. It comes back when agents can state a confidence.
    return `<div class="agrow"><span class="an">${esc(a.name)}</span><span class="ac">${acc}${rank}</span>`+
      `<span class="ab">${a.blurb?esc(a.blurb):"&nbsp;"}</span>`+
      `<span class="call"><span style="color:var(--dim)">${a.n} SETTLED · ${esc(a.w)}</span></span></div>`;
  }).join(""));
}
loadArena(); setInterval(loadArena, 60000);

// THE PATH YOUR SHOT ACTUALLY TOOK.
// Drawn from the same recorded oracle samples that settled it — so this is not
// an illustration of the result, it IS the result, plotted. The dot is the
// print that decided it. Fetched once per settled shot and cached.
const PATHS={};
async function drawPaths(){
  for(const el of document.querySelectorAll('.cham[data-path]')){
    const feed=el.dataset.path, from=+el.dataset.from, to=+el.dataset.to;
    if(!feed||!from||!to||el.querySelector('.spark'))continue;
    const key=feed+from+to;
    let rows=PATHS[key];
    if(rows===undefined){
      PATHS[key]=null;
      try{ const r=await fetch(`${API}?action=path&feed=${feed}&from=${from}&to=${to}`);
        const j=await r.json(); rows=PATHS[key]=(j.ok&&j.path)||[]; }catch{ rows=PATHS[key]=[]; }
    }
    if(!rows||rows.length<2)continue;
    el.insertAdjacentHTML('beforeend',sparkline(rows,+el.dataset.entry,+el.dataset.exit,to));
  }
}
function sparkline(rows,entry,exit,settleAt){
  const W=260,H=34,pad=3;
  const ys=rows.map(r=>r[1]).concat(Number.isFinite(entry)?[entry]:[]);
  const lo=Math.min(...ys), hi=Math.max(...ys), span=(hi-lo)||1;
  const t0=rows[0][0], t1=rows[rows.length-1][0], tspan=(t1-t0)||1;
  const X=t=>pad+((t-t0)/tspan)*(W-pad*2);
  const Y=v=>H-pad-((v-lo)/span)*(H-pad*2);
  const d=rows.map((r,i)=>(i?'L':'M')+X(r[0]).toFixed(1)+' '+Y(r[1]).toFixed(1)).join(' ');
  const up=exit>=entry;
  const col=up?'var(--grn)':'var(--red)';
  const base=Number.isFinite(entry)
    ? `<line x1="${pad}" y1="${Y(entry).toFixed(1)}" x2="${W-pad}" y2="${Y(entry).toFixed(1)}"
        stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>` : '';
  // the sample at or after expiry is the one settlement used
  const dec=rows.find(r=>r[0]>=settleAt)||rows[rows.length-1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="oracle path">
    ${base}<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="${X(dec[0]).toFixed(1)}" cy="${Y(dec[1]).toFixed(1)}" r="2.6" fill="${col}"/></svg>`;
}

// A settled shot is public, checkable data — the side and salt are revealed
// at settlement precisely so anyone can recompute the hash. Giving it a URL
// is the difference between "I called that" and something a stranger can
// verify without trusting either of us.
document.addEventListener("click", async e => {
  const b = e.target.closest && e.target.closest("[data-share]");
  if (!b || !AUTH) return;
  const url = `${location.origin}/api/shot?w=${encodeURIComponent(AUTH.wallet)}&id=${encodeURIComponent(b.dataset.share)}`;
  try { await navigator.clipboard.writeText(url); toast("Proof link copied — anyone can recompute it"); }
  catch { window.open(url, "_blank", "noopener"); }
});

// ============================================================
//  YOU HAVE TO FIND OUT.
//
//  Settlement is lazy and windows run from two minutes to a day, so the
//  moment a shot resolves is almost never a moment you are looking at the
//  page. Until now that moment was invisible: the card quietly changed and
//  the only way to learn anything was to come back and read a list. A game
//  whose payoff you can miss entirely is a form you submitted.
//
//  Three levels, cheapest first, and none of them needs a server:
//    · the tab title, always — costs nothing, asks nothing
//    · a real notification, only if you granted it
//    · a flash on the card, when you are actually looking
//
//  The permission ask is deliberately NOT on page load. Asking a stranger
//  for notification rights before they have played is the pattern everyone
//  denies by reflex. We ask once, after your first shot settles, when the
//  question means something.
// ============================================================
const SETTLED_SEEN = new Set();
let settleReady = false;     // first paint records history without announcing it
let pendingSettles = 0;
const BASE_TITLE = document.title;

function markTitle(){
  document.title = pendingSettles > 0 && document.hidden
    ? `(${pendingSettles}) SETTLED · RATCHET` : BASE_TITLE;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { pendingSettles = 0; markTitle(); }
});

function announceSettle(e){
  const hit = e.res === "hit", vd = e.res === "void";
  const head = vd ? "VOID — stake refunded" : hit ? "HIT ✓" : "MISS ✕";
  const body = `${e.label} · ${settlementReceipt(e).replace(/<[^>]*>/g,"")}`;
  pendingSettles++; markTitle();
  try{
    if (window.Notification && Notification.permission === "granted")
      new Notification(`RATCHET — ${head}`, { body, tag: "ratchet-"+e.id });
  }catch{}
  // if they ARE looking, the card itself should do the announcing
  requestAnimationFrame(()=>{
    const el=document.querySelector(`.cham[data-settled="${e.id}"]`);
    if(el){ el.classList.remove("justsettled"); void el.offsetWidth; el.classList.add("justsettled"); }
  });
  offerNotifications();
}

// One ask, ever, and only once something has actually settled.
function offerNotifications(){
  if(!window.Notification || Notification.permission !== "default") return;
  if(localStorage.getItem("ratchet_notif_asked")) return;
  const bar=$("mode"); if(!bar) return;
  localStorage.setItem("ratchet_notif_asked","1");
  bar.style.display="block";
  bar.innerHTML = `A shot just settled while you were here. Want to know when the next one does? `+
    `<button id="notifYes" class="connect" style="padding:5px 12px;font-size:10px;margin-left:8px">TELL ME</button>`;
  const btn=$("notifYes");
  if(btn) btn.onclick=async()=>{
    // requestPermission must come from a click, which is also the only
    // honest place to ask from.
    try{ await Notification.requestPermission(); }catch{}
    bar.style.display="none"; if(window.STATE)paint();
  };
}

function scanSettlements(p){
  const rows=[...(p.closed||[]), ...(p.history||[])];
  for(const e of rows){
    if(!e || !e.id || !e.res || e.res==="open") continue;
    if(SETTLED_SEEN.has(e.id)) continue;
    SETTLED_SEEN.add(e.id);
    if(settleReady) announceSettle(e);
  }
  settleReady = true;
}

// A SEALED SHOT SHOULD BE WATCHABLE.
// It used to be a line of text and a countdown, so the only way to find out
// what happened was to leave and come back. Everything below is derived from
// the price already on the page and the shot's own terms — no new request, and
// no information the owner does not already hold. A spectator (no side) sees
// the market, never a verdict.
function liveShot(c,side){
  const px=STATE&&STATE.prices?STATE.prices[c.feed]:null;
  const blank={cls:"",head:"SEALED 🔒",bar:""};
  if(!Number.isFinite(px)||!Number.isFinite(c.entry))return blank;
  const pct=v=>(v>=0?"+":"")+(v*100).toFixed(2)+"%";
  let need=null,now=null,label="",yes=null;
  if(c.kind==="thr"&&Number.isFinite(c.thresh)){
    yes=px>c.thresh; need=c.thresh; now=px;
    label=`$${fmtCmp(px)} · needs $${fmtCmp(c.thresh)} · ${pct((px-c.thresh)/c.thresh)} away`;
  }else if(c.kind==="thrDown"&&Number.isFinite(c.thresh)){
    yes=px<c.thresh; need=c.thresh; now=px;
    label=`$${fmtCmp(px)} · needs below $${fmtCmp(c.thresh)} · ${pct((px-c.thresh)/c.thresh)} away`;
  }else if(c.kind==="range"&&Number.isFinite(c.pct)){
    const d=Math.abs((px-c.entry)/c.entry); yes=d>=c.pct;
    label=`moved ${pct(d)} of the ±${(c.pct*100).toFixed(2)}% band`;
  }else if(c.kind==="race"&&Number.isFinite(c.entry2)){
    const p2=STATE.prices[c.feed2];
    if(!Number.isFinite(p2))return blank;
    const a=(px-c.entry)/c.entry,b=(p2-c.entry2)/c.entry2; yes=a>b;
    label=`${c.feed} ${pct(a)} vs ${c.feed2} ${pct(b)}`;
  }else{
    const chg=(px-c.entry)/c.entry; yes=chg>0;
    label=`$${fmtCmp(px)} · ${pct(chg)} since seal`;
  }
  // Without the side we can describe the market but must not call it.
  if(!side)return{cls:"",head:"SEALED 🔒",
    bar:`<div class="live"><span class="lt" style="color:var(--dim)">${label}</span></div>`};
  const winning=(side==="YES")===yes;
  return{ cls: winning?" up":" down",
    head: winning?'<span style="color:var(--grn)">AHEAD ▲</span>':'<span style="color:var(--red)">BEHIND ▼</span>',
    bar:`<div class="live"><span class="lt" style="color:${winning?"var(--grn)":"var(--red)"}">${label}</span></div>` };
}

// The margin is the difference between "you lost" and "you were nearly right",
// and only one of those makes anyone fire again.
function missMargin(e){
  if(!Number.isFinite(e.entry)||!Number.isFinite(e.exit))return "";
  const d=(e.exit-e.entry)/e.entry;
  return `<span style="color:var(--dim)">· moved ${(d>=0?"+":"")+(d*100).toFixed(2)}%</span>`;
}

function settlementMargin(e){
  const indicative=e.res==='void'&&e.indicativePx!=null&&Number.isFinite(+e.indicativePx);
  const px=indicative?+e.indicativePx:(e.exitPx!=null&&Number.isFinite(+e.exitPx)?+e.exitPx:e.exit!=null&&Number.isFinite(+e.exit)?+e.exit:null);
  if(!Number.isFinite(px))return '';
  let detail='';
  if((e.kind==='thr'||e.kind==='thrDown')&&Number.isFinite(+e.thresh)){
    const d=(px-(+e.thresh))/(+e.thresh)*100;
    detail=`${Math.abs(d).toFixed(2)}% ${d>=0?'ABOVE':'BELOW'} TARGET`;
  }else if(e.kind==='range'&&Number.isFinite(+e.entry)&&Number.isFinite(+e.pct)){
    const move=Math.abs((px-(+e.entry))/(+e.entry))*100, target=(+e.pct)*100;
    detail=`MOVE ${move.toFixed(2)}% · ${Math.abs(move-target).toFixed(2)}% FROM BAND`;
  }else if(Number.isFinite(+e.entry)){
    const move=(px-(+e.entry))/(+e.entry)*100;
    detail=`MOVE ${move>=0?'+':''}${move.toFixed(2)}% FROM ENTRY`;
  }
  if(!detail)return '';
  return indicative
    ? ` · <span style="color:var(--gold)">INDICATIVE ${detail} · NOT USED TO SETTLE</span>`
    : ` · <span style="color:var(--dim)">${detail}</span>`;
}

function settlementReceipt(e){
  if(e.res==='void') return `0 XP · +${Number(e.stake||0).toLocaleString()} CREDITS REFUND`;
  const legacyMiss=e.res==='miss'&&(e.settleXp==null||!Number.isFinite(+e.settleXp));
  const xp=legacyMiss?0:(Number(e.xp)||0), credits=Number(e.back)||0;
  if(e.res==='hit'){
    const split=Number.isFinite(+e.settleXp)&&Number.isFinite(+e.skillXp)&&(+e.settleXp||+e.skillXp)
      ? ` <span style="color:var(--dim)">(${+e.settleXp} PLAY + ${+e.skillXp} SKILL)</span>` : '';
    const streak=e.streakMult>1?` <span style="color:var(--gold)">×${e.streakMult} STREAK</span>`:'';
    return `+${xp} XP${split}${streak} · +${credits.toLocaleString()} CREDITS`;
  }
  return `+${xp} XP · +0 CREDITS · STREAK RESET`;
}

// YOUR LIVE POSITION. A ladder nobody can see themselves on is decoration.
// WHERE TO GET $RCX.
// The qualification rule was right — free keypairs were farming a podium that
// pays real tokens — but a wall without a door beside it is just a wall. Every
// dead end below now carries the next step.
//
// Deliberately a link and not an embedded swap widget: the widget is slicker
// and it means running somebody else's script on the page where people sign
// wallet transactions. The whole claim here is that there is nothing to trust.
// A new tab costs one click and keeps that literally true.
function buyUrl(){
  const m=STATE&&STATE.mint;
  return m?`https://pump.fun/coin/${m}`:null;
}
// TRUE / FALSE / NULL — and null is not false.
// Every "get some $RCX" prompt used to key off the CREDITS balance, so a
// wallet holding 148,702 RCX with zero credits was told it had no RCX at all.
// Holding the token and having credits are different things: credits come
// from burning what you hold. And if the chain could not be read we say
// nothing rather than tell a holder to go buy more.
function holdsRcx(p){
  const r = p && p.rcx;
  if (!r) return null;
  if (r.bal == null) return null;
  return r.bal > 0;
}
function openJupiter() {
  window.open(buyUrl(), "_blank", "noopener,noreferrer");
}
function reloadBtn(label){
  return `<button onclick="document.querySelector('[data-go=play]').click();`
    + `document.getElementById('reloadP').scrollIntoView({behavior:'smooth',block:'center'});`
    + `document.getElementById('reloadP').animate([{outline:'2px solid var(--gold)'},{outline:'2px solid transparent'}],{duration:1400})" `
    + `style="background:rgba(245,184,61,.12);border:1px solid var(--goldD);border-radius:7px;padding:4px 10px;`
    + `color:var(--gold);font:700 9.5px var(--mono);letter-spacing:.08em;cursor:pointer">${label}</button>`;
}
function buyBtn(label){
  const u=buyUrl(); if(!u)return "";
  return `<button onclick="openJupiter()" class="getrcx" style="cursor:pointer;border:none">${label} ↗</button>`;
}

function standing(){
  const els=[$("standing"),$("standingR")].filter(Boolean);
  if(!els.length||!STATE)return;
  const s=STATE, p=s.player, pot=Math.floor(s.stats&&s.stats.potD||0);
  const prizes=(s.prizes&&s.prizes.day)||[];
  const left=Math.max(0,Math.round(((s.dayEnds||0)-Date.now())/1000));
  const hh=Math.floor(left/3600), mm=Math.floor((left%3600)/60);
  const clock=`<span class="clock">${hh}h ${String(mm).padStart(2,"0")}m</span>`;
  let html;
  if(!p||!AUTH){
    html=`GUEST SHOTS DON'T RANK — CONNECT TO ENTER TODAY'S LADDER · `+
      `POT <b>${pot.toLocaleString()}</b> · PAYS OUT IN ${clock}`;
  }else if(p.cr < (s.stakeRule&&s.stakeRule.min||100)){
    // You cannot fire at all. Nothing else on this bar matters until that is
    // fixed, so it says so and points at the fix.
    // Out of CREDITS is not the same as out of $RCX. A holder needs to reload
    // what they already have; only someone actually empty needs to go buy.
    const has = holdsRcx(p);
    html=`<b style="color:var(--red)">OUT OF CREDITS</b> — YOU NEED ${(s.stakeRule&&s.stakeRule.min||100)} TO FIRE. `+
      (has === true
        ? `YOU HOLD <b style="color:var(--gold)">${p.rcx.bal.toLocaleString()} $RCX</b> — RELOAD SOME FOR CREDITS, 1 FOR 1 — 70%🔥 BURNS, 30% PAYS THE PODIUM ${reloadBtn("RELOAD")}`
        : `BURN $RCX FOR CREDITS, 1 FOR 1 — 70%🔥 BURNS, 30% PAYS THE PODIUM ${has === false ? buyBtn("GET $RCX") : ""}`);
  }else if(p.qualified===false){
    // A wallet costs nothing to generate, so a free grant that also carried
    // RANK meant a script could farm the pot that pays real RCX. Playing is
    // still free. Ranking is what now costs what an honest player spent.
    html=`<b style="color:var(--gold)">UNVERIFIED WALLET</b> — YOU CAN PLAY AND SCORE, BUT NOT YET RANK. `+
      `HOLDING ANY AMOUNT OF $RCX PUTS YOU IN ${holdsRcx(p) === false ? buyBtn("GET $RCX") : ""} `+
      `· POT <b>${pot.toLocaleString()}</b> · PAYS OUT IN ${clock}`;
  }else if(p.dayRank&&p.dayRank<=prizes.length){
    const win=Math.floor(pot*(prizes[p.dayRank-1]||0));
    html=`YOU'RE <b>#${p.dayRank}</b> TODAY WITH <b>${(p.dayXp||0).toLocaleString()} XP</b> — `+
      `IF THE DAY ENDED NOW YOU'D WIN <span class="hot">${win.toLocaleString()} CREDITS</span>`+
      (p.dayRank<=3?` AND A <span class="hot">PODIUM SEAT</span>`:``)+` · ${clock} LEFT`;
  }else{
    const need=p.dayToSeat||0;
    const last=Math.floor(pot*(prizes[prizes.length-1]||0));
    html=(p.dayRank?`YOU'RE <b>#${p.dayRank}</b> OF ${p.dayField} TODAY`:`YOU HAVEN'T SCORED TODAY`)+
      ` — <b>${need.toLocaleString()} XP</b> TAKES THE LAST PAYING SEAT `+
      `(<span class="hot">${last.toLocaleString()} CREDITS</span> + THE PODIUM) · ${clock} LEFT`;
  }
  for(const el of els){el.style.display="block";if(el._h!==html){el._h=html;el.innerHTML=html;}}
}
function payLine(){
  const el=$("payLine"); if(!el)return;
  const r=(STATE&&STATE.stakeRule)||{}; const k=r.hitPayout;
  if(!k){el.textContent="";return;}
  const back=Math.floor(sel.stake*k);
  el.innerHTML=`A HIT RETURNS <b style="color:var(--grn)">${back.toLocaleString()} CREDITS</b> `+
    `(${k}× YOUR STAKE) · A MISS FEEDS THE MACHINE`;
}
function setStake(v,fromInput){
  const r=stakeRule();
  const st=Math.max(r.min,Math.min(r.max,Math.floor(+v||r.min)));
  sel.stake=st;
  const out=$("stakeMultOut"); if(out)out.textContent="×"+stakeMult(st).toFixed(2)+" XP";
  // The XP curve stops at x20 so rank cannot simply be bought. Anyone staking
  // past that deserves to be told, in the moment, that the extra risk buys
  // credits and not standing.
  const note=$("xpCapNote"), r0=stakeRule();
  if(note){const capAt=r0.xpCapAt||40000;
    note.textContent = st>capAt
      ? `XP IS CAPPED AT ×${r0.xpMultCap||20} ABOVE ${capAt.toLocaleString()} — STAKE WHAT YOU LIKE, BUT PAST HERE YOU ARE PLAYING FOR CREDITS, NOT FOR RANK. A HIT STILL RETURNS 1.7×.`
      : "";}
  document.querySelectorAll(".stakes .stk").forEach(x=>x.classList.toggle("on",+x.dataset.s===st));
  const inp=$("stakeIn"); if(inp&&!fromInput&&document.activeElement!==inp)inp.value=st;
  payLine();
  if(window.STATE)paint();
}
// scoped: #burnPick uses the same .stk class, and an unscoped binding made
// every reload click also call setStake(undefined) -> silently back to 100
document.querySelectorAll(".stakes .stk").forEach(b=>b.onclick=()=>setStake(b.dataset.s,false));
(()=>{const inp=$("stakeIn"); if(!inp)return;
  inp.value=sel.stake;
  inp.oninput=()=>{const r=stakeRule();const raw=Math.floor(+inp.value||0);
    if(raw>=r.min&&raw<=r.max)setStake(raw,true);
    else{const out=$("stakeMultOut");if(out)out.textContent=raw?"OUT OF RANGE":"×— XP";}};
  inp.onblur=()=>setStake(inp.value,false);
  inp.onkeydown=e=>{if(e.key==="Enter")inp.blur();};
})();

// ---------- actions ----------
async function post(body){
  const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();
  if(!j.ok&&/expired/i.test(j.reason||"")&&AUTH){   // stale signature: force a clean reconnect
    AUTH=null;localStorage.removeItem("ratchet_auth");
    $("cx").textContent="CONNECT";$("cx").classList.remove("done");
    toast("session expired — tap CONNECT to sign again");
  }
  return j;
}
$("fire").onclick=async()=>{
  const j=await post({action:"shot",auth:AUTH||{wallet:DEMO},target:sel.t,side:sel.side,stake:sel.stake});
  if(!j.ok){toast("⚠ "+j.reason);return}
  rememberSide(j.shot);
  toast(`SHOT SEALED 🔒 — ${sel.stake.toLocaleString()} burned · the Machine got fed`);
  sel.side=null;refresh();
};
async function duel(side){
  if(!who()){toast("connect first");return}
  const j=await post({action:"duel",auth:AUTH||{wallet:DEMO},side,stake:sel.stake});
  if(!j.ok){toast("⚠ "+j.reason);return}
  rememberSide(j.shot);
  toast(`SEALED ${side==="with"?"WITH":"AGAINST"} THE WARDEN 🔒 — ${sel.stake.toLocaleString()} burned`);
  refresh();
}
$("dW").onclick=()=>duel("with");$("dA").onclick=()=>duel("against");
$("stakeBtn").onclick=async()=>{
  if(!AUTH){toast("connect a real wallet first");return}
  const on=!(STATE&&STATE.player&&STATE.player.stakeInfo&&STATE.player.stakeInfo.on);
  const j=await post({action:"stake",auth:AUTH,on});
  if(!j.ok){toast("⚠ "+j.reason);return}
  toast(on?"⚙ GEARS MESHED — your first yield lands tomorrow (UTC). Tokens never moved.":"gears unmeshed — no more daily yield");
  refresh();
};
$("incin")&&($("incin").onclick=()=>{navigator.clipboard.writeText($("incin").textContent);toast("incinerator address copied")});
// --- RELOAD TABS ---
let reloadMode = "swap"; // "swap" or "burn"
$("tabSwap").onclick=()=>{
  reloadMode="swap";
  $("tabSwap").classList.remove("done");
  $("tabBurn").classList.add("done");
  $("secSwap").style.display="block";
  $("secBurn").style.display="none";
};
$("tabBurn").onclick=()=>{
  reloadMode="burn";
  $("tabBurn").classList.remove("done");
  $("tabSwap").classList.add("done");
  $("secBurn").style.display="block";
  $("secSwap").style.display="none";
};

// --- SOL SWAP ---
let solAmt=0.1;
const SOL_MIN=0.001, SOL_MAX=100;
let lastBuiltTx = null;
let setBurnTimeout = null;
let lastFetchedSolAmt = null;
let lastFetchedWallet = null;
let lastFetchedTime = 0;

function setBurnSol(v,fromInput){
  const raw=Number(v)||0.1;
  solAmt=Math.max(SOL_MIN,Math.min(SOL_MAX,raw||SOL_MIN));
  document.querySelectorAll("#burnPickSol .stk").forEach(x=>x.classList.toggle("on",Math.abs(Number(x.dataset.b)-solAmt)<0.001));
  const inp=$("burnInSol"); if(inp&&!fromInput&&document.activeElement!==inp)inp.value=solAmt;
  
  const out=$("burnSplitOutSol");
  const b=$("oneBurnSol");
  
  if(!AUTH){
    if(out)out.textContent="Connect wallet to check swap estimate";
    if(b&&!PB)b.textContent="🔥🔥 BUY & RELOAD RCX";
    return;
  }
  
  if (solAmt === lastFetchedSolAmt && AUTH.wallet === lastFetchedWallet && lastBuiltTx && (Date.now() - lastFetchedTime < 25000)) {
    return;
  }
  
  if(out)out.textContent="Calculating swap estimation...";
  if(b&&!PB)b.textContent=`🔥🔥 BUY & RELOAD RCX ${solAmt} SOL`;
  
  if(setBurnTimeout)clearTimeout(setBurnTimeout);
  setBurnTimeout=setTimeout(async()=>{
    try{
      const j=await post({action:"reload_build",wallet:AUTH.wallet,solAmount:solAmt});
      if(j.ok){
        lastBuiltTx=j;
        lastFetchedSolAmt=solAmt;
        lastFetchedWallet=AUTH.wallet;
        lastFetchedTime=Date.now();
        const tokensOut=Math.floor(Number(j.tokensOut)/1e6);
        if(out)out.textContent=`Est. ${tokensOut.toLocaleString()} RCX bought · 70% burns · 30% pays podium`;
        if(b&&!PB)b.textContent=`🔥🔥 BUY & RELOAD RCX ${solAmt} SOL`;
      }else{
        lastBuiltTx=null;
        if(out)out.textContent=`Error: ${j.reason}`;
      }
    }catch(e){
      lastBuiltTx=null;
      if(out)out.textContent="Failed to calculate swap estimation";
    }
  },400);
}
document.querySelectorAll("#burnPickSol .stk").forEach(b=>b.onclick=()=>setBurnSol(b.dataset.b,false));
(()=> {
  const inp=$("burnInSol"); if(!inp)return;
  inp.oninput=()=>{
    const raw=Number(inp.value)||0;
    if(raw>=SOL_MIN&&raw<=SOL_MAX)setBurnSol(raw,true);
    else{const out=$("burnSplitOutSol");if(out)out.textContent=raw?"OUT OF RANGE":"—";}};
  inp.onblur=()=>setBurnSol(inp.value,false);
  inp.onkeydown=e=>{if(e.key==="Enter")inp.blur();};
})();

// --- RCX🔥 BURN ---
let burnAmt = 5000;
function setBurnRcx(v,fromInput){
  const raw=Math.floor(+v||5000);
  burnAmt=Math.max(100,Math.min(1000000000,raw||100));
  document.querySelectorAll("#burnPickRcx .stk").forEach(x=>x.classList.toggle("on",Number(x.dataset.b)===burnAmt));
  const inp=$("burnInRcx"); if(inp&&!fromInput&&document.activeElement!==inp)inp.value=burnAmt;
  
  const out=$("burnSplitOutRcx");
  const b=$("oneBurnRcx");
  if(out){
    const cutPct=(STATE&&STATE.champ&&STATE.champ.pct)||0.3;
    const legTotal=Math.floor(burnAmt*cutPct);
    const toBurn=burnAmt-legTotal;
    out.textContent=`${toBurn.toLocaleString()} burns · ${legTotal.toLocaleString()} pays the podium`;
  }
  if(b&&!PB)b.textContent=`🔥🔥 BURN ${burnAmt.toLocaleString()} RCX`;
}
document.querySelectorAll("#burnPickRcx .stk").forEach(b=>b.onclick=()=>setBurnRcx(b.dataset.b,false));
(()=> {
  const inp=$("burnInRcx"); if(!inp)return;
  inp.oninput=()=>{
    const raw=Math.floor(+inp.value||0);
    if(raw>=100&&raw<=1000000000)setBurnRcx(raw,true);
    else{const out=$("burnSplitOutRcx");if(out)out.textContent=raw?"OUT OF RANGE":"—";}};
  inp.onblur=()=>setBurnRcx(inp.value,false);
  inp.onkeydown=e=>{if(e.key==="Enter")inp.blur();};
})();


async function loadW3(){
  if(window.solanaWeb3)return window.solanaWeb3;
  const urls=["/vendor/solana-web3-1.98.4.min.js"];
  for(const u of urls){
    try{
      await new Promise((ok,no)=>{const s=document.createElement("script");
        s.src=u;s.onload=ok;s.onerror=()=>no(new Error("cdn miss"));document.head.appendChild(s);});
      if(window.solanaWeb3)return window.solanaWeb3;
    }catch{}
  }
  throw new Error("the local Solana transaction library could not load");
}
// ---- pending-burn tracker: survives refresh, retries until verified ----
let PB=null;try{PB=JSON.parse(localStorage.getItem("ratchet_pb"))}catch{}
setBurnSol(0.1,false);
setBurnRcx(5000,false);
function setPB(o){PB=o;if(o)localStorage.setItem("ratchet_pb",JSON.stringify(o));else localStorage.removeItem("ratchet_pb")}
function paintBurnBtn(){
  const bSol=$("oneBurnSol"), bRcx=$("oneBurnRcx");
  if(bSol){
    bSol.disabled=!!PB;
    bSol.textContent=PB?"⏳⚡ VERIFYING RELOAD — CREDITS INCOMING…" : `🔥🔥 BUY & RELOAD RCX ${solAmt} SOL`;
  }
  if(bRcx){
    bRcx.disabled=!!PB;
    bRcx.textContent=PB?"⏳⚡ VERIFYING RELOAD — CREDITS INCOMING…" : `🔥🔥 BURN ${burnAmt.toLocaleString()} RCX`;
  }
}
async function tryPB(){
  if(!PB||!AUTH)return;
  if(Date.now()-PB.t>10*60e3){$("burnsig").value=PB.sig;setPB(null);paintBurnBtn();
    toast("burn unverified after 10 min — signature filled in below, press CREDIT");return}
  try{
    const j=await post({action:"reload",auth:AUTH,sig:PB.sig});
    if(j.ok){toast(`✓ RELOAD VERIFIED ON-CHAIN 🔥 +${j.credited.toLocaleString()} credits`);
      setPB(null);paintBurnBtn();refresh();}
    else if(/already credited/i.test(j.reason||"")){setPB(null);paintBurnBtn();refresh();}
    else if(/failed on-chain|did not reach|that wallet paid/i.test(j.reason||"")){
      $("burnsig").value=PB.sig;
      toast("⚠ burn not valid: "+j.reason+" — signature kept in the box below");
      setPB(null);paintBurnBtn();}
    // anything else (not found yet / rpc hiccup): stay pending, try again next tick
  }catch{}
}
setInterval(tryPB,6000);
paintBurnBtn();

$("oneBurnSol").onclick=async()=>{
  if(!AUTH){toast("connect your wallet first");return}
  if(!STATE||!STATE.mint){toast("token not armed yet");return}
  if(!lastBuiltTx){toast("swap estimation still loading, please wait...");return}
  $("oneBurnSol").disabled=true;
  try{
    const W3=await loadW3(),prov=window.solana||window.phantom.solana;
    const bytes=Uint8Array.from(atob(lastBuiltTx.transaction), c=>c.charCodeAt(0));
    let tx;
    try {
      tx = W3.VersionedTransaction.deserialize(bytes);
    } catch {
      tx = W3.Transaction.from(bytes);
    }
    const {signature}=await prov.signAndSendTransaction(tx);
    const estTokens=Math.floor(Number(lastBuiltTx.tokensOut)/1e6);
    setPB({sig:signature,amt:estTokens,t:Date.now()});
    paintBurnBtn();
    toast("🔥 reload transaction sent · verifying on-chain…");
    setTimeout(tryPB,4000);
  }catch(e){toast("reload failed: "+((e&&e.message)||"cancelled"));}
  $("oneBurnSol").disabled=false;
};

$("oneBurnRcx").onclick=async()=>{
  if(!AUTH){toast("connect your wallet first");return}
  if(!STATE||!STATE.mint){toast("token not armed yet");return}
  $("oneBurnRcx").disabled=true;
  try{
    const W3=await loadW3(),prov=window.solana||window.phantom.solana;
    const TOKEN=new W3.PublicKey(STATE.tokenProgram||"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ATAP=new W3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const owner=new W3.PublicKey(AUTH.wallet),mint=new W3.PublicKey(STATE.mint);
    const ata=W3.PublicKey.findProgramAddressSync([owner.toBytes(),TOKEN.toBytes(),mint.toBytes()],ATAP)[0];
    const podium=(STATE.champ&&STATE.champ.podium)||[];
    const cutPct=(STATE.champ&&STATE.champ.pct)||0;
    const legs=podium.map(c=>{
      const amt=Math.floor(burnAmt*cutPct*c.pct);
      let to=c.ata, make=false;
      if(!to&&c.owner){
        try{ to=W3.PublicKey.findProgramAddressSync(
          [new W3.PublicKey(c.owner).toBytes(),TOKEN.toBytes(),mint.toBytes()],ATAP)[0].toBase58();
          make=true; }catch{ to=null; }
      }
      return {ata:to,owner:c.owner,amt,make};
    }).filter(l=>l.amt>=1&&l.ata);
    const selfTotal=legs.filter(l=>l.owner===AUTH.wallet).reduce((a,l)=>a+l.amt,0);
    const otherTotal=legs.filter(l=>l.owner!==AUTH.wallet).reduce((a,l)=>a+l.amt,0);
    const legTotal=selfTotal+otherTotal;
    const burnPart=burnAmt-legTotal;
    const raw=BigInt(burnPart)*1000000n; // pump.fun mints use 6 decimals
    const data=new Uint8Array(9);data[0]=8; // SPL Token "Burn"
    let v=raw;for(let i=1;i<9;i++){data[i]=Number(v&255n);v>>=8n;}
    const bj=await (await fetch(API+"?action=blockhash")).json();
    if(!bj.ok)throw new Error(bj.reason||"blockhash unavailable");
    const blockhash=bj.blockhash;
    const tx=new W3.Transaction({recentBlockhash:blockhash,feePayer:owner});
    tx.add(new W3.TransactionInstruction({programId:TOKEN,keys:[
      {pubkey:ata,isSigner:false,isWritable:true},
      {pubkey:mint,isSigner:false,isWritable:true},
      {pubkey:owner,isSigner:true,isWritable:false}],data}));
    for(const l of legs){
      if(l.make){
        tx.add(new W3.TransactionInstruction({programId:ATAP,keys:[
          {pubkey:owner,isSigner:true,isWritable:true},
          {pubkey:new W3.PublicKey(l.ata),isSigner:false,isWritable:true},
          {pubkey:new W3.PublicKey(l.owner),isSigner:false,isWritable:false},
          {pubkey:mint,isSigner:false,isWritable:false},
          {pubkey:W3.SystemProgram.programId,isSigner:false,isWritable:false},
          {pubkey:TOKEN,isSigner:false,isWritable:false}],data:new Uint8Array([1])}));
      }
      const td=new Uint8Array(10);td[0]=12; // SPL TransferChecked
      let a=BigInt(l.amt)*1000000n;for(let i=1;i<9;i++){td[i]=Number(a&255n);a>>=8n;}
      td[9]=6;
      tx.add(new W3.TransactionInstruction({programId:TOKEN,keys:[
        {pubkey:ata,isSigner:false,isWritable:true},
        {pubkey:mint,isSigner:false,isWritable:false},
        {pubkey:new W3.PublicKey(l.ata),isSigner:false,isWritable:true},
        {pubkey:owner,isSigner:true,isWritable:false}],data:td}));
    }
    const {signature}=await prov.signAndSendTransaction(tx);
    setPB({sig:signature,amt:burnAmt,t:Date.now()});
    paintBurnBtn();
    toast("🔥 sent - "+burnPart.toLocaleString()+" burning"+(otherTotal?", "+otherTotal.toLocaleString()+" to other champions":"")+(selfTotal?", "+selfTotal.toLocaleString()+" stays with you":"")+" · verifying on-chain.");
    setTimeout(tryPB,4000);
  }catch(e){toast("burn failed: "+((e&&e.message)||"cancelled")+" - the manual fallback below always works");}
  $("oneBurnRcx").disabled=false;
};
$("burngo").onclick=async()=>{
  const sg=$("burnsig").value.trim();if(!sg){toast("paste the signature first");return}
  $("burngo").disabled=true;
  const j=await post({action:"reload",auth:AUTH,sig:sg});
  $("burngo").disabled=false;
  if(!j.ok){toast("⚠ "+j.reason);return}
  $("burnsig").value="";
  toast(`RELOADED 🔥 +${j.credited.toLocaleString()} credits${j.retained?` · ${j.retained.toLocaleString()} RCX stayed with you`:""} — verified on-chain`);
  refresh();
};

// ---------- THE PODIUM ----------
// It was only ever visible to the person already sitting on it, inside a
// panel that renders for seat-holders. Everyone else — including anyone
// deciding whether the ladder is worth climbing — saw no evidence that the
// prize exists. It is the only thing in the game that pays real RCX, so it
// belongs where people can see it before they qualify for it.
//
// Empty seats are shown as empty ON PURPOSE. With two champions the third
// seat's share is unclaimed and simply burns, and an open seat is a far
// better reason to climb than a full one.
const MEDAL = ['🥇','🥈','🥉'];
function drawPodium(s){
  const ch=s&&s.champ;if(!ch)return;
  const cl=ch.podium||[],curve=ch.curve||[0.5,0.3,0.2],cut=ch.pct||0;
  const me=(AUTH&&AUTH.wallet)||null;
  const seats=curve.map((pct,i)=>{
    const held=cl[i]||null,share=Math.round(pct*cut*100);
    if(!held)return `<div class="pods empty"><span class="pm">${MEDAL[i]}</span>
      <span class="pw">SEAT ${i+1} — UNCLAIMED</span><span class="pp">${share}% of every reload</span>
      <span class="pn">the next distinct wallet ranked today fills it</span></div>`;
    const mine=me&&held.owner===me;
    const link=held.owner?`<a href="${SCAN}${held.owner}" target="_blank" rel="noopener" title="${held.owner}">${mine?'YOU':held.w}</a>`:(mine?'YOU':held.w);
    const source=held.source==="today"?"LIVE TODAY":"YESTERDAY FALLBACK";
    return `<div class="pods${mine?' mine':''}"><span class="pm">${MEDAL[i]}</span>
      <span class="pw">${link}</span><span class="pp">${share}% of every reload</span>
      <span class="pn">${source} · ${mine?'no claim needed':'paid inside the reloader\'s transaction'}</span></div>`;
  }).join("");
  const note=`<div class="podnote">Today's settled-XP ranks update these seats live. At the daily reset, yesterday fills empty
    positions; today's #1, #2 and #3 displace yesterday's #3, #2 and #1. Every reload pays
    <b style="color:var(--gold)">${Math.round(cut*100)}%</b> to its published snapshot — no pool, custody, claim or hold rule.</div>`;
  const el1=$("podiumR");if(el1)setHTML(el1,seats+note);
  const el2=$("podiumP");
  if(el2)setHTML(el2,`<div class="podstrip"><span class="pcap">LIVE PODIUM · PAID BY EVERY RELOAD</span>${
    curve.map((pct,i)=>{const held=cl[i]||null,mine=me&&held&&held.owner===me;
      const nm=held?(held.owner?`<a href="${SCAN}${held.owner}" target="_blank" rel="noopener" title="${held.owner}">${mine?'YOU':held.w}</a>`:(mine?'YOU':held.w)):'OPEN';
      return `<span class="pchip${held?(mine?' mine':''):' empty'}">${MEDAL[i]} ${nm} <b>${Math.round(pct*cut*100)}%</b></span>`;
    }).join("")}</div>`);
}
// ---------- LIVE proof ----------
let PROOF=null,proofAt=0;
const STATIC_LINES=[
["g","One frozen rule at both doors: 70 / 30 / 0","stakes: 70% machine · 30% pots · 0% us. reloads: 70% burn · 30% straight to the champions · 0% us"],
["g","Your side is hidden from spectators until settlement","Public APIs and the Warden see only the commitment; the server retains reveal terms until settlement"],
["g","Targets settle on markets no player can move","majors via Pyth only — RCX-priced shots were removed on purpose: a thin market you can trade is a bet you can settle yourself"],
["p","The modeled floor is not redeemable","Vault not deployed: no funded PDA, liability proof or no-withdraw program is claimed"]];
function drawProof(){
  if(!PROOF)return;
  const st={green:"g",red:"r",grey:"p"};
  const live=PROOF.checks.map(c=>`<div class="chk" ${c.status==='red'?'style="border-color:rgba(255,82,82,.5)"':''}>
    <div class="ic ${c.status==='green'?'g':'p'}" ${c.status==='red'?'style="background:rgba(255,82,82,.15);color:var(--red)"':''}>${c.status==='green'?'✓':c.status==='red'?'✕':'…'}</div>
    <div class="bd"><b>${c.label}</b><span>${c.detail}</span></div>
    ${c.link?`<a class="st g" style="text-decoration:none" href="${c.link}" target="_blank" rel="noopener">VERIFY ↗</a>`:`<span class="st ${c.status==='green'?'g':'p'}">${c.status==='green'?'LIVE':c.status==='red'?'FAILING':'ARMED AT TGE'}</span>`}
  </div>`).join("");
  const stat=STATIC_LINES.map(([s,a,b])=>`<div class="chk"><div class="ic ${s}">${s==="g"?"✓":"…"}</div>
    <div class="bd"><b>${a}</b><span>${b}</span></div><span class="st ${s}">${s==="g"?"LIVE":"IN DESIGN"}</span></div>`).join("");
  setHTML($("chks"),live+stat);
  if(PROOF.supply){const s=PROOF.supply;
    const pb=s.playerBurned!=null?Math.round(s.playerBurned):null;
    const other=s.otherDestroyed!=null?Math.round(s.otherDestroyed):null;
    $("supplyStrip").innerHTML=`<span class="pr">INITIAL <b>${s.initial.toLocaleString()}</b></span>
    <span class="pr">NOW <b>${s.current.toLocaleString()}</b></span>
    ${pb!=null?`<span class="pr" style="border-color:var(--goldD)">PLAYERS🔥 BURNED <b style="color:var(--gold)">${pb.toLocaleString()}</b></span>`:""}
    ${other!=null?`<span class="pr">LAUNCHPAD/OTHER <b>${other.toLocaleString()}</b></span>`:""}
    <span class="pr">AT INCINERATOR <b style="color:var(--red)">${s.incinerated.toLocaleString()}</b></span>`;}
  if(PROOF.log){$("logHead").textContent=` · ENTRY #${PROOF.log.i} · ${PROOF.log.h.slice(0,12)}…`;}
  if(PROOF.supply){const s=PROOF.supply;
    // Honesty is the aesthetic: the headline burn number is the one WE
    // caused. What pump.fun destroyed at graduation is stated separately,
    // never claimed as game activity.
    const pb=s.playerBurned!=null?Math.round(s.playerBurned):Math.round(s.destroyed+s.incinerated);
    const other=s.otherDestroyed!=null?Math.round(s.otherDestroyed):0;
    const f=pb>=1e6?(pb/1e6).toFixed(2)+"M":pb.toLocaleString();
    const fo=other>=1e6?(other/1e6).toFixed(2)+"M":other.toLocaleString();
    $("burnChip").style.display="inline";$("burnChip").textContent="🔥 "+f+" PLAYER-BURNED";
    $("burnLine").style.display="block";
    $("burnLine").textContent="🔥 "+pb.toLocaleString()+" RCX🔥 BURNED BY PLAYERS — VERIFIED ON-CHAIN"+(other>0?" · +"+fo+" REMOVED AT GRADUATION (PUMP.FUN-SIDE, NOT GAME ACTIVITY)":"");}
  setHTML($("anchorList"),(PROOF.anchors||[]).map(a=>`<div class="kl"><span class="t">#${a.i}</span>
    <span class="wl">${a.w}</span><span>anchored · <a href="https://solscan.io/tx/${a.sig}" target="_blank" rel="noopener" style="color:var(--ice)">tx ↗</a></span></div>`).join("")
    ||'<div class="empty">NOT YET ANCHORED — BE THE FIRST SCRIBE</div>');
}
async function loadProof(){try{const r=await fetch("/api/proof");PROOF=await r.json();proofAt=Date.now();drawProof();}catch{}}
loadProof();setInterval(loadProof,30000);
setInterval(()=>{if(proofAt)$("checkedAgo").textContent="RE-CHECKED "+Math.round((Date.now()-proofAt)/1000)+"S AGO · REFRESHES EVERY 30S";},1000);

// ---------- anchor flow: build a memo tx in-browser (web3.js from CDN, lazily) ----------
async function anchorLog(){
  if(!AUTH){toast("connect a real wallet to anchor");return}
  if(!PROOF||!PROOF.log){toast("log is empty — play first");return}
  const memo=`RATCHET|${PROOF.log.i}|${PROOF.log.h}`;
  $("memoStr").style.display="block";$("memoStr").textContent=memo;
  try{
    const W3=await loadW3(),prov=window.solana||window.phantom.solana;
    const bj=await (await fetch(API+"?action=blockhash")).json();
    if(!bj.ok)throw new Error(bj.reason||"blockhash unavailable");
    const blockhash=bj.blockhash;
    const tx=new W3.Transaction({recentBlockhash:blockhash,feePayer:new W3.PublicKey(AUTH.wallet)});
    tx.add(new W3.TransactionInstruction({keys:[],programId:new W3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data:new TextEncoder().encode(memo)}));
    const {signature}=await prov.signAndSendTransaction(tx);
    toast("memo sent — confirming…");
    await new Promise(r=>setTimeout(r,4000));
    const j=await post({action:"anchor",auth:AUTH,sig:signature});
    if(!j.ok){toast("⚠ "+j.reason+" — you can paste the signature below once confirmed");return}
    toast(`⚓ LOG ANCHORED at entry #${j.i}${j.xp?` · +${j.xp} XP`:" · (XP pays once per day)"} — the chain now timestamps our history`);
    loadProof();refresh();
  }catch(e){
    toast("auto-send failed: "+((e&&e.message)||"cancelled")+" — or paste a memo tx signature below");
  }
}
$("anchorGo").onclick=anchorLog;
$("memoStr").onclick=()=>{navigator.clipboard.writeText($("memoStr").textContent);toast("memo copied")};
$("anchorPaste").onclick=async()=>{
  const sg=$("anchorsig").value.trim();if(!sg){toast("paste the signature first");return}
  const j=await post({action:"anchor",auth:AUTH,sig:sg});
  if(!j.ok){toast("⚠ "+j.reason);return}
  $("anchorsig").value="";toast(`⚓ ANCHORED at entry #${j.i}${j.xp?` · +${j.xp} XP`:" · (XP pays once per day)"}`);loadProof();refresh();
};

$("howBtn").onclick=()=>{const b=$("howBox");b.style.display=b.style.display==="none"?"block":"none";};

async function mirrorShot(btn) {
  if(!AUTH){toast("connect wallet first");return}
  const shotId = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = "BUILDING TX...";
  try {
    const W3 = await loadW3(), prov = window.solana||window.phantom.solana;
    const res = await post({ action: "mirror_build", auth: AUTH, id: shotId });
    if(!res.ok) throw new Error(res.reason);
    
    const PROGRAM = new W3.PublicKey(res.programId);
    const playerPubkey = new W3.PublicKey(AUTH.wallet);
    
    const fromHex = h => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const nonceBuf = fromHex(res.nonceHex);
    const shotSeed = new TextEncoder().encode("shot");
    const [shotPda] = W3.PublicKey.findProgramAddressSync([shotSeed, playerPubkey.toBytes(), nonceBuf], PROGRAM);
    const feedKey = new W3.PublicKey(res.feedKey);
    const sysId = new W3.PublicKey("11111111111111111111111111111111");
    
    const ix = new W3.TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: playerPubkey, isSigner: true, isWritable: true },
        { pubkey: feedKey, isSigner: false, isWritable: false },
        { pubkey: sysId, isSigner: false, isWritable: false }
      ],
      data: fromHex(res.ixData)
    });
    
    const tx = new W3.Transaction({ recentBlockhash: res.blockhash, feePayer: playerPubkey });
    tx.add(ix);
    
    btn.textContent = "SIGNING...";
    const { signature } = await prov.signAndSendTransaction(tx);
    btn.textContent = "CONFIRMING...";
    let confirm=null;
    for(let attempt=0;attempt<6;attempt++){
      await new Promise(r=>setTimeout(r,attempt?2000:2500));
      confirm=await post({ action: "mirror_confirm", auth: AUTH, id: shotId, sig: signature });
      if(confirm.ok)break;
      if(!/tx not found yet|RPC unreachable/i.test(confirm.reason||''))throw new Error(confirm.reason);
    }
    if(!confirm||!confirm.ok)throw new Error((confirm&&confirm.reason)||"confirmation timed out — transaction may still be finalizing");
    toast("⚓ SHOT SEALED ON-CHAIN");
    refresh();
  } catch(err) {
    toast("On-chain seal failed: " + ((err&&err.message)||err));
    btn.textContent = "SEAL ON-CHAIN · BETA";
    btn.disabled = false;
  }
}
document.addEventListener("click", async e => { const b=e.target.closest&&e.target.closest(".mirrorb"); if(b) mirrorShot(b); });
let lastVisibleRefresh=Date.now();
async function pollState(){
  const liveShot=!!(STATE&&STATE.player&&(STATE.player.open||[]).length);
  const engaged=!!AUTH||liveShot;
  const delay=engaged?10000:60000;
  setTimeout(async()=>{
    // Connected players and expiring shots keep a ten-second settlement watch,
    // including in a hidden tab. Idle guests poll once a minute, foreground only.
    if(engaged||document.visibilityState==="visible"){
      lastVisibleRefresh=Date.now();
      await refresh();
    }
    pollState();
  },delay);
}
refresh().finally(pollState);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&Date.now()-lastVisibleRefresh>15000){
    lastVisibleRefresh=Date.now();refresh();
  }
});
// Expired cards actively watch settlement. The regular 10s poll remains the
// safety net; this bounded backoff makes the result appear without a reload.
const settleWatches=new Map();
let settleRefreshDue=0;
function watchExpired(exp){
  const now=Date.now(), prev=settleWatches.get(exp)||{tries:0,next:0};
  if(now<prev.next)return;
  prev.tries++;
  prev.next=now+Math.min(15000,2000*Math.pow(1.45,prev.tries-1));
  settleWatches.set(exp,prev);
  if(now>=settleRefreshDue){settleRefreshDue=now+1500;refresh();}
}
// surgical 1s ticker: update countdown text, then wake settlement only at expiry
setInterval(()=>{
  const activeExp=new Set();
  document.querySelectorAll(".cd").forEach(sp=>{
    const left=Math.max(0,Math.round((+sp.dataset.exp-Date.now())/1000));
    const hh2=Math.floor(left/3600),mm=Math.floor((left%3600)/60),ss=left%60;
    if(left===0){sp.textContent="SETTLING…";activeExp.add(sp.dataset.exp);watchExpired(sp.dataset.exp);}
    else sp.textContent=hh2>0?`${hh2}h ${String(mm).padStart(2,"0")}m`:`${mm}:${String(ss).padStart(2,"0")}`;
  });
  for(const exp of settleWatches.keys())if(!activeExp.has(exp))settleWatches.delete(exp);
  if(STATE&&STATE.boardFlip){const l=Math.max(0,Math.round((STATE.boardFlip-Date.now())/1000));
    const el=$("boardIn");if(el)el.textContent=`NEW MIX IN ${Math.floor(l/60)}:${String(l%60).padStart(2,"0")}`;}
  if(STATE)standing();
},1000);
