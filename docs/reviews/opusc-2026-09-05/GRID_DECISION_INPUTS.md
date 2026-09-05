# The grid decision — three numbers, one page, no recommendation

**For Semir.** `target_grid_seconds` is his decision (tracker §4.4, the product shape). It acquired
two quantified consequences this morning that were measured independently by two agents who were
not looking for each other's result, and they point the same way. Nobody had put them next to each
other. That is all this page is.

**No recommendation is made here.** The grid is a game-feel decision first, and game feel is not
measurable from an RPC.

---

## 1. Void margin — measured, 63 minutes, seven feeds, 442 targets

`max_post_target_lag` is now **derived**: `lag = grid − 1` (Opus A, `6693b90`, proved in
`lifecycle.rs::lag_below_grid_is_exactly_the_condition_for_unique_target_assignment`). That
derivation guarantees a print belongs to **at most one** target. It does not guarantee a print
**arrives** inside the window — that depends on the pusher's schedule, which is not ours.

So: how much of the admissible window does each feed actually consume? `worst` is the larger of the
measured maximum first-print lag and the widest observed publish gap, because a target landing just
after a print waits the whole gap containing it.

| feed | max first-print lag | widest gap | worst | @ grid 60 (lag 59) | @ 120 (lag 119) | @ 300 (lag 299) |
| --- | --- | --- | --- | --- | --- | --- |
| SOL | 4 s | 7 s | 7 s | **12 %** | 6 % | 2 % |
| BTC | 4 s | 7 s | 7 s | **12 %** | 6 % | 2 % |
| ETH | 51 s | 55 s | 55 s | **93 %** | 46 % | 18 % |
| BONK | 52 s | 54 s | 54 s | **92 %** | 45 % | 18 % |
| PUMP | 51 s | 54 s | 54 s | **92 %** | 45 % | 18 % |
| JUP | 52 s | 53 s | 53 s | **90 %** | 45 % | 18 % |
| WIF | 51 s | **58 s** | 58 s | **98 %** | 49 % | 19 % |

**WIF has one second of margin at a 60-second grid.** One publish gap of 60 s — two seconds wider
than one already observed inside a single hour — voids that target. Permanently, for that economy.

The two populations are not close: SOL and BTC use an eighth of their window, the other five use
nearly all of it.

## 2. Permanent rent — derived (Opus, `a0daa0a`)

Timepin has no close instruction at all, by design: nobody can delete evidence. Every Need is
therefore permanent, and a Need is one per `(spec, target_ts)` **shared by everyone on that
target**, so the count is set by the grid alone and **not by the number of players**.

| grid | Needs/day/feed | permanent rent |
| --- | --- | --- |
| 60 s | 1,440 | **4.62 SOL/day, 1,688 SOL/year** (3.36/day with the inline observation) |
| 300 s | 288 | one fifth of that |

The cost scales with **time**, not with players. One person playing costs the same as a thousand.

## 3. Game feel — not measurable

A one-minute round is the better game. That is the whole of the case on this side and it is not a
weaker one for being unquantified.

---

## The thing that makes this cheaper than it looks

**`target_grid_seconds` lives in the EvidenceSpec, and there is one spec per feed** (`lib.rs:303`,
`:330`; the spec PDA is seeded by the spec hash, which contains the feed id). So a **per-feed grid
is already expressible on chain and needs no code change at all.**

What hides it is the manifest's shape, not the program's: `releases/g2-mainnet-economy.json` has one
`evidenceSpecTemplate` with `targetGridSeconds: 60` applied to all seven feeds, and the per-feed rows
carry only `symbol`, `sponsoredAccount`, `feedId` and `maxPostTargetLagSeconds`. Moving
`targetGridSeconds` into the per-feed row is a manifest edit.

That turns "60 or 300?" into a question that does not have to be answered once for everything: SOL
and BTC at 12 % utilisation can carry a one-minute round comfortably; the five feeds at 90–98 % are
the ones the grid is actually about.

## What is NOT claimed here

- Not that a coarser grid is right. That trades a worse game for margin and rent, and the game is
  the product.
- Not that 63 minutes is a 24-hour measurement. It is not, both collectors died at 12:55Z, and the
  tail of a day is wider than the tail of an hour — which makes the 98 % row worse, not better.
- Not that the derived lag is wrong. It is proved and it is optimal **given the grid**. Every number
  above is about the grid, which is the input the proof takes as given.

Evidence tier: `mainnet` for §1 (`docs/reviews/cadence/cadence-2026-09-05.ndjson`, reduce with
`cadence-sampler.mjs summarize`), `host` for §2's arithmetic and for the per-feed-grid observation.
