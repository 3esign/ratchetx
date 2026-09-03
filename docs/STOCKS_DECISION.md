# Stocks: what is actually possible, and the one change that makes it fair

**Status 2026-09-03.** Decision memo. Nothing here is built into the program.
The measurement it asks for is `STOCK_CADENCE.cmd`; the feed ids it rests on are
pinned in `docs/STOCK_FEEDS.json`.

## The question

"Is there a way to have stocks that is our win?"

## What is already settled, and it is the hard part

Stocks are reachable **with no API key, no subscription and no server in the
loop**. `docs/STOCKS_ONCHAIN_TOKENIZED.md` measured this on 2026-09-02: the
tokenized equities (`Crypto.TSLAX/USD` and its siblings) are filed by Pyth under
the *Crypto* asset class, and Crypto is the class Pyth sponsors on Solana with
permanent push accounts. Those accounts are `PriceUpdateV2` at sponsored PDAs —
exactly what `load_push_price_update` was written for. Owner is the Pyth
receiver, verification level is `Full`, the feed id matches.

**No program change of any kind is required to read them.** Only the feed table
changes. A stranger with any RPC can verify every settlement.

Two paths that looked better are closed and stay closed:

- The Pyth **pull** path needs a signed update from Hermes, and Hermes has
  required a key on every host since the 2026-08-26 Pyth Core upgrade. A key is
  the exact dependency the frozen core exists not to have.
- Native `Equity.*` feeds are not sponsored on Solana on any shard. Measured
  0/10 across all 256 shards.

## What blocks it: one number against another

The six maintained xStocks publish as a **batch, every 870 seconds** — the same
integer for all six, one publisher writing them together.

The program's seal rule wants an entry price no older than

```rust
max_seal_age(minutes) = clamp((minutes * 60 * 15 + 50) / 100, 30, 60)
```

which **clamps at 60 seconds for every horizon**. A 24-hour target gets the same
60-second bound as a 5-minute one, because of the `min`.

60 / 870 ≈ **6.9%**. About 93 stock seals in 100 would be refused, at every
horizon. That is not a feature with a rough edge; it is a feature that does not
work, and the freshness guard is right to refuse it.

## The three options on record, and why two of them are wrong

`docs/STOCKS_ONCHAIN_TOKENIZED.md` left three: drop it, scale the seal bound to
the horizon, or wait. Since it was written, ruleset 2 shipped `HORIZON_MASK` —
per-feed control over which windows a feed may be sold at — which changes what
is available. With that in hand:

**Dropping it is giving up a thing we already have for free.** The mechanism is
keyless, permissionless and on chain. The only obstacle is a bound written for
feeds that tick every second.

**Scaling the seal bound is the dangerous one, and it is worth naming why**,
because it reads as the obvious fix. Allowing a 24-hour shot to seal on a
15-minute-old price does not just relax a promise; it creates a position that
did not exist before. A player watching the real market knows what TSLAX has
done in those 15 minutes. The program does not. That player is not predicting —
they are sealing against a price they already know is wrong, in the direction
they already know it moved. The existing doc defends this as "a rounding error
on a day-long call", which is a comfort argument, not a bound. It is an
information asymmetry, and information asymmetries do not shrink because the
window is long; they get *harvested* patiently.

**Waiting costs nothing and decides nothing.** Keep it as the fallback, not the
plan.

## The proposal: bind the entry crossing forward

Today `entry_e12` is the **last price published before the seal**, at most 60
seconds old. Change it, *for slow feeds only*, to the **first price published at
or after the seal**.

```
today:     entry = last publish before sealed_ts,  age <= max_seal_age
proposed:  entry = the unique publish where  prev_publish_time < sealed_ts <= publish_time
```

That predicate is not new. It is the *same* crossing rule ruleset 2 already
binds at the other end of the shot:

```
exit:   prev_publish_time < expiry_ts  <= publish_time     (bind_crossing, built)
entry:  prev_publish_time < sealed_ts  <= publish_time     (proposed)
```

Exactly one Pyth message in existence satisfies each. Same `FeedClock` ring,
same lazy permissionless binding, same idempotency, same evidence fields. It is
the existing mechanism pointed at the other end.

### What it buys

1. **The freshness bound stops mattering for entry, without being relaxed.**
   You cannot seal on a stale price if your entry price *does not exist yet*.
   Stock seals go from ~7% landing to ~100%, and no published promise about
   freshness is loosened — the promise gets *stronger*, from "your entry is
   recent" to "your entry is unknowable at seal".
2. **It removes the arbitrage instead of bounding it.** Nobody — not the player,
   not us, not a market maker watching NASDAQ — knows the entry price when the
   shot is sealed, because it has not been published. There is no asymmetry left
   to harvest.
3. **It is the discipline the game already uses.** The shot's *side* is
   commit-reveal. The entry becomes commit-then-bind. Both ends of the shot are
   then fixed by chain data that nobody controlled at commit time. That is the
   same sentence, said twice.

### What it costs, stated plainly

1. **The card cannot say "sealed at $353.18".** It says the entry binds at the
   next print, and on this feed that is within about 15 minutes. This is a real
   product change and it goes on the card next to the two disclosures already
   required there.
2. **The front of the window is consumed by the binding delay.** Up to 870s: 4%
   of a 6-hour window, 1% of a 24-hour one, and **290% of a 5-minute one**.
   Which is why this does not replace `HORIZON_MASK` — it *composes* with it.
   Binding makes the entry honest; the mask keeps the window long enough that
   the binding delay is noise. `STOCK_CADENCE.cmd` prints the suggested mask
   directly from the measured gaps.
3. **It must be per-feed.** On SOL's 60-second heartbeat, forward-binding a
   5-minute shot would eat 20% of the window at the front, for no benefit —
   SOL already seals ~100% of the time. Crypto keeps observed-entry. So this
   needs an `ENTRY_MODE: [u8; N]` alongside `HORIZON_MASK`, not a global switch.
4. **It is ruleset 3 work.** `Shot` needs `entry_publish_time`,
   `entry_prev_publish_time` and an `entry_bound` flag; there needs to be a
   `bind_entry` instruction; and the clock ring must retain enough history to
   cover a seal that goes unbound for a while. That is a program change and a
   redeploy, not a config edit.

## So: is it "our win"?

Yes, and specifically because of the limits rather than in spite of them.

Every stock prediction market that settles on an exchange print **closes when
the exchange closes**. The xStocks feeds are 24/7 and sponsored on Solana. So
what this permits is: *TSLAX up or down over the next 24 hours, sealed on a
Saturday, settled by a program with no server in the loop, no key anywhere in
the path, verifiable by any stranger with any RPC, on an entry price that did
not exist when the shot was taken.*

That is not a smaller version of a stock market. It is a different one, and it
is one the exchange-hours competition structurally cannot offer.

It is also a product whose card can state its own limits precisely — TSLAX not
TSLA, 6h and 24h only, entry binds forward — and be *more* trustworthy for
saying so. That is the whole thesis of this machine applied to a new asset.

## The slowness cuts both ways, and the second cut is in our favour

Added 2026-09-03, from `docs/ONCHAIN_COST.md`. An 870-second cadence is a
problem at the seal and an *advantage* everywhere else, because every other cost
in this machine is paid per publish interval rather than per shot.

| | SOL (60s) | xStock (870s) |
| --- | --- | --- |
| checkpoint ceiling | 1,440 tx/day | **99 tx/day** |
| ring coverage (64 observations) | 64 min | **928 min** |
| checkpoints per shot at 3,000 shots/day | 0.420 | **0.033** |

Two things fall out of that, and neither was obvious.

**The ring stops being a problem.** 64 observations at 870 seconds is 15.5 hours
of coverage. The 6-hour horizon fits inside it with room to spare, so a 6-hour
stock shot settles straight from the ring with **no `bind_crossing` call at
all** — where a 60-minute SOL shot is already close to the 64-minute edge.
Blocker 2, the one that needed a whole new instruction to solve for crypto,
barely applies to stocks. Only the 24-hour horizon needs a bind, and it needs
exactly one.

**Cranking a stock feed is nearly free.** 13× fewer checkpoints per shot than
SOL, because one checkpoint serves every shot expiring in its 870-second window
and that window is 14.5× wider. On the levy in `ONCHAIN_COST.md`, stocks are the
cheapest thing on the board to keep settling.

So the honest summary of the cadence is: it forbids short windows and it makes
long ones cheaper and more robust than crypto's. That is a coherent product —
long-horizon stock markets, 24/7, settling more reliably than the flash markets
beside them — rather than a compromise.

## Forward-binding needs the bounty, and that is not a coincidence

Binding the entry forward adds a step somebody must take: the entry price is not
known at seal, so an instruction has to bind it once the next print lands. That
is a new liveness dependency, and on its own it would make the proposal *worse*
than the rule it replaces — an unbound entry is a shot that cannot settle, and
nobody is paid to bind it.

The crank bounty in `ONCHAIN_COST.md` is exactly what removes that objection.
`bind_entry` joins `checkpoint`, `bind_crossing`, `settle`, `void_shot` and
`forfeit` as a permissionless action that pays its caller, so it gets done
because doing it is profitable rather than because somebody is watching.

**So the two proposals are one proposal.** Forward-binding is safe to ship only
if the bounty ships with it, and the bounty is what turns every "somebody must
call this" in the program from a hope into a market. Neither should be built
alone.

And the amortisation applies here too: one `bind_entry` call serves every shot
sealed in the same 870-second window, so the slow feed makes entry-binding
cheap for the same reason it makes checkpointing cheap.

## What the cadence measurement can and cannot change

The measurement running tonight settles one thing: whether 870 seconds is
stable. It is worth having, and it is not worth waiting on before building,
because of what the possible outcomes do to the decision.

| if the measurement shows | the mechanism | the mask |
| --- | --- | --- |
| ≤ 120s (very unlikely — 870 was measured) | unchanged, stocks work today | fully open |
| ~870s and stable | forward-bind the entry | 360 + 1440 |
| slower, or erratic | forward-bind the entry | 1440 only, or none |

**In every outcome but the first, the answer is the same mechanism.** The
measurement tunes *which horizons open*, which is one constant in
`HORIZON_MASK` — not *whether the design is right*. So the ruleset-3 work
(`entry_publish_time`, `bind_entry`, the per-feed `ENTRY_MODE`, and the crank
bounty it depends on) can start now, and the mask value is filled in when the
report lands.

That is the answer to "do we have to wait": no, not to build. Only to publish.

## What must be measured before any of it ships

1. **Is 870s the real cadence, or was it a quiet afternoon?** 13.4 minutes and
   18 polls establishes "at least 870s". It does not establish stability, and
   every number above is downstream of it. → `STOCK_CADENCE.cmd`, run for hours,
   ideally across a US market open and a weekend.
2. **Does the publisher stall?** COINX was 10.7 hours stale and HOODX 6.8 days.
   Those are not slow feeds, they are abandoned ones. A feed table needs a
   *liveness rule* that drops a target when its publisher stops — a one-time
   check at listing is not enough, and the staleness guard dropping the target
   is the behaviour to build on.
3. **Does TSLAX track TSLA closely enough that the card is honest even with the
   disclosure?** `Crypto.TSLAX/TSLA.RR` is the redemption-rate feed and is
   pinned in `docs/STOCK_FEEDS.json`. The premium/discount can be measured
   directly rather than assumed small.

Until (1) is done nothing should be listed, because every conclusion here is a
function of one number measured once.

## Files

- `docs/STOCK_FEEDS.json` — the feed ids, pinned. The 2026-09-02 measurement
  used ids that were fetched ad hoc and never committed, so the number the whole
  decision rests on could not be re-derived from this repository. It can now.
- `tools/stock_cadence.mjs` / `STOCK_CADENCE.cmd` — the measurement, with SOL as
  a control that refuses to let a lying RPC produce a confident wrong answer.
- `test/test_stock_cadence.mjs` — pins the horizon table and the seal bound to
  `lib.rs`, so a change to the program fails the tool rather than silently
  making its report describe a game that is not running.
