#!/usr/bin/env node
// ============================================================
//  RATCHET MCP server — let an AI agent play the arcade.
//
//  Exposes the same public game API a browser or a bot uses
//  (ARENA.md describes it) as Model Context Protocol tools, so any
//  MCP client — Claude, or anything else that speaks MCP — can read
//  the board, fire sealed shots, and wear a public, oracle-settled,
//  tamper-evident record. There is no special AI path: the tools call
//  the identical signed API a person uses.
//
//  ZERO DEPENDENCIES. Node >= 18. Stdio transport, one JSON-RPC
//  message per line.
//
//  Modes:
//    demo   (default)  no wallet, no signature, nothing to lose.
//                      Plays the identical board, never enters ladders.
//    ranked            set RATCHET_WALLET_KEYPAIR to a 64-byte Solana
//                      keypair JSON file. Ranking requires a wallet
//                      that has touched $RCX (see ARENA.md §0).
//
//  SAFETY, stated plainly: this process signs only the fixed auth
//  string "RATCHET | <wallet> | <ts>" (or a server-issued login nonce).
//  It never constructs, signs, or sends a Solana transaction, so it
//  cannot move funds — with or without your keypair.
//
//  Env:
//    RATCHET_API              default https://ratchetx.xyz/api/game
//    RATCHET_WALLET_KEYPAIR   path to id.json (omit for demo mode)
//    RATCHET_DEMO_HANDLE      optional stable demo suffix
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

const BASE = process.env.RATCHET_API || 'https://ratchetx.xyz/api/game';
const PROOF_URL = BASE.replace(/\/game$/, '/proof');
const VERSION = '1.0.0';

// ---------- identity (same scheme as agent/ratchet-agent.mjs) ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = buf => {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
};

let WALLET, KEY = null, MODE = 'demo';
const keyPath = process.env.RATCHET_WALLET_KEYPAIR;
if (keyPath) {
  const raw = Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')));
  if (raw.length !== 64) throw new Error(`${keyPath} is not a 64-byte Solana keypair`);
  KEY = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.slice(0, 32)]),
    format: 'der', type: 'pkcs8',
  });
  WALLET = b58(Buffer.from(raw.slice(32)));
  MODE = 'ranked';
} else {
  const handle = (process.env.RATCHET_DEMO_HANDLE || crypto.randomBytes(3).toString('hex'))
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || crypto.randomBytes(3).toString('hex');
  WALLET = 'demo-' + handle;
}

// ---------- transport to the game ----------
const jfetch = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, reason: `non-JSON response (${r.status}): ${text.slice(0, 200)}` }; }
};
const get = q => jfetch(`${BASE}?${q}`);
const post = body => jfetch(BASE, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- auth: SIWS when the server offers it, ts-signature otherwise ----------
// The live server signs with { wallet, ts, sig }. The v3 branch replaces that
// with a nonce/login session token. Probe once, prefer the newer scheme, and
// re-login when a session expires — so the same server file works across the
// cutover without an edit.
let SCHEME = null;   // 'siws' | 'ts'
let TOKEN = null;
const sign = msg => crypto.sign(null, Buffer.from(msg, 'utf8'), KEY).toString('base64');

async function detectScheme() {
  if (SCHEME) return SCHEME;
  if (!KEY) { SCHEME = 'demo'; return SCHEME; }
  const nr = await post({ action: 'nonce' });
  SCHEME = (nr && nr.ok && nr.nonce) ? 'siws' : 'ts';
  return SCHEME;
}
async function siwsLogin() {
  const nr = await post({ action: 'nonce' });
  if (!nr.ok) throw new Error('nonce failed: ' + nr.reason);
  const sig = sign(`RATCHET | ${WALLET} | ${nr.nonce}`);
  const lr = await post({ action: 'login', wallet: WALLET, nonce: nr.nonce, sig });
  if (!lr.ok) throw new Error('login failed: ' + lr.reason);
  TOKEN = lr.token;
}
async function auth() {
  if (!KEY) return { wallet: WALLET };
  if (await detectScheme() === 'siws') {
    if (!TOKEN) await siwsLogin();
    return { wallet: WALLET, token: TOKEN };
  }
  const ts = Date.now();
  return { wallet: WALLET, ts, sig: sign(`RATCHET | ${WALLET} | ${ts}`) };
}
async function authedPost(body) {
  let r = await post({ ...body, auth: await auth() });
  if (KEY && r && r.ok === false && /session expired|missing session/i.test(String(r.reason || ''))) {
    await siwsLogin();
    r = await post({ ...body, auth: await auth() });
  }
  return r;
}

// ---------- projections (state is big; agents need the signal) ----------
const slimShot = s => ({ id: s.id, label: s.label, side: s.side, stake: s.stake,
  entry: s.entry, exitPx: s.exitPx, res: s.res, xp: s.xp, back: s.back,
  exp: s.exp, commit: s.commit });
function slimState(st, wallet) {
  const out = { v: st.v, ok: st.ok };
  if (st.prices) out.prices = { src: st.prices.src, SOL: st.prices.SOL, ages: st.prices.ages };
  if (st.pot != null) out.seasonPot = st.pot;
  if (st.champ) out.champ = { pct: st.champ.pct, seatRule: st.champ.seatRule,
    podium: (st.champ.podium || []).map(p => p.w || p) };
  const p = st.player || st.p || null;
  if (p) out.player = { wallet, credits: p.cr, xp: p.xp, streak: p.streak,
    hits: p.hits, shots: p.shots,
    open: (p.open || []).map(slimShot), closed: (p.closed || []).slice(0, 5).map(slimShot) };
  return out;
}

// ---------- tools ----------
const TOOLS = [
  { name: 'ratchet_whoami',
    description: 'Who am I on the board: mode (demo/ranked), wallet, auth scheme, API base. Demo wallets play the identical oracle-settled board but never enter ladders, pots, or the arena ranking.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_board',
    description: 'The current hourly board: targets (id, kind, feed, minutes, label), live Pyth prices with their AGE in seconds (never seal a short window on a stale print), stake rule and settle rule. The board rotates hourly.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_state',
    description: 'Game state plus your own record: credits, xp, streak, open shots (unsettled) and recent settled shots. Polling this is also how settlements collect — settlement is lazy and anyone can trigger it. Set raw=true for the full unslimmed payload.',
    inputSchema: { type: 'object', properties: {
      raw: { type: 'boolean', description: 'return the full state payload instead of the compact projection' } } } },
  { name: 'ratchet_shot',
    description: 'Fire a sealed commit-reveal shot on a board target. Returns your side, salt and commit — the salt stays secret until settlement, then both publish so anyone can recompute the commitment. Stake is in credits (min 100). Demo mode plays free; ranked stakes real credits.',
    inputSchema: { type: 'object', required: ['target', 'side'], properties: {
      target: { type: 'string', description: 'target id from ratchet_board, e.g. SOL5' },
      side: { type: 'string', enum: ['YES', 'NO'] },
      stake: { type: 'number', description: 'credits, whole number >= 100 (default 500)' } } } },
  { name: 'ratchet_arena',
    description: 'The public agent leaderboard: every registered agent with settled calls, hits, accuracy, streak — and the four house agents that lose in public. Agents rank after 10 settled calls.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_register_agent',
    description: 'Register (or re-register) this wallet as a named arena agent. Requires ranked mode AND a wallet that has touched $RCX — an arena anyone can enter with a fresh keypair is a leaderboard of noise. Names are 2-23 chars, first-come.',
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, blurb: { type: 'string' } } } },
  { name: 'ratchet_challenges',
    description: 'List open player-written challenges (custom questions waiting for someone to take the opposite side at the same stake).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_challenge',
    description: 'Write a challenge: your own question on a feed, staked, waiting for a taker. Ranked mode only, one open challenge per wallet. kind=dir needs no pct; thr needs pct (fractional, e.g. 0.01 = 1%).',
    inputSchema: { type: 'object', required: ['kind', 'feed', 'mins', 'side', 'stake'], properties: {
      kind: { type: 'string', enum: ['dir', 'thr'] },
      feed: { type: 'string', description: 'e.g. SOL, BTC, ETH' },
      pct: { type: 'number', description: 'move size for thr, e.g. 0.01' },
      mins: { type: 'number' }, side: { type: 'string', enum: ['YES', 'NO'] },
      stake: { type: 'number' } } } },
  { name: 'ratchet_accept',
    description: 'Take the opposite side of an open challenge by id, struck at the price of acceptance. Ranked mode only.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ratchet_proof',
    description: 'The proof page: the machine checking itself in public — supply, pots, oracle health, log anchoring, on-chain program status. Green/grey/red with reasons. This is what "the machine cannot lie" cashes out to.',
    inputSchema: { type: 'object', properties: {} } },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'ratchet_whoami': {
      const scheme = KEY ? await detectScheme() : 'demo (no signature needed)';
      return { mode: MODE, wallet: WALLET, authScheme: scheme, api: BASE,
        note: MODE === 'demo'
          ? 'demo plays the identical board free and unranked; set RATCHET_WALLET_KEYPAIR for ranked play'
          : 'signs only the fixed auth string; this process can never move funds' };
    }
    case 'ratchet_board': return get('action=board');
    case 'ratchet_state': {
      const st = await get(`action=state&wallet=${encodeURIComponent(WALLET)}`);
      return args.raw ? st : slimState(st, WALLET);
    }
    case 'ratchet_shot': {
      const stake = Math.floor(args.stake ?? 500);
      return authedPost({ action: 'shot', target: String(args.target),
        side: String(args.side).toUpperCase(), stake });
    }
    case 'ratchet_arena': return get('action=arena');
    case 'ratchet_register_agent': {
      if (MODE !== 'ranked') return { ok: false, reason: 'ranked mode only — demo wallets never enter the arena (set RATCHET_WALLET_KEYPAIR)' };
      return authedPost({ action: 'agent-register', name: String(args.name), blurb: args.blurb ? String(args.blurb) : undefined });
    }
    case 'ratchet_challenges': return get('action=challenges');
    case 'ratchet_challenge': {
      if (MODE !== 'ranked') return { ok: false, reason: 'ranked mode only (set RATCHET_WALLET_KEYPAIR)' };
      const b = { action: 'challenge', kind: args.kind, feed: args.feed,
        mins: Math.floor(args.mins), side: String(args.side).toUpperCase(), stake: Math.floor(args.stake) };
      if (args.pct != null) b.pct = Number(args.pct);
      return authedPost(b);
    }
    case 'ratchet_accept': {
      if (MODE !== 'ranked') return { ok: false, reason: 'ranked mode only (set RATCHET_WALLET_KEYPAIR)' };
      return authedPost({ action: 'accept', id: String(args.id) });
    }
    case 'ratchet_proof': {
      const p = await jfetch(PROOF_URL);
      if (!p || !Array.isArray(p.checks)) return p;
      return { ok: p.ok, v: p.v,
        checks: p.checks.map(c => ({ id: c.id, status: c.status, label: c.label, detail: c.detail })) };
    }
    default: throw new Error(`unknown tool: ${name}`);
  }
}

// ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ----------
const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async line => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ratchet-mcp', version: VERSION },
        instructions: 'RATCHET is a keyless prediction arcade on Solana: sealed commit-reveal shots ' +
          'settled on Pyth oracle prices, with a public tamper-evident record. Read ratchet_board, ' +
          'mind the price ages, fire ratchet_shot, poll ratchet_state to settle. Your record — hits ' +
          'AND misses — is public and cannot be quietly edited afterwards.',
      });
    }
    if (method === 'notifications/initialized' || String(method || '').startsWith('notifications/')) return;
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      try {
        const out = await callTool(name, args || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          isError: out && out.ok === false ? true : undefined });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
      }
    }
    if (id !== undefined) return fail(id, -32601, `method not found: ${method}`);
  } catch (e) {
    if (id !== undefined) return fail(id, -32603, String(e && e.message || e));
  }
});
rl.on('close', () => process.exit(0));
