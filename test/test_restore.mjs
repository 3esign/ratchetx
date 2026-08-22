import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const run = (args, env) => new Promise(resolve => execFile(process.execPath, args, { env },
  (error, stdout, stderr) => resolve({ code:error?.code || 0, out:stdout + stderr })));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-restore-'));
const event = { i:1, t:1700000000000, ev:{ k:'test', amount:7 } };
event.h = sha(sha('ratchet-genesis') + JSON.stringify({ i:event.i, t:event.t, ev:event.ev }));
const state = {
  stats:{ burned:700, pot:150, potD:150 },
  season:'s2026w34', day:'2026-08-22',
  podium:{ period:'2026-08-22', list:[{w:'A',pct:.5}] },
  podiumPrev:{ period:'2026-08-21', list:[{w:'P',pct:.5}] },
  podiumFallback:{ day:'2026-08-22', from:'2026-08-21', list:[{w:'P',pct:.5}] },
  podiumHistory:[{ id:'old', until:1700000600000, list:[{w:'P',pct:.5}] }],
  feed:[], anchors:[],
  warden:{ rec:null, hist:[], open:[] },
  results:{ day:null, season:null },
  players:{ A:{ w:'A', cr:100, xp:42, open:[{id:'s1',src:'cr',stake:100,allocationRule:'on-settle-v2'}], closed:[] } },
  pending:{ A:9 }, championPending:{ A:11 }, championSelfPending:{ A:13 },
  sigs:{ sig1:{w:'A'} }, boards:{},
  sortedBoards:{ 'z:lba:all':[['A',42]], 'z:lbd:2026-08-22':[['A',7]] },
  hists:{ A:[{id:'s1'}] }, championHists:{ A:[{id:'r1',sig:'sig1'}] },
  log:[event], logHead:{i:1,h:event.h}, logIssued:1,
};
const snap = { ok:true, state, sha256:sha(JSON.stringify(state)), logComplete:true };
const file = path.join(tmp, 'snapshot.json');
fs.writeFileSync(file, JSON.stringify(snap));

const strings = new Map(), sorted = new Map();
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const cmd = JSON.parse(body || '[]'), op = String(cmd[0] || '').toUpperCase();
  let result = null;
  if (op === 'GET') result = strings.has(cmd[1]) ? strings.get(cmd[1]) : null;
  else if (op === 'SET') { strings.set(cmd[1], cmd[2]); result = 'OK'; }
  else if (op === 'ZADD') {
    const z = sorted.get(cmd[1]) || new Map();
    for (let i=2;i<cmd.length;i+=2) z.set(String(cmd[i+1]), Number(cmd[i]));
    sorted.set(cmd[1], z); result = z.size;
  } else { res.statusCode=400; res.end(JSON.stringify({error:'unsupported '+op})); return; }
  res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ result }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, KV_REST_API_URL:url, KV_REST_API_TOKEN:'test-token' };
const restore = path.resolve('..', 'scripts', 'restore.mjs');

try {
  let r = await run([restore, file], env);
  ok(r.code === 0 && /restored \d+ keys/.test(r.out), 'restore completes against a fresh KV');
  ok(JSON.parse(strings.get('g:podium:fallback')).list[0].w === 'P'
    && JSON.parse(strings.get('g:podium:history'))[0].id === 'old',
    'restore preserves dynamic podium fallback and signing-grace history');
  ok(sorted.get('z:lba:all')?.get('A') === 42
    && sorted.get('z:lbd:2026-08-22')?.get('A') === 7,
    'restore recreates all-time and daily sorted-set XP');
  const player = JSON.parse(strings.get('u:A'));
  ok(player.cr === 200 && player.open.length === 0,
    'restore honestly void-refunds sealed open shots');
  ok(JSON.parse(strings.get('pend:A')) === 9 && JSON.parse(strings.get('c7:A')) === 11
    && JSON.parse(strings.get('cs7:A')) === 13,
    'restore preserves credit, incoming-RCX and self-retained queues');
  ok(JSON.parse(strings.get('chist:A'))[0].sig === 'sig1',
    'restore preserves transaction-linked reward receipts');

  const bad = structuredClone(snap); bad.state.stats.burned = 701;
  const badFile = path.join(tmp, 'corrupt.json'); fs.writeFileSync(badFile, JSON.stringify(bad));
  r = await run([restore, badFile, '--check'], env);
  ok(r.code !== 0 && /SNAPSHOT HASH DIFFERS/.test(r.out),
    'restore refuses state changed outside the hash envelope');

  const badChain = structuredClone(snap); delete badChain.state.log[0].h;
  badChain.state.logHead.h = event.h; badChain.sha256 = sha(JSON.stringify(badChain.state));
  const chainFile = path.join(tmp, 'broken-chain.json'); fs.writeFileSync(chainFile, JSON.stringify(badChain));
  r = await run([restore, chainFile, '--check'], env);
  ok(r.code !== 0 && /CHAIN BROKEN/.test(r.out),
    'restore refuses a log entry with a missing hash');
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmp, { recursive:true, force:true });
}

console.log(fails ? `\n${fails} FAILED` : '\nRESTORE OK');
process.exitCode = fails ? 1 : 0;
