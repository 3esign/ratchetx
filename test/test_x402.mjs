// x402 arena entry: the toll is paid to the CURRENT DAILY CHAMPION — a player,
// never us — and the server only verifies the transfer on-chain. This drives
// the real handler over HTTP with a stubbed chain, both flag states, quote
// shape, verification, replay, underpay, and staleness.
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, failn = 0;
const ok = (c, label) => { if (c) { pass++; console.log('PASS  ' + label); }
  else { failn++; console.log('FAIL  ' + label); } };

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CHAMP = 'Champ1onWa11etxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// stub the oracle and the chain; TXS is the fixture ledger getTx reads from
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
let T = 100;
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t=Math.floor(Date.now()/1000), scale=(T+=0.4)/100; return { src:'pyth-onchain',
    ages:Object.fromEntries(FEEDS.map(f=>[f,3])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    SOL:T, BTC:60000*scale, ETH:2000*scale, BONK:0.000002*scale, WIF:0.1*scale, JUP:0.2*scale, PUMP:0.005*scale }; } } };
const TXS = new Map();
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async()=>null, getTx: async sig => TXS.get(sig) || null,
    decideBurn: ()=>({ok:false,reason:'stub'}) } };

const game = require('../api/game.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = null;
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  }
  const q = Object.fromEntries(u.searchParams);
  const fake = { method: req.method, query: q, body,
    headers: { 'x-forwarded-for': '7.7.7.7', ...(req.headers['x-payment'] ? { 'x-payment': req.headers['x-payment'] } : {}) },
    socket: {} };
  const out = { _s:200, status(c){this._s=c;return this;},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); } };
  try { await game(fake, out); } catch (e) { out.status(500).json({ok:false,reason:String(e)}); }
});
// 8303 on purpose: 8301 belongs to test_agent_e2e, 8302 to test_mcp.
await new Promise(r => srv.listen(8303, r));

const call = (body, headers = {}) => fetch('http://127.0.0.1:8303', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));

// identity helpers (live ts-signature scheme)
const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = buf => { let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; } return s; };
const mkWallet = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { w: b58(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)), sk: privateKey };
};
const authFor = ({ w, sk }) => { const ts = Date.now();
  return { wallet: w, ts, sig: crypto.sign(null, Buffer.from(`RATCHET | ${w} | ${ts}`, 'utf8'), sk).toString('base64') }; };

// seed: an unqualified player and a live podium with a champion on top
const mem = () => globalThis.__ratchet_mem;
const setMem = (k, v) => mem().set(k, JSON.stringify(v));
const seedPlayer = (w, qualified) => setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0,
  shots:0, cr:1000, granted:true, qualified, burned:0,
  day: new Date().toISOString().slice(0,10), open:[], closed:[] });

await call({ action: 'state' } ,{});   // boot the module state
setMem('g:podium', { period: new Date().toISOString().slice(0,10), v:'live-1',
  list: [{ w: CHAMP, pct: 0.5 }, { w: 'Second1111', pct: 0.3 }] });

const A = mkWallet(), B = mkWallet(), Q = mkWallet();
seedPlayer(A.w, false); seedPlayer(B.w, false); seedPlayer(Q.w, true);

const paySig  = 'PayS1g' + 'x'.repeat(58);
const poorSig = 'PoorS1g' + 'x'.repeat(57);
const oldSig  = 'A9edS1g' + 'x'.repeat(57);
const now = () => Math.floor(Date.now() / 1000);
const mkPay = (to, amount, blockTime) => ({ blockTime, meta: { err: null,
  preTokenBalances:  [{ accountIndex: 1, mint: USDC, owner: to, uiTokenAmount: { amount: '0', decimals: 6 } }],
  postTokenBalances: [{ accountIndex: 1, mint: USDC, owner: to, uiTokenAmount: { amount: String(amount), decimals: 6 } }] } });
TXS.set(paySig,  mkPay(CHAMP, 1_000_000, now() - 5));
TXS.set(poorSig, mkPay(CHAMP,   999_999, now() - 5));
TXS.set(oldSig,  mkPay(CHAMP, 1_000_000, now() - 3600));

// 1 ---- flag off: the old rule stands, no quote leaks
delete process.env.X402_ENABLED;
let r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' });
ok(r.status === 403 && /has not touched RCX/.test(r.body.reason),
  'flag off: unqualified wallet gets the RCX rule, not a quote');
ok(Array.isArray(r.body.doors) && r.body.doors.find(d => d.id === 'x402').open === false
  && r.body.doors.find(d => d.id === 'demo').ranked === false,
  'flag off: refusal is branchable and still points to the free demo');
let boardOut = await fetch('http://127.0.0.1:8303?action=board').then(x => x.json());
ok(boardOut.arena && boardOut.arena.doors.find(d => d.id === 'x402').enabled === false,
  'the first agent request advertises the arena even while x402 is dark');

// 2 ---- flag on, no payment: a 402 quote naming the current champion
process.env.X402_ENABLED = '1';
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' });
const acc = r.body.accepts && r.body.accepts[0];
ok(r.status === 402 && r.body.x402Version === 1 && acc && acc.scheme === 'exact',
  'flag on: a 402 quote in the x402 shape');
ok(/not compatible with standard x402 v2/.test(r.body.protocolStatus),
  'the prototype does not claim standard-client interoperability');
ok(acc && acc.payTo === CHAMP && acc.asset === USDC && acc.maxAmountRequired === '1000000',
  'the quote names the CURRENT champion as payTo — a player, never us');

boardOut = await fetch('http://127.0.0.1:8303?action=board').then(x => x.json());
const boardDoor = boardOut.arena && boardOut.arena.doors.find(d => d.id === 'x402');
ok(boardDoor && boardDoor.enabled === true && boardDoor.payTo === CHAMP
  && /standard x402 v2 clients are not supported/.test(boardDoor.protocolStatus)
  && boardOut.arena.scoring.minCallsToRank === 10,
  'board advertises the live toll recipient and the scoring credential');

// 3 ---- unreadable header
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' },
  { 'x-payment': '???not-a-signature???' });
ok(r.status === 402 && /unreadable X-PAYMENT/.test(r.body.error), 'garbage header → 402 with the reason');

// 4 ---- unknown signature
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' },
  { 'x-payment': 'Unknown1' + 'x'.repeat(56) });
ok(r.status === 402 && /not found on-chain/.test(r.body.error), 'unknown tx → 402, wait-and-retry reason');

// 5 ---- underpayment
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' },
  { 'x-payment': poorSig });
ok(r.status === 402 && /delivers 999999/.test(r.body.error), 'underpayment is refused with both numbers');

// 6 ---- stale payment
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' },
  { 'x-payment': oldSig });
ok(r.status === 402 && /older than/.test(r.body.error), 'a stale payment is refused');

// 7 ---- the real thing: paid to the champion, registration goes through
r = await call({ action: 'agent-register', auth: authFor(A), name: 'TOLL BOT' },
  { 'x-payment': paySig });
ok(r.status === 200 && r.body.ok === true && r.body.entry === 'x402-toll-to-champion'
  && r.body.x402 && r.body.x402.paidTo === CHAMP,
  'a verified toll to the champion registers the agent and says how it entered');
const arena = await fetch('http://127.0.0.1:8303?action=arena').then(x => x.json());
ok(arena.agents.some(a => a.name === 'TOLL BOT'), 'the x402 entrant appears in the arena');

// 8 ---- replay: the same payment cannot admit a second wallet
r = await call({ action: 'agent-register', auth: authFor(B), name: 'FREERIDER' },
  { 'x-payment': paySig });
ok(r.status === 402 && /already used/.test(r.body.error), 'a spent signature admits nobody else');

// 9 ---- a qualified wallet never sees the toll, flag on or off
r = await call({ action: 'agent-register', auth: authFor(Q), name: 'RCX NATIVE' });
ok(r.status === 200 && r.body.ok === true && r.body.entry === 'rcx',
  'RCX-qualified wallets register exactly as before');

delete process.env.X402_ENABLED;
console.log(failn === 0 ? '\nALL PASS' : `\n${failn} FAILED`);
// Windows/libuv asserts (src\win\async.c, UV_HANDLE_CLOSING) if the process
// tears down while a handle is still closing, which fails the run AFTER every
// assertion has already passed. Drain the server, then let the loop end on its
// own instead of calling process.exit() mid-close.
process.exitCode = failn ? 1 : 0;
srv.closeAllConnections?.();
await new Promise(r => srv.close(() => r()));
setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
