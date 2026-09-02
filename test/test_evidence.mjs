// ONE EVIDENCE STANDARD, EVERYWHERE.
// A rate, score or "typical" value must never be published from a sample too
// small to support it — and the guard has to hold on the SERVER and in the
// CLIENT, because a figure gated in one and rendered in the other is not
// gated at all. Every case below was live at some point.
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };
const html = fs.readFileSync('../index.html', 'utf8');

// ---- 1. THE ARENA BRIER WAS A CONSTANT ----
// mean((0.5 - outcome)^2) is 0.25 for hit AND for miss, so it was 0.25 for
// every agent at every record, printed to four decimals on a public feed.
{
  const hit = Math.pow(0.5 - 1, 2), miss = Math.pow(0.5 - 0, 2);
  ok(hit === 0.25 && miss === 0.25,
    'the old formula really is a constant: hit and miss both score exactly 0.25');
  const game = fs.readFileSync('../api/game.js', 'utf8');
  ok(!/Math\.pow\(0\.5 - \(h\.res === 'hit' \? 1 : 0\), 2\)/.test(game),
    'and it is gone from the arena payload');
  ok(/brierWhy/.test(game), 'replaced by null plus a stated reason');
  ok(!/BRIER<\/span>\s*\$\{a\.brier/.test(html), 'and the client no longer renders a Brier column');
}

// ---- 2. THE HOUSE IS HELD TO THE STANDARD IT SETS FOR GUESTS ----
{
  const game = fs.readFileSync('../api/game.js', 'utf8');
  const fleet = game.slice(game.indexOf('fleet: AGENTS.map'), game.indexOf('open: open.map'));
  ok(/listed:\s*r\.n >= ARENA_MIN_CALLS/.test(fleet),
    'the house fleet carries the same minimum-calls flag as the arena');
  ok(/\(y\.listed - x\.listed\)/.test(fleet),
    'and sorts listed agents first, so 1-for-1 cannot outrank 20-for-30');
  ok(/a\.listed===false/.test(html),
    'the client withholds the fleet percentage for an unranked agent');
}

// ---- 3. NO BARE PERCENTAGE WITHOUT ITS DENOMINATOR ----
{
  ok(/p\.shots<10\?`\$\{p\.hits\}\/\$\{p\.shots\}`/.test(html),
    'the player ACCURACY tile shows the fraction under ten shots, not a percentage');
  ok(/mAccL/.test(html), 'and relabels itself so the number is never read as a rate');
}

// ---- 4. THE WARDEN'S RECORD ----
{
  ok(/const WMIN=10/.test(html), 'the Warden has a minimum before it scores itself');
  ok(/TOO FEW TO SCORE/.test(html), 'and says so plainly below it');
  const seg = html.slice(html.indexOf('const WMIN=10'), html.indexOf('const WMIN=10') + 900);
  ok(/r\.n>=WMIN\s*\n?\s*\?/.test(seg.replace(/\s+/g, ' ').replace(/ /g, ' ')) || /r\.n>=WMIN/.test(seg),
    'the hit rate and Brier are both behind that minimum');
}

// ---- 5. THE ALL-TIME "TYPICAL" FIGURE ----
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const fh = require('../lib/feedhealth.js');
  const mk = (d, conf) => ({ d, samples: 1440, ourDutyPct: 100,
    feeds: Object.fromEntries(['SOL','BTC','ETH','BONK','WIF','JUP','PUMP']
      .map(f => [f, { samples: 1440, misses: 0, telemetry: 1440, confMedBps: conf,
        staleWindows: 0, blindWindows: 0, rewinds: 0, gapMaxS: 60, divMaxBps: 1 }])) });

  const one = fh.foldHistory([mk('2026-08-19', 3.9)]);
  ok(one.feeds.SOL.confTypicalBps === null,
    'one day folded -> no all-time "typical" confidence is published');
  ok(one.feeds.SOL.confDays === 1, 'and the backing day count is published instead');
  ok(one.feeds.SOL.samples === 1440, 'while the counts that ARE real stay');

  const three = fh.foldHistory([mk('2026-08-17', 3.5), mk('2026-08-18', 3.9), mk('2026-08-19', 4.3)]);
  ok(three.feeds.SOL.confTypicalBps === 3.9, 'three days -> the median of daily medians appears');
  ok(three.feeds.SOL.confDays === 3, 'with its day count beside it');
}

// ---- 6. the page must name the statistic it is actually showing ----
{
  const feeds = fs.readFileSync('../api/feeds.js', 'utf8');
  ok(/CONF · DAILY MED/.test(feeds),
    'the column is labelled as a median of daily medians, not as "typical"');
  ok(/not the median of every individual reading/.test(feeds),
    'and the difference is stated on the page rather than left to the reader');
}

// ---- 7. PODIUM IS LIVE, FALLBACK IS EXPLICIT, RECEIPTS ARE EXACT ----
{
  const game = fs.readFileSync('../api/game.js', 'utf8');
  ok(!/\$\{c\.safeSell/.test(html), 'no safe-to-sell value is rendered');
  ok(!/HOLDER RULE: CHAMPIONS WHO DUMP/.test(html), 'the removed holding condition is gone from the live UI');
  ok(/seatRule:'live-daily-xp'/.test(game), 'server publishes live daily XP as the seat rule');
  ok(/replace yesterday's #3, #2 and #1/.test(html),
    'the previous-day fallback handoff order is stated exactly');
  ok(/c\.received7/.test(html) && /c\.retained7/.test(html) && /c\.total7/.test(html),
    'incoming, self-retained and total podium RCX remain separate figures');
  ok(/x\.kind==="received"/.test(html) && /YOUR RELOAD/.test(html) && /solscan\.io\/tx/.test(html),
    'each kind of reward renders a transaction-linked receipt');
  ok(/ALL-TIME XP/.test(html) && /RECORD ONLY · NO PRIZE/.test(html) && /id="ladderAll"/.test(html),
    'all-time XP is visible and explicitly carries no payout');
}
// ---- 8. EVERY REPO LINK THE SITE PUBLISHES MUST RESOLVE ----
// Moving files into docs/ broke four links across two releases: the footer's
// "our own audit", README's RESURRECTION.md, and the schema link on the very
// page whose whole claim is "check this yourself". A link audit is cheap; a
// 404 handed to someone who came to verify you is not.
{
  const root = new URL('../', import.meta.url).pathname;
  const files = ['index.html','README.md','api/record.js','api/feeds.js','api/supply.js',
                 'api/shot.js','api/proof.js','api/game.js'];
  const missing = [];
  for (const f of files) {
    let src = '';
    try { src = require('fs').readFileSync(root + f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/blob\/main\/([A-Za-z0-9_./-]+)/g)) {
      const target = m[1].replace(/[.,)]+$/, '');
      if (!require('fs').existsSync(root + target)) missing.push(`${f} -> ${target}`);
    }
  }
  ok(missing.length === 0,
     missing.length ? `every published repo link resolves — BROKEN: ${missing.join(', ')}`
                    : 'every published repo link resolves to a file in this repo');
}

// ---- 9. OPERATIONAL TRUTH AND SELF-RECOVERY ----
{
  const game = fs.readFileSync('../api/game.js', 'utf8');
  const proof = fs.readFileSync('../api/proof.js', 'utf8');
  const prices = fs.readFileSync('../lib/prices.js', 'utf8');
  ok(/feed:\s*\(feed \|\| \[\]\)\.filter\(x => !x\.agent\)/.test(game),
    'agent actions stay out of the player killfeed');
  ok(/STATE_TIMEOUT_MS=20000/.test(html) && /refreshFailures>=2/.test(html)
      && /Reconnecting to the game service/.test(html)
      && /scheduleRecovery\(e&&e\.name==="AbortError"\?5000:0\)/.test(html),
    'state recovery uses a 20s browser budget, waits for two failures and retries');
  ok(/r\.status===409&&body&&body\.code==="PLAYER_BUSY"/.test(html)
      && /r\.status===429/.test(html) && /refreshNotBefore/.test(html)
      && /Number\.isFinite\(seconds\)&&seconds>0/.test(html)
      && /retryAfterSeconds = rateLimitRetrySeconds/.test(game),
    'a late healthy request cannot turn its own PLAYER_BUSY or rate limit into a second outage');
  ok(/settleRefreshDue=now\+3000/.test(html),
    'expired-card settlement refresh pressure is capped at one request per three seconds');
  ok(/push\('sampler'/.test(proof) && /samples\.length \/ 60/.test(proof),
    'the proof page reports settlement-sampler duty separately from a live oracle read');
  ok(/filter\(s => s !== 'JUP' && !EQUITY\.has\(s\)\)/.test(prices),
    'the ambiguous Coinbase JUP symbol cannot corrupt divergence or fallback display data');
  // Same rule, stronger case. Coinbase quotes no TSLA-USD at all, and a symbol
  // that did resolve would be a different instrument from Pyth's 24/7 index
  // mark -- so the last-resort route must not offer a stock target rather than
  // quote one from the wrong market.
  ok(/const EQUITY = new Set\(\['TSLA', 'NVDA', 'PLTR', 'COIN', 'HOOD'\]\)/.test(prices),
    'the stock feeds are one named list, not a condition repeated per call site');
  ok(!/PYTH_API_KEY|PYTH_HERMES_URL|\/v2\/updates\/price\/latest/.test(prices)
      && /API-keyless Pyth-on-Solana/.test(prices),
    'no secret or Hermes URL can enable an economic feed in the runtime price path');
  ok(/chainVerdict && !chainVerdict\.ok/.test(proof)
      && /must not be described as a complete restorable log/.test(proof),
    'a broken event chain makes the resurrection claim red and explicitly incomplete');
}
console.log(fails ? `\n${fails} FAILED` : '\nEVIDENCE STANDARD OK');
process.exit(fails ? 1 : 0);
