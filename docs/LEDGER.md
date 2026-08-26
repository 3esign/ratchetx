# The Coinflip Ledger

**[/api/ledger](https://ratchetx.xyz/api/ledger)** · code: [`lib/ledger.js`](../lib/ledger.js)

Prediction markets are regularly reported at a Brier score around **0.09**, and
the number is real. It is also close to meaningless, because it is dominated by
markets that were never in doubt. A market sitting at 99% on a near-certainty
that resolves the obvious way scores beautifully and demonstrates nothing.

The Coinflip Ledger scores only the questions that were actually hard, and
scores every venue — **including this one** — on the same ones.

---

## The rule

An observation enters the ledger only if, at the moment we looked:

1. the venue's own crowd priced it between **0.35 and 0.65** — the band where a
   market is admitting it does not know;
2. it is a price question on **SOL, BTC or ETH**, with a strike and a direction
   we can read without guessing;
3. it expires between **5 minutes and 72 hours** from that moment.

The band is the entire point. It is the control that makes four different
venues comparable without pretending they were asked the same question.

## Ground truth

Every observation is resolved by **Pyth, read off Solana**, under the identical
predicate that settles a shot on this site:

> the first recorded oracle sample published at or after expiry, inside a
> 15-minute grace window.

If no such sample exists, the observation **voids and is discarded**. Pyth's
API offers a nearest-print "indicative" price for exactly that situation and
the ledger refuses it, because a score built on a price that failed our own
settlement rule is a score we would then have to defend by explaining why the
rule binds players and not us.

## What is NOT claimed

**These venues are not asked identical questions.** Their strikes and expiries
never line up, and pretending otherwise is the first thing an honest critic
would take apart. Each venue is scored on *its own* questions, restricted to
the same difficulty band.

That is a weaker claim than "same question, four answers," and it is the one
the data supports. It is printed in the API response, on the page, and here.

## The rows

| row | what it is |
|---|---|
| Kalshi | its crowd's mid price on its own in-band questions |
| Polymarket | its crowd's price on its own in-band questions |
| RatchetX players (stated) | players' sealed stated probabilities, in-band only |
| RatchetX crowd | the sealed-side split — *listed empty until it is scored* |

Our own row is filtered by the same band as everyone else's. Scoring ourselves
on easy calls while scoring them on hard ones would make the whole board
worthless, and ours is the one row we control.

Our row can lose. The four house agents already lose in public on the arena
board; this is the same policy applied to the operator.

## Reading the numbers

- **brier** — mean squared error, `(p − outcome)²`. Lower is better. 0.25 is
  what "always say 50%" scores.
- **brierIndex** — `(1 − √brier) × 100`, the Forecasting Research Institute's
  consumer scale: 100 clairvoyant, 50 is the coin-flipper, 0 is confidently
  wrong.
- **n** — sample size, printed next to every score. A venue with nine
  observations is not beating a venue with nine hundred.

## Exclusions are published

Every observation the ledger cannot read or cannot settle is counted by reason
and published in the `excluded` object: unparseable titles, missing strikes,
ambiguous directions, out-of-band prices, out-of-horizon expiries, venue
outages, and voids.

A ledger that quietly drops what it cannot handle is a marketing asset, not a
measurement. The exclusion counts are usually larger than the scored counts.
That is expected, and it is on the page.

## Known limits

- **Short horizon only.** Oracle samples are retained four days, so questions
  further out than 72 hours are never observed. This is a real limit, not a
  design preference.
- **One observation per market, ever.** A market is priced once, when first
  seen in-band. Re-pricing later would let us choose the entry that flatters
  the score.
- **Three assets.** SOL, BTC, ETH — the feeds every venue quotes and our oracle
  carries.
- **Title parsing is strict.** Anything ambiguous is dropped rather than
  interpreted. Coverage is deliberately traded for correctness.
- **Venue field names are probed, not assumed.** If a venue renames a field,
  coverage drops and the exclusion count rises. It cannot silently corrupt a
  score.

## Who advances it

The public crank — [`tools/crank.mjs`](../tools/crank.mjs), which anyone may
run against this site or any mirror. If we stop running it, the scoreboard that
grades us alongside everyone else keeps advancing anyway. That is the only
version of it worth publishing.

There is no platform scheduler behind it. A read that finds the board more than
six hours stale advances it once as a floor, so it cannot silently rot — but the
mechanism is the crank, and the crank belongs to whoever runs it.

---

*Everything above is recomputable from [`lib/ledger.js`](../lib/ledger.js) and
the public endpoint. If a number here is wrong, it is checkable, and we would
rather be checked than believed.*
