#!/usr/bin/env node
// P6 adversarial canary — executable permanence pack for the C8 generation (Timepin v2 + Core G2 [+ WMv2]).
//
//   node tools/p6-canary/canary.mjs --config p6.json --t0                      write the T0 record (must PASS before the clock starts)
//   node tools/p6-canary/canary.mjs --config p6.json --tick                    one cycle of read-side checks, append to evidence/ticks.jsonl
//   node tools/p6-canary/canary.mjs --config p6.json --run --hours 72          loop ticks every config.intervalSeconds until 72h of chain time
//   node tools/p6-canary/canary.mjs --config p6.json --t72                     final report: thresholds -> PASS | FAIL | INCOMPLETE
//   node tools/p6-canary/canary.mjs --config p6.json --scenarios --adapter ./my-adapter.mjs   run write-side scenarios through an adapter
//
// Principles: chain Clock only (getSlot/getBlockTime), >= 2 operator-chosen RPCs, founder services must be UNREACHABLE,
// everything measured is written as JSON, SKIPPED never counts as PASS, no deploy/spend/freeze from this tool.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { sha256, verifyProgram, compareReadsets, stateRegressions, NEED_ORDER, publishGaps, evaluateThresholds, LOADER_V3 } from './checks.mjs';
import { SCENARIOS, replay, race, rollback, timeout, foldScenario } from './actions.mjs';

// ---------- args (strict) ----------
const BOOL = new Set(['t0', 'tick', 'run', 't72', 'scenarios', 'dry']);
const VAL = new Set(['config', 'hours', 'adapter', 'out']);
const args = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { const n = a[i].replace(/^--/, ''); if (!a[i].startsWith('--') || (!BOOL.has(n) && !VAL.has(n))) die(`unknown or positional argument '${a[i]}'`); if (n in args) die(`duplicate --${n}`); if (BOOL.has(n)) args[n] = true; else { if (!a[i + 1] || a[i + 1].startsWith('--')) die(`--${n} needs a value`); args[n] = a[++i]; } } }
function die(m) { console.error('canary: ' + m); process.exit(2); }
if (!args.config) die('--config <p6.json> is required');
const cfg = JSON.parse(readFileSync(resolve(args.config), 'utf8'));
const outDir = resolve(args.out || cfg.evidenceDir || 'evidence/p6'); mkdirSync(outDir, { recursive: true });
const ticksPath = join(outDir, 'ticks.jsonl'), statePath = join(outDir, 'state.json'), t0Path = join(outDir, 'T0.json');

// ---------- rpc (thin JSON-RPC, injectable) ----------
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  const j = await r.json(); if (j.error) throw new Error(`${url} ${method}: ${JSON.stringify(j.error)}`); return j.result;
}
const acct = async (url, pk, commitment = 'finalized') => (await rpc(url, 'getAccountInfo', [pk, { encoding: 'base64', commitment }]))?.value ?? null;
const multi = async (url, pks, commitment = 'finalized') => rpc(url, 'getMultipleAccounts', [pks, { encoding: 'base64', commitment }]);
const programDataAddress = pid => PublicKey.findProgramAddressSync([new PublicKey(pid).toBuffer()], new PublicKey(LOADER_V3))[0].toBase58();

// ---------- state across ticks ----------
const loadState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { counters: zeroCounters(), lastTickSlot: null, lastTickTs: null, needStates: {}, shotStates: {}, publishTimes: [], startedSlot: null, startedTs: null };
const saveState = s => writeFileSync(statePath, JSON.stringify(s, null, 2));
function zeroCounters() { return { ticks: 0, genesisMismatch: 0, rpcDisagreement: 0, authorityDrift: 0, sbpfMismatch: 0, stateRegression: 0, founderReachable: 0, tickGaps: 0, oracleMaxGap: 0, lifecycles: 0, writeSideWired: false, replayAccepted: 0, raceDoubleLand: 0, rollbackLeak: 0, earlyTimeoutAccepted: 0, outcomes: {} }; }

// ---------- one tick of read-side checks ----------
async function tick(state) {
  const t = { at: null, slot: null, checks: {}, problems: [] };
  const rpcs = cfg.rpc; if (!Array.isArray(rpcs) || rpcs.length < 2) die('config.rpc must list >= 2 operator-chosen endpoints');

  // 1. genesis on every endpoint
  const genesis = await Promise.all(rpcs.map(u => rpc(u, 'getGenesisHash', []).catch(e => `ERR:${e.message}`)));
  const genesisOk = genesis.every(g => g === cfg.genesis);
  if (!genesisOk) { state.counters.genesisMismatch++; t.problems.push({ genesis }); }
  t.checks.genesis = { ok: genesisOk, values: genesis };

  // 2. chain clock from the first endpoint (never Date.now)
  t.slot = await rpc(rpcs[0], 'getSlot', [{ commitment: 'finalized' }]);
  t.at = await rpc(rpcs[0], 'getBlockTime', [t.slot]).catch(() => null);
  if (state.lastTickSlot !== null && cfg.intervalSeconds && t.at && state.lastTickTs && (t.at - state.lastTickTs) > 2 * cfg.intervalSeconds) { state.counters.tickGaps++; t.problems.push({ tickGap: t.at - state.lastTickTs }); }
  state.lastTickSlot = t.slot; state.lastTickTs = t.at; if (state.startedSlot === null) { state.startedSlot = t.slot; state.startedTs = t.at; }

  // 3. authority / elf / sbpf drift for every pinned program
  t.checks.programs = {};
  for (const [name, p] of Object.entries(cfg.programs)) {
    const pdKey = programDataAddress(p.id);
    const [pa, pda] = await Promise.all([acct(rpcs[0], p.id), acct(rpcs[0], pdKey)]);
    if (!pa || !pda) { state.counters.authorityDrift++; t.problems.push({ program: name, missing: !pa ? 'program' : 'programdata' }); t.checks.programs[name] = { ok: false, missing: true }; continue; }
    const v = verifyProgram({ programAccount: { owner: pa.owner, executable: pa.executable, data: Buffer.from(pa.data[0], 'base64') }, programDataAccount: { owner: pda.owner, data: Buffer.from(pda.data[0], 'base64') }, programDataKey: new PublicKey(pdKey).toBuffer(), expected: { size: p.size, sha256: p.sha256, sbpfVersion: p.sbpfVersion, authorityHex: p.upgradeAuthority ? new PublicKey(p.upgradeAuthority).toBuffer().toString('hex') : null } });
    if (!v.ok) { state.counters.authorityDrift++; if (v.problems.some(x => x.startsWith('sbpf'))) state.counters.sbpfMismatch++; t.problems.push({ program: name, problems: v.problems }); }
    t.checks.programs[name] = v;
  }

  // 4. finalized agreement across endpoints on the canonical read-set, and confirmed-vs-finalized visibility
  const readset = [...(cfg.readset || []), ...Object.values(cfg.programs).map(p => p.id)];
  const reads = {};
  for (const u of rpcs) {
    const r = await multi(u, readset, 'finalized').catch(e => ({ error: e.message }));
    reads[u] = r.error ? { slot: -1, accounts: Object.fromEntries(readset.map(k => [k, `ERR:${r.error}`])) } : { slot: r.context.slot, accounts: Object.fromEntries(readset.map((k, i) => [k, r.value[i] ? r.value[i].data[0] : null])) };
  }
  const agree = compareReadsets(reads);
  if (!agree.ok) { state.counters.rpcDisagreement++; t.problems.push({ rpcDisagreement: agree.disagreements }); }
  t.checks.rpcAgreement = { ok: agree.ok, slotSpread: agree.slotSpread, disagreements: agree.disagreements.length };

  // 5. state monotonicity for tracked Needs / Shots (decoders are injected by config: byte offset of the state field)
  const needStates = {}; for (const pk of cfg.trackedNeeds || []) { const a = reads[rpcs[0]].accounts[pk]; if (a && !String(a).startsWith('ERR')) needStates[pk] = Buffer.from(a, 'base64')[cfg.needStateOffset ?? 11]; }
  const reg = stateRegressions(state.needStates, needStates, NEED_ORDER);
  if (reg.length) { state.counters.stateRegression += reg.length; t.problems.push({ regressions: reg }); }
  state.needStates = { ...state.needStates, ...needStates };
  for (const s of Object.values(needStates)) state.counters.outcomes[`need_state_${s}`] = (state.counters.outcomes[`need_state_${s}`] || 0) + 1;
  t.checks.needStates = { tracked: Object.keys(needStates).length, regressions: reg.length };

  // 6. oracle liveness: publish_time of the pinned Pyth price account (u64 LE at cfg.oracle.publishTimeOffset)
  if (cfg.oracle?.priceAccount) {
    const a = await acct(rpcs[0], cfg.oracle.priceAccount, 'confirmed');
    if (a) { const pt = Number(Buffer.from(a.data[0], 'base64').readBigInt64LE(cfg.oracle.publishTimeOffset)); state.publishTimes.push(pt); if (state.publishTimes.length > 5000) state.publishTimes = state.publishTimes.slice(-5000); }
    const g = publishGaps(state.publishTimes); state.counters.oracleMaxGap = Math.max(state.counters.oracleMaxGap, g.maxGap); t.checks.oracle = { samples: g.samples, maxGap: g.maxGap, p50: g.p50, p95: g.p95 };
  }

  // 7. founder services must be unreachable for the whole window (server-off is a measured fact, not a promise)
  t.checks.founder = {};
  for (const u of cfg.founderMustBeUnreachable || []) {
    const reachable = await fetch(u, { method: 'GET', signal: AbortSignal.timeout(8000) }).then(r => r.status < 500).catch(() => false);
    t.checks.founder[u] = reachable ? 'REACHABLE' : 'unreachable';
    if (reachable) { state.counters.founderReachable++; t.problems.push({ founderReachable: u }); }
  }

  state.counters.ticks++;
  appendFileSync(ticksPath, JSON.stringify(t) + '\n');
  return t;
}

// ---------- T0 / T72 records ----------
async function writeT0(state) {
  const t = await tick(state);
  const record = { kind: 'T0', genesis: cfg.genesis, rpc: cfg.rpc, slot: t.slot, blockTime: t.at, programs: t.checks.programs, economy: cfg.economy || null, ruleset: cfg.ruleset || null, bundle: cfg.bundle || null, operators: cfg.operators || [], founderServices: t.checks.founder, thresholds: cfg.thresholds, problems: t.problems, verdict: t.problems.length ? 'DO NOT START — T0 has problems' : 'T0 OK — clock may start' };
  writeFileSync(t0Path, JSON.stringify(record, null, 2)); console.log(JSON.stringify(record, null, 2)); process.exit(t.problems.length ? 1 : 0);
}
function writeT72(state) {
  const elapsed = state.lastTickTs && state.startedTs ? state.lastTickTs - state.startedTs : 0;
  const ev = evaluateThresholds(state.counters, cfg.thresholds);
  const record = { kind: 'T72', startedSlot: state.startedSlot, endedSlot: state.lastTickSlot, elapsedSeconds: elapsed, hoursRequired: cfg.thresholds.hours ?? 72, continuous: elapsed >= 3600 * (cfg.thresholds.hours ?? 72), counters: state.counters, thresholds: ev.rows, disclaimers: cfg.disclaimers || ['volunteer runners, incentive untested', 'devnet costs only', 'P8 not exercised'], verdict: (elapsed >= 3600 * (cfg.thresholds.hours ?? 72)) ? ev.verdict : `INCOMPLETE (only ${(elapsed / 3600).toFixed(1)}h of ${cfg.thresholds.hours ?? 72}h)` };
  writeFileSync(join(outDir, 'T72.json'), JSON.stringify(record, null, 2)); console.log(JSON.stringify(record, null, 2)); process.exit(record.verdict === 'PASS' ? 0 : 1);
}

// ---------- scenarios through an adapter ----------
async function runScenarios(state) {
  let adapter = null;
  if (args.adapter) adapter = (await import(pathToFileURL(resolve(args.adapter)).href)).default;
  const results = [];
  for (const sc of cfg.scenarios || []) {
    const fn = { replay, race, rollback, timeout }[sc.kind]; if (!fn) die(`unknown scenario kind ${sc.kind}`);
    const waitUntil = async ts => { for (;;) { const c = await adapter.clock(); if (c.unixTimestamp >= ts) return; await new Promise(r => setTimeout(r, 2000)); } };
    const r = await fn(adapter, { ...sc, waitUntil }); results.push({ ...sc, ...r }); foldScenario(state.counters, r);
    if (r.status === 'PASS' && sc.kind !== 'rollback') state.counters.lifecycles++;
  }
  appendFileSync(join(outDir, 'scenarios.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify(results, null, 2));
}

// ---------- main ----------
const state = loadState();
if (args.t0) await writeT0(state);
else if (args.tick) { const t = await tick(state); saveState(state); console.log(JSON.stringify(t, null, 2)); process.exit(t.problems.length ? 1 : 0); }
else if (args.run) { const hours = Number(args.hours || cfg.thresholds?.hours || 72); for (;;) { const t = await tick(state); saveState(state); console.log(`[tick ${state.counters.ticks}] slot ${t.slot} problems ${t.problems.length}`); if (state.startedTs && t.at && t.at - state.startedTs >= hours * 3600) break; await new Promise(r => setTimeout(r, (cfg.intervalSeconds || 60) * 1000)); } writeT72(state); }
else if (args.t72) writeT72(state);
else if (args.scenarios) { await runScenarios(state); saveState(state); }
else die('one of --t0 | --tick | --run | --t72 | --scenarios is required');
export { SCENARIOS };
