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
const html = fs.readFileSync('./index.html', 'utf8');

// ---- 1. THE ARENA BRIER WAS A CONSTANT ----
// mean((0.5 - outcome)^2) is 0.25 for hit AND for miss, so it was 0.25 for
// every agent at every record, printed to four decimals on a public feed.
{
  const hit = Math.pow(0.5 - 1, 2), miss = Math.pow(0.5 - 0, 2);
  ok(hit === 0.25 && miss === 0.25,
    'the old formula really is a constant: hit and miss both score exactly 0.25');
  const game = fs.readFileSync('./api/game.js', 'utf8');
  ok(!/Math\.pow\(0\.5 - \(h\.res === 'hit' \? 1 : 0\), 2\)/.test(game),
    'and it is gone from the arena payload');
  ok(/brierWhy/.test(game), 'replaced by null plus a stated reason');
  ok(!/BRIER<\/span>\s*\$\{a\.brier/.test(html), 'and the client no longer renders a Brier column');
}

// ---- 2. THE HOUSE IS HELD TO THE STANDARD IT SETS FOR GUESTS ----
{
  const game = fs.readFileSync('./api/game.js', 'utf8');
  const fleet = game.slice(game.indexOf('fleet: AGENTS.map'), game.indexOf('open: open.map'));
  ok(/listed: r\.n >= ARENA_MIN_CALLS/.test(fleet),
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
  const fh = require('./lib/feedhealth.js');
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
  const feeds = fs.readFileSync('./api/feeds.js', 'utf8');
  ok(/CONF · DAILY MED/.test(feeds),
    'the column is labelled as a median of daily medians, not as "typical"');
  ok(/not the median of every individual reading/.test(feeds),
    'and the difference is stated on the page rather than left to the reader');
}

// ---- 7. THE CHAMPION CONSOLE MUST NOT READ AS A GREEN LIGHT ----
// It printed "SAFE TO SELL RIGHT NOW: <entire balance>" in green to a
// champion the seat had never paid — true arithmetic, and it read as the
// game endorsing a dump, directly under a rule about losing the seat.
{
  // Assert on what is RENDERED, not on the source text — the phrase still
  // appears in the comment explaining why it was removed, and a test that
  // cannot tell those apart would fail the day someone documents a fix.
  ok(!/\$\{c\.safeSell/.test(html), 'the safeSell value is no longer interpolated into the page');
  ok(!/var\(--grn\)">SAFE TO SELL/.test(html), 'and no green sell figure is rendered');
  ok(/no claim on your balance at all/.test(html),
    'an unpaid champion is told the rule does not apply yet, rather than given a number');
  ok(/held by XP on the daily\s*\n?\s*ladder/.test(html) || /held by XP on the daily/.test(html),
    'and told what actually holds the seat');
  ok(/Not advice either way/.test(html), 'and the trading note is neutral');
  ok(/above that floor/.test(html) && /below it — the seat is at risk/.test(html),
    'while a champion who HAS been paid still gets the real floor, both ways');
}

console.log(fails ? `\n${fails} FAILED` : '\nEVIDENCE STANDARD OK');
process.exit(fails ? 1 : 0);
