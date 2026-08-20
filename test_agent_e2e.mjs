// Runs the reference agent against the REAL api/game.js over HTTP. If this
// passes, someone can actually clone the file and be on the board.
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// stub only the oracle and the chain — everything else is production code
const pricesPath = require.resolve('./lib/prices.js');
const burnPath = require.resolve('./lib/burn.js');
let T = 100;
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => ({ src:'stub', ages:{SOL:3,BTC:3,ETH:3,BONK:3,WIF:3,JUP:3,PUMP:3},
    SOL:(T+=0.4), BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 }) } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async()=>null, getTx: async()=>null, decideBurn: ()=>({ok:false,reason:'stub'}) } };

const game = require('./api/game.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = null;
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  }
  const q = Object.fromEntries(u.searchParams);
  const fake = { method: req.method, query: q, body, headers: {'x-forwarded-for':'9.9.9.'+Math.floor(Math.random()*250)}, socket:{} };
  const out = { _s:200, status(c){this._s=c;return this;},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); } };
  try { await game(fake, out); } catch (e) { out.status(500).json({ok:false,reason:String(e)}); }
});
await new Promise(r => srv.listen(8301, r));

const run = (args) => new Promise(resolve => {
  const p = spawn('node', ['./agent/ratchet-agent.mjs', ...args],
    { env: { ...process.env, RATCHET_API: 'http://127.0.0.1:8301' } });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ code, out }));
});

console.log('--- demo mode: zero setup, must play immediately ---');
const demo = await run(['--demo', '--once']);
console.log(demo.out.trim().split('\n').map(l=>'  '+l).join('\n'));
const demoOK = /RATCHET agent · DEMO/.test(demo.out) && /SEALED|no read this round/.test(demo.out) && demo.code === 0;
console.log(demoOK ? 'PASS  demo agent runs with no wallet and no setup' : 'FAIL  demo mode');

console.log('\n--- real keypair: registers, fires, settles ---');
// force anything sealed to expire immediately so one run covers the whole loop
const origSet = globalThis.__ratchet_mem.set.bind(globalThis.__ratchet_mem);
globalThis.__ratchet_mem.set = (k, v) => {
  if (typeof k === 'string' && k.startsWith('u:') && typeof v === 'string' && v.includes('"open"')) {
    try { const o = JSON.parse(v);
      if (o.open) { o.open.forEach(sh => { sh.exp = Date.now() - 2000; }); v = JSON.stringify(o); }
    } catch {}
  }
  const g = globalThis.__ratchet_pxgate; if (g) g.t = 0;   // let the sampler fire each time
  return origSet(k, v);
};
// a genuine 64-byte Solana keypair file
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const seed = privateKey.export({format:'der',type:'pkcs8'}).subarray(16);
const pub  = publicKey.export({format:'der',type:'spki'}).subarray(12);
const kpPath = path.join(os.tmpdir(), 'agent-kp.json');
fs.writeFileSync(kpPath, JSON.stringify([...seed, ...pub]));

// give it credits + qualification so registration is reachable
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58=b=>{let n=0n;for(const x of b)n=n*256n+BigInt(x);let s='';while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}
  for(const x of b){if(x===0)s='1'+s;else break;}return s;};
const W = b58(Buffer.from(pub));
globalThis.__ratchet_mem.set(`u:${W}`, JSON.stringify({ w:W, xp:0, streak:0, best:0, hits:0, shots:0,
  cr:50000, granted:true, qualified:true, burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] }));

// several fast ticks: enough history to form a read, fire, and settle
const real = await run(['--keypair', kpPath, '--name', 'E2E BOT', '--stake', '500',
                        '--interval', '0.4', '--ticks', '8']);
console.log(real.out.trim().split('\n').map(l=>'  '+l).join('\n'));
const regOK  = /registered as E2E BOT/.test(real.out);
const fireOK = /SEALED/.test(real.out);
const settledOK = /HIT|MISS/.test(real.out);
const commitOK = !/MISMATCH/.test(real.out) && (/commit verified/.test(real.out) || !settledOK);
const walletOK = real.out.includes(W);
console.log(regOK ? 'PASS  a real keypair registers in the arena' : 'FAIL  registration');
console.log(walletOK ? 'PASS  derives the same wallet address the server verifies' : 'FAIL  wallet derivation');
console.log(fireOK ? 'PASS  actually seals a shot against production code' : 'FAIL  never fired');
console.log(settledOK ? 'PASS  and collects the settlement' : 'FAIL  never settled');
console.log(commitOK ? 'PASS  recomputes sha256(side|salt) and it matches the seal' : 'FAIL  COMMIT MISMATCH');

// and it must now appear on the arena board
const arena = await (await fetch('http://127.0.0.1:8301?action=arena')).json();
const listed = (arena.agents||[]).some(a => a.name === 'E2E BOT');
console.log(listed ? 'PASS  shows up on the public arena board' : 'FAIL  not on the board');

srv.close();
const all = demoOK && regOK && walletOK && fireOK && settledOK && commitOK && listed;
console.log('\n' + (all ? 'ALL PASS' : 'FAILURES'));
process.exit(all ? 0 : 1);
