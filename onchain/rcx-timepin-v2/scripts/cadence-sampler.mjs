#!/usr/bin/env node
// Tracker item 2.3: measure, keylessly, how the sponsored Pyth push accounts
// actually behave against a target grid — so that `max_post_target_lag` in the
// write-once mainnet manifest is a measured number and not a guess.
//
// Two modes, and the split is the point:
//
//   sample     the only mode that needs the network. Refuses to start if another
//              collector holds the output file's lock (--force overrides). Polls the seven sponsored
//              push-source accounts and appends one NDJSON line per change.
//   summarize  pure. Reads that NDJSON and produces the hit-rate table. No
//              network, no clock, no randomness — so the arithmetic that the
//              GATE 2 decision rests on is testable on any machine, and
//              `test/test_timepin_cadence_policy.mjs` does exactly that.
//
// WHAT THIS METHOD CAN AND CANNOT SEE — read this before quoting a number.
//
// It polls ACCOUNTS. An account holds one message at a time, so a print that is
// overwritten between two polls is invisible. Therefore:
//   * every first-print lag here is an UPPER BOUND. The real first print may
//     have come earlier and been overwritten.
//   * every "strict bracket hit" here is a LOWER BOUND, for the same reason.
//   * "no ties observed" is VACUOUS. Two distinct signed messages sharing a
//     publish_time (Opus A's 11:04Z P1, from Fable's uniqueness_check.js) are
//     precisely what account polling cannot resolve; that question needs the
//     Pythnet accumulator ring, not this script. Do not cite this file on it.
// The summary carries these caveats as data, in `limits`, so they travel with
// the numbers instead of staying in a comment nobody reads.
//
// Evidence tier: `sample` output is `mainnet` tier for the prints it did see and
// nothing at all for the prints it did not. `summarize` is `host`.
//
// Usage:
//   node cadence-sampler.mjs sample    [--hours 24] [--interval-ms 1000] [--out FILE]
//   node cadence-sampler.mjs summarize --in FILE [--out FILE] [--grid 60,300]

import { createRequire } from 'node:module';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM, derivePushSourcePda, decodePriceUpdateV2,
} from '../../rcx-timepin/model-v2.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// One source of truth for the seven feeds: lib/prices.js:14-26, the same table
// the running game settles on. Re-typing them here is how two feed lists drift.
export function gameFeeds() {
  const require = createRequire(join(repoRoot, 'package.json'));
  const { FEEDS } = require('./lib/prices.js');
  return Object.entries(FEEDS).map(([symbol, feedId]) => ({ symbol, feedId }));
}

export function sourceAddressFor(feedId, shardId = 0) {
  return new PublicKey(derivePushSourcePda({
    shardId, feedId: Buffer.from(feedId, 'hex'),
    pushOracleProgram: OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  }).address);
}

// --- percentiles -------------------------------------------------------------
// Nearest-rank on the sorted sample. Stated explicitly because a p99 computed
// three different ways is how two agents "measure" different numbers.
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50), p95: percentile(sorted, 95),
    p99: percentile(sorted, 99), max: sorted.length ? sorted[sorted.length - 1] : null,
  };
};

// --- summarize: pure ---------------------------------------------------------

export function summarize(lines, { grids = [60, 300] } = {}) {
  const records = [];
  const meta = { errors: 0, malformed: 0, headers: 0, duplicateRows: 0 };
  const seenKeys = new Set();
  let header = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { meta.malformed += 1; continue; }
    if (row.kind === 'header') { meta.headers += 1; header ??= row; continue; }
    if (row.kind === 'footer') continue;
    if (row.kind === 'error') { meta.errors += 1; continue; }
    if (row.kind !== 'print') { meta.malformed += 1; continue; }
    // Two collectors appending to one file is a real thing that happened
    // (2026-09-05: two samplers 21 s apart, 49.8 % duplicate rows). Every
    // statistic below is computed over a deduplicated (symbol, publish_time)
    // set so the numbers survive it - but a file that is quietly twice its
    // size must SAY so, not rely on the reader noticing two headers.
    const key = `${row.symbol}:${row.publishTime}`;
    if (seenKeys.has(key)) meta.duplicateRows += 1; else seenKeys.add(key);
    records.push(row);
  }

  const bySymbol = new Map();
  for (const r of records) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }

  const feeds = {};
  for (const [symbol, rows] of bySymbol) {
    rows.sort((a, b) => a.publishTime - b.publishTime);
    const publishTimes = [...new Set(rows.map(r => r.publishTime))].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < publishTimes.length; i += 1)
      gaps.push(publishTimes[i] - publishTimes[i - 1]);

    // The window over which a target is answerable at all: a target before the
    // first observed print, or after the last, has no evidence either way and is
    // not counted as a miss. Counting it as a miss would manufacture a void rate.
    const first = publishTimes[0], last = publishTimes[publishTimes.length - 1];
    const gridResults = {};
    for (const grid of grids) {
      const startTarget = Math.ceil(first / grid) * grid;
      const targets = [];
      for (let t = startTarget; t <= last; t += grid) targets.push(t);

      const lags = [];
      let minCaptureHit = 0, bracketHit = 0;
      for (const t of targets) {
        // MIN-CAPTURE: the smallest publish_time >= T that we saw.
        const admissible = rows.find(r => r.publishTime >= t);
        if (admissible) {
          minCaptureHit += 1;
          lags.push(admissible.publishTime - t);
        }
        // Strict bracket (adapter 2, experimental): prev < T <= pub.
        if (rows.some(r => r.prevPublishTime < t && t <= r.publishTime)) bracketHit += 1;
      }
      gridResults[String(grid)] = {
        targets: targets.length,
        minCapture: {
          hit: minCaptureHit,
          missed: targets.length - minCaptureHit,
          hitRate: targets.length ? minCaptureHit / targets.length : null,
          firstPrintLagSeconds: stats(lags),
        },
        strictBracket: {
          hit: bracketHit,
          missed: targets.length - bracketHit,
          hitRate: targets.length ? bracketHit / targets.length : null,
        },
      };
    }

    feeds[symbol] = {
      feedId: rows[0].feedId,
      sourceAddress: rows[0].sourceAddress,
      observations: rows.length,
      distinctPublishTimes: publishTimes.length,
      firstPublishTime: first,
      lastPublishTime: last,
      publishGapSeconds: stats(gaps),
      grids: gridResults,
    };
  }

  const observedSeconds = records.length
    ? Math.max(...records.map(r => r.observedAt)) - Math.min(...records.map(r => r.observedAt))
    : 0;

  return {
    schema: 1,
    method: 'poll-sponsored-price-accounts',
    header,
    pollIntervalMs: header?.intervalMs ?? null,
    observedSeconds,
    observedHours: observedSeconds / 3600,
    records: records.length,
    errors: meta.errors,
    malformed: meta.malformed,
    headers: meta.headers,
    duplicateRows: meta.duplicateRows,
    // More than one header means more than one collector wrote this file.
    collidingCollectors: meta.headers > 1,
    feeds,
    limits: {
      accountPolling: 'An account holds one message at a time. Prints overwritten between two polls are invisible.',
      firstPrintLag: 'UPPER BOUND. The true first print may have come earlier and been overwritten.',
      strictBracketHitRate: 'LOWER BOUND, for the same reason.',
      ties: 'VACUOUS here. Two distinct signed messages sharing a publish_time cannot be resolved by account polling; that needs the Pythnet accumulator ring.',
      evidenceTier: 'mainnet for the prints observed; nothing for the prints missed.',
    },
  };
}

// --- the gate, as a pure function --------------------------------------------
//
// Kept here, exported, and free of filesystem paths for one reason: a gate that
// can only be exercised by creating a real manifest in the repository is a gate
// nobody ever proves red. `test/test_timepin_cadence_policy.mjs` calls this with
// synthetic inputs to show it refuses, and with the real files when they exist.
//
// Throws on refusal; returns the per-feed comparison on acceptance.

export function auditManifest(manifest, summary, {
  minHours = 24, minTargets = 60, maxPollIntervalMs = 1000,
} = {}) {
  if (!manifest) throw new Error('no manifest to audit');
  if (!summary)
    throw new Error(
      'a mainnet economy manifest exists but no cadence measurement does. A write-once ' +
      'max_post_target_lag may not be set from an estimate: run cadence-sampler.mjs sample ' +
      '--hours 24, then summarize.');
  if (!(summary.observedHours >= minHours))
    throw new Error(`measurement covers ${summary.observedHours} h, GATE 2 asks for ${minHours} h`);
  if (!(summary.pollIntervalMs !== null && summary.pollIntervalMs <= maxPollIntervalMs))
    throw new Error(
      `poll interval ${summary.pollIntervalMs} ms is too coarse to bound a 5 s feed's first print`);

  const rows = [];
  for (const feed of manifest.feeds ?? []) {
    const measured = summary.feeds?.[feed.symbol];
    if (!measured) throw new Error(`${feed.symbol} is in the manifest but not in the measurement`);
    const gridKey = String(feed.targetGridSeconds ?? 60);
    const grid = measured.grids?.[gridKey];
    if (!grid) throw new Error(`${feed.symbol}: no measurement at grid ${gridKey}`);
    if (!(grid.targets >= minTargets))
      throw new Error(`${feed.symbol}: ${grid.targets} targets measured, GATE 2 asks for at least ${minTargets}`);
    const p99 = grid.minCapture.firstPrintLagSeconds.p99;
    if (p99 === null || p99 === undefined)
      throw new Error(`${feed.symbol}: no first-print lag measured`);
    const raw = feed.maxPostTargetLagSeconds;
    const lag = (raw && typeof raw === 'object') ? Number(raw.proposed) : Number(raw);
    if (!Number.isFinite(lag))
      throw new Error(`${feed.symbol}: maxPostTargetLagSeconds is not a number`);
    if (!(lag >= p99))
      throw new Error(
        `${feed.symbol}: maxPostTargetLagSeconds ${lag} s is below the measured p99 first-print ` +
        `lag ${p99} s. Every target whose print arrives later than ${lag} s would VOID, ` +
        'permanently, and this parameter cannot be edited after registration.');
    rows.push({ symbol: feed.symbol, maxPostTargetLagSeconds: lag, measuredP99: p99, targets: grid.targets });
  }
  if (!rows.length) throw new Error('the manifest declares no feeds');
  return rows;
}

// --- sample: the only networked mode -----------------------------------------

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

// Two samplers appending to one NDJSON file is not hypothetical: on 2026-09-05
// two started 21 seconds apart and half the rows in the 24 h file were
// duplicates. The statistics survived it, by luck rather than design. This makes
// the second one refuse instead.
//
// Staleness is by mtime, not existence, because the shell that most often has to
// clean up after a crash here cannot delete files: a lock that only an operator
// can remove is a lock that outlives the crash and blocks the restart.
export function acquireOutputLock(outPath, { staleMs = 300_000, force = false, now = Date.now } = {}) {
  const lockPath = `${outPath}.lock`;
  if (existsSync(lockPath) && !force) {
    let held = {};
    try { held = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* unreadable is still held */ }
    const age = now() - statSync(lockPath).mtimeMs;
    if (age < staleMs)
      throw new Error(
        `REFUSING to start: ${lockPath} was touched ${Math.round(age / 1000)} s ago by pid ` +
        `${held.pid ?? 'unknown'} (started ${held.startedAt ?? 'unknown'}). Another collector is ` +
        'writing this file, and two collectors produce a file that is half duplicates. Stop that ' +
        `one, or pass --force, or use --out to write somewhere else.`);
  }
  const write = () => writeFileSync(lockPath,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), outPath })}\n`, 'utf8');
  write();
  return { lockPath, heartbeat: write };
}

// OpusB, 12:58Z, adversarial review of the live run: "Detecting the collision
// after the fact is good; not being able to create it is better." He is right.
// The lock below catches a CONCURRENT second collector; these two catch the
// other half of the problem - a RESTART inside the measurement window silently
// appending to the previous run's file, which over 24 hours is likely rather
// than hypothetical.

// A default output path that is unique per RUN, not per day.
export function runStampedPath(dir, prefix, at = new Date()) {
  const iso = at.toISOString();
  return join(dir, `${prefix}-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}.ndjson`);
}

// And when an explicit --out names a file that already has a header from a
// DIFFERENT run, refuse rather than merge two measurements into one file.
export function assertOwnFile(outPath, startedAt, { force = false } = {}) {
  if (force || !existsSync(outPath)) return;
  const first = readFileSync(outPath, 'utf8').split('\n').find(l => l.trim());
  if (!first) return;
  let header;
  try { header = JSON.parse(first); } catch { return; }
  if (header.kind !== 'header' || !header.startedAt) return;
  if (header.startedAt !== startedAt)
    throw new Error(
      `REFUSING to append: ${outPath} already holds a run started ${header.startedAt}, and this ` +
      `one started ${startedAt}. Two runs in one file is how 49.8 % of the 2026-09-05 24 h file ` +
      'became duplicates. Omit --out to get a run-stamped filename, or pass --force to merge on ' +
      'purpose.');
}

export async function sample({
  rpcUrl = process.env.RATCHET_RPC_URL || DEFAULT_RPC,
  hours = 24, intervalMs = 1000, out, force = false,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const feeds = gameFeeds().map(f => ({ ...f, address: sourceAddressFor(f.feedId) }));
  const startedAt = new Date().toISOString();
  const outPath = out ?? runStampedPath(join(repoRoot, 'docs', 'reviews', 'cadence'), 'cadence');
  mkdirSync(dirname(outPath), { recursive: true });
  assertOwnFile(outPath, startedAt, { force });

  const lock = acquireOutputLock(outPath, { force });
  const connection = new Connection(rpcUrl, 'confirmed');
  const write = row => appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  write({
    kind: 'header', startedAt, rpcUrl, intervalMs, hours,
    feeds: feeds.map(f => ({ symbol: f.symbol, feedId: f.feedId, address: f.address.toBase58() })),
  });

  const deadline = Date.now() + hours * 3600_000;
  const lastPublish = new Map();
  let backoffMs = 0, stop = false;
  process.on('SIGINT', () => { stop = true; });

  console.log(`sampling ${feeds.length} feeds every ${intervalMs} ms for ${hours} h -> ${outPath}`);
  while (!stop && Date.now() < deadline) {
    const cycleStart = Date.now();
    try {
      const infos = await connection.getMultipleAccountsInfo(feeds.map(f => f.address), 'confirmed');
      const observedAt = now();
      infos.forEach((info, i) => {
        const feed = feeds[i];
        if (!info) { write({ kind: 'error', observedAt, symbol: feed.symbol, error: 'account missing' }); return; }
        const decoded = decodePriceUpdateV2(info);
        if (!decoded.ok) { write({ kind: 'error', observedAt, symbol: feed.symbol, error: decoded.code }); return; }
        const publishTime = Number(decoded.publishTime);
        if (lastPublish.get(feed.symbol) === publishTime) return;   // unchanged
        lastPublish.set(feed.symbol, publishTime);
        write({
          kind: 'print', observedAt, symbol: feed.symbol, feedId: feed.feedId,
          sourceAddress: feed.address.toBase58(),
          publishTime, prevPublishTime: Number(decoded.prevPublishTime),
          postedSlot: Number(decoded.postedSlot), price: String(decoded.price),
          conf: String(decoded.conf), exponent: decoded.exponent,
          writeAuthority: Buffer.from(decoded.writeAuthority).toString('hex'),
        });
      });
      backoffMs = 0;
    } catch (error) {
      write({ kind: 'error', observedAt: now(), error: String(error.message ?? error).slice(0, 200) });
      // A public RPC that rate-limits us must not turn into a tight retry loop
      // that gets the IP blocked for the remaining 23 hours.
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2000, 60_000);
      await new Promise(r => setTimeout(r, backoffMs));
    }
    lock.heartbeat();
    const wait = Math.max(0, intervalMs - (Date.now() - cycleStart));
    if (wait) await new Promise(r => setTimeout(r, wait));
  }
  console.log(`done -> ${outPath}`);
  return outPath;
}

// --- cli ---------------------------------------------------------------------

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

async function main() {
  const mode = process.argv[2];
  if (mode === 'sample') {
    await sample({
      hours: Number(flag('hours', 24)),
      intervalMs: Number(flag('interval-ms', 1000)),
      out: flag('out', undefined),
      force: process.argv.includes('--force'),
    });
    return;
  }
  if (mode === 'summarize') {
    const input = flag('in', null);
    if (!input || !existsSync(input)) throw new Error('summarize needs --in <ndjson file>');
    const summary = summarize(readFileSync(input, 'utf8').split('\n'), {
      grids: String(flag('grid', '60,300')).split(',').map(Number),
    });
    const output = flag('out', input.replace(/\.ndjson$/, '') + '.summary.json');
    writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`summary -> ${output}`);
    for (const [symbol, f] of Object.entries(summary.feeds)) {
      const g = f.grids['60'];
      console.log(`  ${symbol.padEnd(5)} targets=${String(g.targets).padStart(5)} ` +
        `min-capture=${(100 * g.minCapture.hitRate).toFixed(1)}% ` +
        `bracket=${(100 * g.strictBracket.hitRate).toFixed(1)}% ` +
        `lag p99=${g.minCapture.firstPrintLagSeconds.p99}s max=${g.minCapture.firstPrintLagSeconds.max}s`);
    }
    return;
  }
  throw new Error('usage: cadence-sampler.mjs sample|summarize');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });
}
