// Standard x402 v2 arena entry, driven through the real game handler. The
// facilitator is deterministic; the header encoding/decoding is the official
// @x402/core implementation used in production.
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { encodePaymentSignatureHeader, decodePaymentRequiredHeader,
  decodePaymentResponseHeader } = require('@x402/core/http');
let pass = 0, failn = 0;
const ok = (c, label) => { if (c) { pass++; console.log('PASS  ' + label); }
  else { failn++; console.log('FAIL  ' + label); } };

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CHAMP = 'Champ1onWa11etxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const NEW_CHAMP = 'NewChamp1onWa11etxxxxxxxxxxxxxxxxxxxxxxxxx';
const FEE_PAYER = 'FeePayer111111111111111111111111111111111';

// Stub only unrelated network surfaces. x402 itself uses the official core
// codec and a fake facilitator injected through its test seam.
const pricesPath = require.resolve('../lib/prices.js');
const agentRegistryPath = require.resolve('../lib/agent_registry.js');
const REGISTRY_ASSET = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';
let registryMode = 'verified';
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
let T = 100;
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t=Math.floor(Date.now()/1000), scale=(T+=0.4)/100; return { src:'pyth-onchain',
    ages:Object.fromEntries(FEEDS.map(f=>[f,3])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    SOL:T, BTC:60000*scale, ETH:2000*scale, BONK:0.000002*scale, WIF:0.1*scale, JUP:0.2*scale, PUMP:0.005*scale }; } } };
require.cache[agentRegistryPath] = { id: agentRegistryPath, filename: agentRegistryPath, loaded: true,
  exports: { lookupAgentByWallet: async wallet => registryMode === 'verified'
    ? ({ status:'verified', identity: {
      standard:'solana-agent-registry-erc8004', globalId:'sol:' + REGISTRY_ASSET,
      asset:REGISTRY_ASSET, agentWallet:wallet, owner:null, name:'FIXTURE AGENT',
      uri:null, trustTier:'verified', qualityScore:null, confidence:null,
      riskScore:null, feedbackCount:0, verifiedAt:'2026-08-28T00:00:00.000Z', source:'fixture' } })
    : ({ status:registryMode }) } };

let facilitatorMode = 'valid';
let supportedCalls = 0;
const verifyCalls = [], settleCalls = [];
const facilitator = {
  async getSupported() {
    supportedCalls++;
    if (facilitatorMode === 'unavailable') throw new Error('fixture facilitator offline');
    if (facilitatorMode === 'unsupported') return { kinds:[], extensions:[], signers:{} };
    return { kinds:[{ x402Version:2, scheme:'exact', network:MAINNET,
      extra:{ feePayer:FEE_PAYER } }], extensions:['bazaar'], signers:{} };
  },
  async verify(payload, requirements) {
    verifyCalls.push({ payload, requirements });
    if (facilitatorMode === 'verify-throws') throw new Error('verify transport failure');
    if (facilitatorMode === 'invalid') return { isValid:false, invalidReason:'insufficient_funds',
      invalidMessage:'fixture payment is not valid' };
    return { isValid:true, payer:'FixturePayer111111111111111111111111111111' };
  },
  async settle(payload, requirements) {
    settleCalls.push({ payload, requirements });
    if (facilitatorMode === 'settle-throws') throw new Error('settle transport failure');
    if (facilitatorMode === 'settle-fails') return { success:false,
      errorReason:'transaction_failed', errorMessage:'fixture settlement failed',
      transaction:'', network:MAINNET };
    return { success:true, payer:'FixturePayer111111111111111111111111111111',
      transaction:'SettledTx' + String(settleCalls.length).padStart(4,'0'), network:MAINNET };
  },
};

const x402 = require('../lib/x402.js');
x402.setFacilitatorForTest(facilitator);
const game = require('../api/game.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = null;
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  }
  const fake = { method:req.method, query:Object.fromEntries(u.searchParams), body,
    headers:{ ...req.headers, 'x-forwarded-for':req.headers['x-test-ip'] || '7.7.7.7' }, socket:{} };
  const out = { _s:200, _h:{}, status(c){this._s=c;return this;},
    setHeader(k,v){this._h[k]=v;return this;},
    end(){ res.writeHead(this._s,this._h); res.end(); },
    json(o){ res.writeHead(this._s, {'content-type':'application/json', ...this._h}); res.end(JSON.stringify(o)); } };
  try { await game(fake, out); } catch (e) { out.status(500).json({ok:false,reason:String(e)}); }
});
await new Promise(r => srv.listen(8303, r));

let callNo = 0;
const call = (body, headers = {}) => fetch('http://127.0.0.1:8303', {
  method:'POST', headers:{ 'content-type':'application/json', 'x-test-ip':`7.7.7.${++callNo}`, ...headers },
  body:JSON.stringify(body),
}).then(async r => ({ status:r.status, body:await r.json(), headers:r.headers }));
const board = () => fetch('http://127.0.0.1:8303?action=board').then(r => r.json());

// Identity helpers use the live timestamp-signature scheme.
const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = buf => { let n=0n; for (const b of buf) n=n*256n+BigInt(b);
  let s=''; while(n>0n){s=B58A[Number(n%58n)]+s;n/=58n;}
  for(const b of buf){if(b===0)s='1'+s;else break;} return s; };
const mkWallet = () => { const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  return { w:b58(publicKey.export({format:'der',type:'spki'}).subarray(12)), sk:privateKey }; };
const authFor = ({w,sk}) => { const ts=Date.now(); return { wallet:w,ts,
  sig:crypto.sign(null,Buffer.from(`RATCHET | ${w} | ${ts}`,'utf8'),sk).toString('base64') }; };

const mem = () => globalThis.__ratchet_mem;
const setMem = (k,v) => mem().set(k,JSON.stringify(v));
const getMem = k => mem().has(k) ? JSON.parse(mem().get(k)) : null;
const seedPlayer = (w,qualified) => setMem(`u:${w}`, { w,xp:0,streak:0,best:0,hits:0,
  shots:0,cr:1000,granted:true,qualified,burned:0,
  day:new Date().toISOString().slice(0,10),open:[],closed:[] });

const preflight=await fetch('http://127.0.0.1:8303',{method:'OPTIONS',headers:{
  origin:'https://agent.example','access-control-request-method':'POST',
  'access-control-request-headers':'payment-signature,content-type'}});
ok(preflight.status===204
  && /PAYMENT-SIGNATURE/i.test(preflight.headers.get('access-control-allow-headers')||'')
  && /PAYMENT-RESPONSE/i.test(preflight.headers.get('access-control-expose-headers')||''),
  'browser agent wallets can preflight and read the standard payment headers');
await call({action:'state'});
setMem('g:podium',{period:new Date().toISOString().slice(0,10),v:'live-1',
  list:[{w:CHAMP,pct:0.5},{w:'Second1111',pct:0.3}]});
const A=mkWallet(), B=mkWallet(), C=mkWallet(), D=mkWallet(), Q=mkWallet();
for (const w of [A,B,C,D]) seedPlayer(w.w,false);
seedPlayer(Q.w,true);

const register = (who,name,headers={}) => call({action:'agent-register',auth:authFor(who),name},headers);
const payloadFor = (required, marker='signed-fixture') => ({ x402Version:2,
  resource:required.resource, accepted:required.accepts[0], payload:{ transaction:marker } });
const headerFor = (required, marker) => encodePaymentSignatureHeader(payloadFor(required,marker));

// 1 — dark means dark: core RCX behavior and machine-readable fallback survive.
delete process.env.X402_ENABLED;
let r=await register(A,'TOLL BOT');
ok(r.status===403 && /has not touched RCX/.test(r.body.reason),
  'flag off: unqualified wallet gets the unchanged RCX rule');
ok(r.body.doors?.find(d=>d.id==='x402')?.open===false
  && r.body.doors?.find(d=>d.id==='demo')?.ranked===false,
  'flag off: refusal remains branchable and points to the free demo');
let boardOut=await board();
let boardDoor=boardOut.arena?.doors.find(d=>d.id==='x402');
ok(boardDoor?.enabled===false && boardDoor.protocolVersion===2
  && boardDoor.requestHeader==='PAYMENT-SIGNATURE' && /funded mainnet/.test(boardDoor.armingBlocker),
  'board reports the standard v2 implementation and exact arming blocker');

// 2 — a real v2 PaymentRequired body and header, bound to the current champion.
process.env.X402_ENABLED='1';
const livePodium=getMem('g:podium'); mem().delete('g:podium');
r=await register(B,'NO CHAMP BOT');
ok(r.status===503 && /no daily champion/.test(r.body.reason)
  && !r.headers.get('payment-required'),
  'armed door without a champion fails explicitly instead of inventing a recipient');
setMem('g:podium',livePodium);
r=await register(A,'TOLL BOT');
const quote=r.body, requiredHeader=r.headers.get('payment-required');
const decodedRequired=requiredHeader && decodePaymentRequiredHeader(requiredHeader);
ok(r.status===402 && quote.x402Version===2 && quote.accepts?.[0]?.scheme==='exact',
  'flag on: registration returns a standard x402 v2 requirement');
ok(decodedRequired && JSON.stringify(decodedRequired)===JSON.stringify(quote),
  'PAYMENT-REQUIRED carries the same canonical requirement as the body');
ok(quote.accepts[0].payTo===CHAMP && quote.accepts[0].amount==='1000000'
  && quote.accepts[0].asset===USDC && quote.accepts[0].network===MAINNET
  && quote.accepts[0].extra.feePayer===FEE_PAYER
  && /^ratchetx:[a-f0-9]{32}$/.test(quote.accepts[0].extra.memo),
  'quote fixes champion, amount, USDC, CAIP-2 network, fee payer and unique memo');
ok(supportedCalls===1,'facilitator capability is proved before any quote is issued');

boardOut=await board(); boardDoor=boardOut.arena?.doors.find(d=>d.id==='x402');
ok(boardDoor?.enabled===true && boardDoor.payTo===CHAMP && boardDoor.network===MAINNET
  && /standard v2 facilitator/.test(boardDoor.protocolStatus),
  'board advertises the armed protocol and live recipient without claiming Bazaar listing');

// 3 — legacy/manual and malformed headers never reach the facilitator.
let before=verifyCalls.length;
r=await register(B,'LEGACY BOT',{'x-payment':'OldManualTransactionSignature'});
ok(r.status===402 && r.body.x402Version===2 && verifyCalls.length===before,
  'legacy X-PAYMENT is ignored and receives a fresh standard quote');
r=await register(B,'BROKEN BOT',{'payment-signature':'not base64'});
ok(r.status===402 && /invalid PAYMENT-SIGNATURE/.test(r.body.error)
  && verifyCalls.length===before,'malformed v2 header is actionable and never reaches verify');

// 4 — quote binding blocks amount edits, wallet replay and name replay.
const tampered=payloadFor(quote); tampered.accepted={...tampered.accepted,amount:'1'};
r=await register(A,'TOLL BOT',{'payment-signature':encodePaymentSignatureHeader(tampered)});
ok(r.status===402 && /requirements do not match/.test(r.body.error)
  && verifyCalls.length===before,'amount/recipient requirements cannot be altered after quote');
const originalHeader=headerFor(quote,'original-payment');
r=await register(B,'TOLL BOT',{'payment-signature':originalHeader});
ok(r.status===402 && /different signed wallet or agent name/.test(r.body.error)
  && verifyCalls.length===before,'another wallet cannot reuse a quote');
r=await register(A,'RENAMED BOT',{'payment-signature':originalHeader});
ok(r.status===402 && /different signed wallet or agent name/.test(r.body.error)
  && verifyCalls.length===before,'the quoted wallet cannot spend it on another agent name');

// 5 — an occupied name is rejected before verify or settlement can move money.
r=await register(C,'TAKEN BOT');
const takenQuote=r.body, takenHeader=headerFor(takenQuote,'must-not-settle');
setMem('agentname:TAKEN BOT',{w:B.w,t:Date.now()});
const verifiesBeforeTaken=verifyCalls.length, settlesBeforeTaken=settleCalls.length;
r=await register(C,'TAKEN BOT',{'payment-signature':takenHeader});
ok(r.status===409 && /name is taken/.test(r.body.reason)
  && verifyCalls.length===verifiesBeforeTaken && settleCalls.length===settlesBeforeTaken,
  'name availability is proved under the arena lease before facilitator settlement');

// 6 — podium drift cannot turn an in-flight quote into payment to the wrong player.
setMem('g:podium',{period:new Date().toISOString().slice(0,10),v:'live-2',list:[{w:NEW_CHAMP,pct:0.8}]});
r=await register(A,'TOLL BOT',{'payment-signature':originalHeader});
const paymentResponse=r.headers.get('payment-response');
const decodedResponse=paymentResponse && decodePaymentResponseHeader(paymentResponse);
ok(r.status===200 && r.body.ok===true && r.body.entry==='x402-toll-to-champion'
  && r.body.qualified===false && r.body.admitted===true && r.body.x402?.paidTo===CHAMP,
  'valid v2 payment admits the agent while honestly keeping RCX qualification false');
ok(decodedResponse?.success===true && decodedResponse.network===MAINNET
  && decodedResponse.transaction===r.body.x402.sig,
  'PAYMENT-RESPONSE returns the facilitator settlement receipt');
ok(verifyCalls.at(-1)?.requirements.payTo===CHAMP
  && settleCalls.at(-1)?.requirements.payTo===CHAMP,
  'verify and settle use the durable quoted champion even after the podium changes');
ok(r.body.agent.identity?.globalId==='sol:'+REGISTRY_ASSET,
  'paid entry still links the independent Solana Agent Registry identity');

// 7 — settlement survives a hypothetical player-write loss; no second charge.
const paidPlayer=getMem(`u:${A.w}`), settledCount=settleCalls.length;
delete paidPlayer.x402Entry; setMem(`u:${A.w}`,paidPlayer);
r=await register(A,'TOLL BOT',{'payment-signature':originalHeader});
ok(r.status===200 && settleCalls.length===settledCount && r.body.x402?.sig===decodedResponse.transaction,
  'same settled quote repairs a lost player write without settling or charging twice');
r=await register(A,'TOLL BOT');
ok(r.status===200 && settleCalls.length===settledCount && r.body.entry==='x402-toll-to-champion',
  'a persisted x402 entrant can re-register without paying the toll again');

// 8 — facilitator refusals are machine-readable 402s, never admissions.
facilitatorMode='invalid';
r=await register(D,'INVALID PAY'); const invalidQuote=r.body;
r=await register(D,'INVALID PAY',{'payment-signature':headerFor(invalidQuote,'invalid')});
ok(r.status===402 && /fixture payment is not valid/.test(r.body.error),
  'facilitator verification refusal is returned as a retryable payment requirement');
facilitatorMode='settle-fails';
r=await register(D,'FAILED SETTLE'); const failedQuote=r.body;
r=await register(D,'FAILED SETTLE',{'payment-signature':headerFor(failedQuote,'settle-fail')});
ok(r.status===402 && /fixture settlement failed/.test(r.body.error),
  'failed settlement never becomes an arena admission');
ok(!getMem(`u:${D.w}`).agent,'verification and settlement failures leave the player unregistered');

// 9 — RCX-native behavior and registry fail-open semantics remain untouched.
facilitatorMode='valid';
r=await register(Q,'RCX NATIVE');
ok(r.status===200 && r.body.entry==='rcx' && r.body.qualified===true,
  'RCX-qualified wallets register exactly as before and never call x402');
registryMode='unavailable';
r=await register(Q,'RCX NATIVE');
ok(r.status===200 && r.body.agent.identity?.globalId==='sol:'+REGISTRY_ASSET,
  'registry outage cannot block registration or erase prior provenance');
registryMode='not-found';
r=await register(Q,'RCX NATIVE');
ok(r.status===200 && !r.body.agent.identity,
  'a later clean exact registry miss removes stale external provenance');

delete process.env.X402_ENABLED;
x402.setFacilitatorForTest(null);
console.log(failn===0?'\nALL PASS':`\n${failn} FAILED`);
process.exitCode=failn?1:0;
srv.closeAllConnections?.();
await new Promise(r=>srv.close(()=>r()));
setTimeout(()=>process.exit(process.exitCode||0),3000).unref();
