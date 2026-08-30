'use strict';
const kv = require('./kv.js');
const {isWalletShaped} = require('./verify.js');
const {verifyCommit} = require('./commit.js');
const DEMO_KEY = 'g:feed:mcp-demos:v1';
const DEMO_LIMIT = 20;
const INDEX_LIMIT = 100;
const validHandle = h => /^[a-z0-9]{3,18}$/.test(String(h || ''));
const validShot = id => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''));
const finite = n => typeof n === 'number' && Number.isFinite(n);
// Explicit operator-provided Bankr receipt (2026-08-30); the name attribution
// is not cryptographic identity. The actual shot must still exist and verify.
const REPORTED = [{handle:'da738cabd5c2',shotId:'0c46104b07a4',name:'Bankr',
  attribution:'operator-provided-receipt'}];

function walletFor(row) {
  if (isWalletShaped(row.actorWallet)) return row.actorWallet;
  const w = /^(?:seal|settle):([^:]+):/.exec(row.id || '')?.[1];
  return isWalletShaped(w) ? w : null;
}

function demoRow(ref, player, seal = null) {
  if (!validHandle(ref.handle) || !validShot(ref.shotId) || !player) return null;
  const wallet = 'demo-' + ref.handle;
  const closed = (player.closed || []).find(s=>s && s.id===ref.shotId);
  const open = (player.open || []).find(s=>s && s.id===ref.shotId);
  const s = closed || open;
  if (!s || !finite(s.stake) || s.stake<1 || !finite(s.exp)
      || !/^[a-f0-9]{64}$/.test(s.commit || '')) return null;
  let t, a, c;
  if (closed) {
    if (!['hit','miss','void'].includes(s.res) || !finite(s.settledAt)
        || s.settledAt<s.exp || !verifyCommit({version:s.commitV,wallet,
          shotId:s.id,side:s.side,salt:s.salt,commit:s.commit}).matches) return null;
    t=s.settledAt; c=s.res;
    a=`${s.res.toUpperCase()} - ${s.label || 'forecast'} - ${s.stake} demo credits`;
    if (finite(s.sp) && s.sp>=.01 && s.sp<=.99 && s.res!=='void')
      a+=` - p=${s.sp} - Brier ${((s.sp-(s.res==='hit'?1:0))**2).toFixed(4)}`;
  } else {
    if (!seal || !finite(seal.t) || seal.t>s.exp) return null;
    t=seal.t; c='seal';
    // No side, p, salt or XP leaves an unresolved forecast.
    a=`SEALED - ${s.label || 'forecast'} - ${s.stake} demo credits`;
  }
  return {id:`agent-demo:${ref.handle}:${s.id}`,t,w:ref.handle.slice(0,6)+'…',a:a+' - no payout',c,
    mode:'demo',source:'canonical-demo-shot',proofUrl:'/gauntlet?handle='+ref.handle,
    actor:{kind:'demo-agent',name:ref.name || 'MCP client',
      attribution:ref.attribution || 'mcp-transport-not-human-identity'}};
}

async function noteMcpDemo(handle,shotId) {
  if (!validHandle(handle) || !validShot(shotId)) return false;
  const lock='lock:'+DEMO_KEY, lease=await kv.acquireLease(lock,10);
  if (!lease) return false;
  try {
    const prior=(await kv.getJSONStrict(DEMO_KEY)) || [];
    if (prior.some(r=>r.handle===handle && r.shotId===shotId)) return false;
    // One current descriptor per handle and a hard bound, never player storage.
    const next=[{handle,shotId},...prior.filter(r=>r.handle!==handle)].slice(0,INDEX_LIMIT);
    await kv.setJSONEx(DEMO_KEY,next,30*86400);
    memo=null;
    return true;
  } finally {try{await kv.releaseLease(lock,lease);}catch{}}
}

let memo=null;
async function loadContext(wallets) {
  const signature=wallets.slice().sort().join(',');
  if (memo && memo.signature===signature && Date.now()-memo.t<15000) return memo;
  const [runs,noted] = await kv.getManyJSON(['g:evidence:publicRuns',DEMO_KEY]);
  const refs=new Map();
  for (const run of (Array.isArray(runs)?runs:[]).slice(0,20)) {
    if (!['operator-verified-x','operator-provided-receipt'].includes(run.claim)) continue;
    for (const p of (run.proofs || []).slice(0,20))
      if (validHandle(p.handle) && validShot(p.shotId)) refs.set(p.handle+':'+p.shotId,
        {handle:p.handle,shotId:p.shotId,name:String(run.agent || 'Agent').slice(0,40),attribution:run.claim});
  }
  for (const p of REPORTED) if (!refs.has(p.handle+':'+p.shotId)) refs.set(p.handle+':'+p.shotId,p);
  for (const p of (Array.isArray(noted)?noted:[]).slice(0,INDEX_LIMIT))
    if (validHandle(p.handle) && validShot(p.shotId) && !refs.has(p.handle+':'+p.shotId))
      refs.set(p.handle+':'+p.shotId,p);
  const selected=[...refs.values()].slice(0,INDEX_LIMIT);
  const demoWallets=[...new Set(selected.map(r=>'demo-'+r.handle))];
  const ids=[...wallets,...demoWallets];
  const players=await kv.getManyJSON(ids.map(w=>'u:'+w));
  const byWallet=new Map(ids.map((w,i)=>[w,players[i]]));
  const seals=await kv.getManyJSON(selected.map(r=>`g:log:once:seal:demo-${r.handle}:${r.shotId}`));
  const demo=selected.map((r,i)=>demoRow(r,byWallet.get('demo-'+r.handle),seals[i]))
    .filter(Boolean).sort((a,b)=>b.t-a.t).slice(0,DEMO_LIMIT);
  memo={signature,t:Date.now(),byWallet,demo};
  return memo;
}

async function combine(playerRows) {
  const rows=(playerRows || []).filter(r=>r && !r.agent);
  const wallets=[...new Set(rows.map(walletFor).filter(Boolean))].slice(0,100);
  try {
    const context=await loadContext(wallets);
    const ranked=rows.map(row=>{
      const wallet=walletFor(row), p=context.byWallet.get(wallet), a=p && p.agent;
      if (!a || typeof a.name!=='string' || !finite(a.since) || a.since>row.t) return row;
      return {...row,actor:{kind:'registered-agent',name:a.name.slice(0,40),
        attribution:'wallet-registration',wallet},mode:'ranked'};
    });
    return [...ranked,...context.demo].sort((a,b)=>b.t-a.t);
  } catch {
    return rows; // Identity/display failure cannot block the game or invent proof.
  }
}

module.exports={combine,demoRow,noteMcpDemo,DEMO_KEY,DEMO_LIMIT,INDEX_LIMIT};
