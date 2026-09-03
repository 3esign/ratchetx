// Measure the tokenized-equity publish cadence, and turn it into the two
// numbers the stocks decision actually needs.
//
// WHY THIS EXISTS. docs/STOCKS_ONCHAIN_TOKENIZED.md settles the hard part:
// stocks ARE reachable keylessly, as sponsored push accounts the frozen
// program can already read, with no Hermes and no API key. What stops them is
// one number against another -- an 870-second batch cadence against a seal
// bound that clamps at 60 seconds -- so about 7 seals in 100 would land. That
// 870 was measured once, for 13.4 minutes, by a script that was never
// committed. A product decision resting on a number nobody can re-derive is a
// rumour with a table around it. This is the script, and docs/STOCK_FEEDS.json
// is the feed list it reads, so the measurement is reproducible from this
// repository plus any RPC, forever.
//
// It reads and never writes. No key, no signer, no transaction.
//
//   node tools/stock_cadence.mjs [RPC_URL] [--minutes N] [--every S] [--out FILE]
//
// WHAT IT REPORTS, and why those two numbers:
//
//   1. "seals that land"  -- for each horizon, the fraction of wall-clock time
//      the price is younger than max_seal_age(minutes). That is the pass rate
//      of the rule as it stands today. It is what makes stocks a feature that
//      does not work.
//
//   2. "entry binds within" -- if the entry price were the FIRST publish at or
//      after the seal rather than the last one before it, how long a player
//      waits for their entry to be determined, and what fraction of each
//      horizon that delay consumes. That is the proposal in
//      docs/STOCKS_DECISION.md, and this is the measurement that says whether
//      it is tolerable on this feed.
//
// The SOL row is a CONTROL, not a subject. If SOL does not tick during the
// window, the RPC is lying or the derivation is broken, and every stock row
// printed is meaningless -- so the report says so instead of being trusted.
import fs from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CFG = JSON.parse(fs.readFileSync(
  new URL('../docs/STOCK_FEEDS.json', import.meta.url), 'utf8'));

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const RPC = process.argv.slice(2).find(a => /^https?:\/\//.test(a))
  || process.env.RATCHET_RPC || 'https://api.mainnet-beta.solana.com';
const MINUTES = arg('--minutes', 120);
const EVERY_S = Math.max(5, arg('--every', 20));
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : 'stock_cadence_report.txt'; })();

// The horizons and the seal bound are the PROGRAM's, restated here because a
// Rust constant cannot be imported into node. test/test_stock_cadence.mjs pins
// both against lib.rs, so a change there fails this file rather than silently
// making the report describe a game that is not running.
const HORIZONS = [5, 10, 15, 30, 60, 360, 1440];
const maxSealAge = minutes => {
  const window = minutes * 60;
  return Math.min(60, Math.max(30, Math.floor((window * 15 + 50) / 100)));
};

const PUSH_ORACLE = new PublicKey(CFG.pushOracle);
const pushAccount = (feedIdHex, shardId = CFG.shard) => {
  const shard = Buffer.alloc(2); shard.writeUInt16LE(shardId);
  return PublicKey.findProgramAddressSync([shard, Buffer.from(feedIdHex, 'hex')], PUSH_ORACLE)[0];
};

/** Minimal PriceUpdateV2 reader: the same field walk as
 *  scripts/check-equity-feeds.mjs, kept deliberately identical so two tools
 *  cannot disagree about what a price account says. */
export function readPrice(data) {
  const b = Buffer.from(data);
  let o = 8 + 32;                                          // discriminator, write_authority
  const level = b.readUInt8(o++); if (level === 0) o++;    // Partial{num_sigs} | Full
  const feedId = b.subarray(o, o + 32).toString('hex'); o += 32;
  const price = b.readBigInt64LE(o); o += 8;
  const conf = b.readBigUInt64LE(o); o += 8;
  const exponent = b.readInt32LE(o); o += 4;
  const publishTime = b.readBigInt64LE(o); o += 8;
  const prevPublishTime = b.readBigInt64LE(o);
  return { full: level === 1, feedId, price, conf, exponent,
    publishTime: Number(publishTime), prevPublishTime: Number(prevPublishTime) };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Turn a list of observed (sampleTime, publishTime) pairs into the decision
 *  numbers. Exported and pure so the arithmetic is testable without an RPC. */
export function decide(samples, gaps) {
  // 1. How often is the price fresh enough to seal on, per horizon.
  const lands = {};
  for (const minutes of HORIZONS) {
    const bound = maxSealAge(minutes);
    const fresh = samples.filter(s => s.at - s.publishTime <= bound).length;
    lands[minutes] = samples.length ? fresh / samples.length : null;
  }
  // 2. If the entry bound FORWARD instead, how long until it binds. A seal at
  //    an arbitrary instant waits for the next publish; with observed gaps, the
  //    wait from a uniformly random instant inside a gap of length g averages
  //    g/2 and is at worst g. Report the honest worst case (the gap) and the
  //    expected case, and never invent a distribution the samples cannot see.
  const bindWorst = gaps.length ? Math.max(...gaps) : null;
  const bindTypical = gaps.length ? median(gaps) / 2 : null;
  return { lands, bindWorst, bindTypical, bindP95: gaps.length ? pct(gaps, 0.95) : null };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rows = [{ ticker: 'SOL', control: true, feedId: CFG.control.feedId, symbol: CFG.control.symbol },
    ...CFG.feeds.map(f => ({ ...f, control: false }))];
  for (const r of rows) r.key = pushAccount(r.feedId);

  const conn = new Connection(RPC, 'confirmed');
  const out = [];
  const say = line => { out.push(line); console.log(line); };

  say(`stock cadence · ${RPC}`);
  say(`window ${MINUTES} min · poll every ${EVERY_S}s · started ${new Date().toISOString()}`);
  say('');
  say('This reads only. No key, no signer, no transaction. Leave it running;');
  say('the longer the window the more the numbers are worth. Ctrl-C writes');
  say('nothing extra -- the report file is rewritten after every poll, so');
  say('stopping early still leaves you whatever it had measured.');
  say('');

  const seen = new Map();   // ticker -> { publishTimes: [], samples: [], missing, badOwner }
  for (const r of rows) seen.set(r.ticker, { row: r, publishTimes: [], samples: [], missing: 0, badOwner: 0, price: null, exponent: null });

  const deadline = Date.now() + MINUTES * 60_000;
  let polls = 0, rpcErrors = 0;

  const render = () => {
    const lines = [...out];
    const add = l => lines.push(l);
    add('');
    add(`polls ${polls} · rpc errors ${rpcErrors} · elapsed ${Math.round((MINUTES * 60_000 - (deadline - Date.now())) / 60_000)} min`);
    add('');

    const ctrl = seen.get('SOL');
    const ctrlWrites = Math.max(0, ctrl.publishTimes.length - 1);
    add('feed      writes   gap min   median      max   stale now   last price');
    add('-------------------------------------------------------------------------');
    for (const r of rows) {
      const s = seen.get(r.ticker);
      const gaps = [];
      for (let i = 1; i < s.publishTimes.length; i++) gaps.push(s.publishTimes[i] - s.publishTimes[i - 1]);
      const last = s.publishTimes[s.publishTimes.length - 1];
      const stale = last ? Math.round(Date.now() / 1000) - last : null;
      const px = s.price != null ? (Number(s.price) * Math.pow(10, s.exponent)).toFixed(2) : '—';
      add(`${(r.ticker + (r.control ? ' *' : '')).padEnd(9)} ${String(gaps.length).padStart(6)} `
        + `${(gaps.length ? Math.min(...gaps) + 's' : '—').padStart(9)} `
        + `${(gaps.length ? median(gaps) + 's' : '—').padStart(8)} `
        + `${(gaps.length ? Math.max(...gaps) + 's' : '—').padStart(8)} `
        + `${(stale == null ? '—' : stale + 's').padStart(11)}   ${px}`
        + (s.missing ? `   (account missing on ${s.missing} polls)` : '')
        + (s.badOwner ? `   (WRONG OWNER on ${s.badOwner} polls)` : ''));
    }
    add('   * control');
    add('');

    if (ctrlWrites < 2) {
      add('CONTROL FAILED: SOL wrote ' + ctrlWrites + ' time(s) in this window.');
      add('SOL publishes on a ~60s sponsored heartbeat, so it must write. Either the');
      add('RPC is serving stale or cached account data, or the derivation is wrong.');
      add('IGNORE every stock row above. Re-run with a different RPC.');
      return lines.join('\n');
    }
    add('CONTROL OK: SOL wrote ' + ctrlWrites + ' time(s) — the RPC is serving live account data,');
    add('so the stock rows above are real measurements and not an artefact.');
    add('');
    add('WHAT THIS MEANS FOR THE GAME');
    add('');
    for (const r of rows) {
      if (r.control) continue;
      const s = seen.get(r.ticker);
      const gaps = [];
      for (let i = 1; i < s.publishTimes.length; i++) gaps.push(s.publishTimes[i] - s.publishTimes[i - 1]);
      if (gaps.length < 2) { add(`${r.ticker}: fewer than two gaps observed — run longer before believing anything about it.`); add(''); continue; }
      const d = decide(s.samples, gaps);
      add(`${r.ticker}  (${r.symbol})`);
      add('  today, seals that would land:');
      add('    ' + HORIZONS.map(m => `${m}m ${(d.lands[m] * 100).toFixed(0)}%`).join('   '));
      add(`  if the entry bound forward instead: typically ${Math.round(d.bindTypical)}s, `
        + `95th percentile gap ${d.bindP95}s, worst observed ${d.bindWorst}s`);
      const usable = HORIZONS.filter(m => d.bindWorst <= m * 60 * 0.05);
      add('  horizons where even the WORST binding delay is under 5% of the window:');
      add('    ' + (usable.length ? usable.map(m => m + 'm').join(', ') : 'none — this feed is too slow for any horizon the program sells'));
      add(`  suggested HORIZON_MASK: 0b${HORIZONS.map(m => usable.includes(m) ? '1' : '0').reverse().join('')}`
        + `  (0x${parseInt(HORIZONS.map(m => usable.includes(m) ? '1' : '0').reverse().join(''), 2).toString(16).padStart(2, '0')})`);
      add('');
    }
    add('The mask is a SUGGESTION from one window of data, not a decision. It is the');
    add('shape of the answer: open only the horizons whose length makes this feed\'s');
    add('slowness irrelevant, and the slowness stops being a fairness problem.');
    return lines.join('\n');
  };

  while (Date.now() < deadline) {
    let infos;
    try { infos = await conn.getMultipleAccountsInfo(rows.map(r => r.key), 'confirmed'); }
    catch (e) { rpcErrors++; console.log('  rpc error: ' + (e.message || e)); await new Promise(r => setTimeout(r, EVERY_S * 1000)); continue; }
    polls++;
    const at = Math.round(Date.now() / 1000);
    rows.forEach((r, i) => {
      const s = seen.get(r.ticker), info = infos[i];
      if (!info) { s.missing++; return; }
      if (info.owner.toBase58() !== CFG.receiver) { s.badOwner++; return; }
      let p; try { p = readPrice(info.data); } catch { s.missing++; return; }
      if (p.feedId !== r.feedId) { s.badOwner++; return; }   // the account answered for a different feed
      s.price = p.price; s.exponent = p.exponent;
      s.samples.push({ at, publishTime: p.publishTime });
      if (s.publishTimes[s.publishTimes.length - 1] !== p.publishTime) s.publishTimes.push(p.publishTime);
    });
    fs.writeFileSync(OUT, render() + '\n');
    process.stdout.write(`  poll ${polls} · ${Math.round((deadline - Date.now()) / 60_000)} min left\r`);
    await new Promise(r => setTimeout(r, EVERY_S * 1000));
  }
  const final = render();
  fs.writeFileSync(OUT, final + '\n');
  console.log('\n' + final);
  console.log('\nwrote ' + OUT);
}
