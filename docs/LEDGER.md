# The Coinflip Ledger

**[/api/ledger](https://ratchetx.xyz/api/ledger)** · code: [`lib/ledger.js`](../lib/ledger.js)

Prediction markets are regularly reported at a Brier score around **0.09**, and
the number is real. It is also close to meaningless, because it is dominated by
markets that were never in doubt. A market sitting at 99% on a near-certainty
that resolves the obvious way scores beautifully and demonstrates nothing.

The Coinflip Ledger scores only the questions that were actually hard, and
scores every venue — **including this one** — on the same ones.

---

## One event, one observation

A venue may list a single event as a **ladder of strikes** — ETH above 2,650,
above 2,655, above 2,660 — and those are not independent questions. They share
an event, a moment, and a settlement price. Scoring every rung counts one event
a dozen times and destroys the sample while making it look larger.

The first version of this ledger did exactly that. It scored twelve rungs of one
ETH ladder, every one of them carrying an identical implied probability of
0.395 — a number no ladder can honestly have, since being above 2,650 and above
2,705 are not the same bet. That identical number was the tell: those markets
had no live book, and a last-traded print was being read as if it were a belief.

Both are now refused:

- **One observation per event.** The rung kept is the one closest to a coin
  flip — the hardest question in the ladder, which is what the band exists to
  find. An event already observed is never observed again at a different rung.
- **A live two-sided book or nothing.** No bid and ask, no score. A stale print
  is not a crowd. A spread wider than 0.20 is refused for the same reason: a mid
  drawn from a 40-cent-wide book is not a belief either.

Those counters were versioned rather than reused. Wrong numbers do not get
quietly folded into right ones.

## The rule

An observation enters the ledger only if, at the moment we looked:

1. the venue's own crowd priced it between **0.35 and 0.65** — the band where a
   market is admitting it does not know;
2. it is a price question on **SOL, BTC or ETH** whose terms we can read
   without guessing — either a single threshold (*above* / *below* a strike) or
   a **range** (*between* two strikes, inclusive of both ends);
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
  carries. On Kalshi the asset is not inferred at all: the crypto series are
  requested by name (`KXBTC`, `KXBTCD`, `KXBTC15M` and the ETH/SOL equivalents),
  so the series says what the market is about. An empty or unreachable series is
  named in the exclusion counts rather than silently skipped.
- **A market nobody has quoted is not scored.** A two-sided price is what makes
  it a crowd belief. Unquoted markets are counted as `no-quote`.
- **Ranges are questions too.** "ETH between 2,650 and 2,700" was once the
  single largest exclusion on this board — larger than every other reason
  combined — and it was refused because the resolver only knew one threshold,
  not because the question is any less decidable. A range is two thresholds, and
  the oracle answers it exactly as deterministically as it answers one. Refusing
  it was laziness wearing the costume of rigour, and the fix was to implement
  what we were dropping rather than to loosen anything we were enforcing.
- **Strikes are read from fields where a venue publishes them.** Kalshi exposes
  `strike_type` with `floor_strike`/`cap_strike`, so its questions are read
  structurally and never guessed from prose. A strike shape we will not
  interpret (`between`, `functional`, `custom`) is dropped under its own name.
  Polymarket has no structured strike, so its questions are read from the title
  with a strict parser, and anything ambiguous is dropped rather than
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

## Why the Polymarket lane is empty — measured 2026-08-27

First real numbers: 4 resolved, 7 pending. Kalshi n=4. **Polymarket n=0.**

The obvious reading is that Polymarket does not run questions comparable to ours. That
reading is wrong, and it took one query to find out. Right now Polymarket has 26 crypto
markets inside our 0.35–0.65 band, in our horizon, refreshing every five minutes:

```
Bitcoin Up or Down  - August 27, 5:25PM-5:30PM ET   p 0.505
Ethereum Up or Down - August 27, 5:30PM-5:35PM ET   p 0.505
Solana Up or Down   - August 27, 5:35PM-5:40PM ET   p 0.505
```

Run those titles through our own parser and every one comes back `{"drop":"no-strike"}`.

`parseMarket` requires a strike, because it was written against Kalshi, where every
question is "above X". Polymarket's short-horizon crypto markets are **direction**
markets — and direction is exactly what a RatchetX `kind 0` shot is. The single closest
like-for-like comparison available anywhere is the one we throw away.

So the drop counter was honest and the conclusion drawn from it would not have been. The
lane is empty because of our reader, not their market.

**What supporting them requires, and why it is not a one-line change.** "Up or down" needs
a reference: up from *what*. Their window opens at 5:25 and closes at 5:30, so settling it
against Pyth needs the print at the open as well as the print at the close, and our
predicate has to mean what theirs means. Get that subtly wrong and the comparison is not
merely noisy, it is unfair — which is worse than having no Polymarket lane at all. Until
it is right, the ledger's claim narrows honestly to the venues it can actually read.
