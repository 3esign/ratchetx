# Let the chain carry it: don't close the account — don't create it

**From:** the lead, 2026-09-05, after Semir's idea: *carry the data parasitically, let the chain carry
it for us, and we just update — jump, skip over.* That is a better answer than the one I gave, and it
is the answer for `PlayerDay`.

**The pattern is already proven on this chain, by Pyth, for our own data.** Their `EncodedVaa`
account is written in chunks, verified, and then **closed** — the account is a scratch buffer, and the
bytes live on in transaction history. Codex reconstructed a full 292-byte VAA from those chunks off
public RPC this morning. Storage was rented for seconds; the data is permanent as *history*, paid for
with gas.

## Where it applies here, exactly

`PlayerDay` (100 B, one per player **per day**, never closed) carries four numbers:

```
day, rank_shard, accepted, terminal, xp
```

`PlayerLedger` (one per player, permanent **by design**, already exists) carries the lifetime figures:
`credits, xp, streak, best, hits, shots, voids, forfeits, …`

So the daily row is a **window**, not a record — and a window can live inside the thing that is
already permanent:

```rust
// added to PlayerLedger, +32 bytes, once per player, on an account that exists anyway
pub current_day:   i64,
pub day_accepted:  u64,
pub day_terminal:  u64,
pub day_xp:        u64,
```

**The jump Semir described:** when a shot arrives for a day later than `current_day`, the program
`emit!`s the closing day's totals as an event and resets the window to the new day. The old day is
then carried by the ledger's transaction history — free, permanent, and reconstructible by anyone —
while the account holds only today.

## Why this beats the close instruction I proposed an hour ago

| | close `PlayerDay` | carry it in the ledger |
| --- | --- | --- |
| accounts created | 1 per player per day | **0** |
| rent | locked, then refunded | **never locked** |
| transactions | +1 close per player per day | **0** — the jump rides an existing instruction |
| what a player pays | gas twice, rent as float | gas once |

Closing gives the money back. **Not creating the account never takes it.** 0.527 SOL per daily player
per year becomes zero, and so does a daily housekeeping transaction nobody wants to run.

## Where it stops, and this is the honest limit

The podium has to **rank** players against each other, so somewhere on chain there must be state that
sees more than one player. That is `RankShard` (16 per day) and `DayFinal` (1 per day) — and those
are the accounts that genuinely cannot be parasitic, because ranking is a comparison and a comparison
needs both sides present. `DayFinal` should stay permanent: it is one small account per day, under
1 SOL a year, and it is the thing a player points at years later to prove a day happened.

The same limit applies to the Timepin `Need`: it exists so that **every player on one target gets the
same price**, and a shared fact cannot be carried privately. It stays an account — it just stops
being a permanent one (`RENT_IS_TEMPORARY.md`).

So the rule that comes out of this:

> **State that only one party needs, the chain can carry as history. State that two parties must
> agree on has to be an account — but only for as long as they are still agreeing.**

## What is left after all of it

| | today | after |
| --- | --- | --- |
| per daily player, per year | 0.527 SOL locked | **0** |
| Needs, 1-minute grid | 3.36 SOL/day permanent | float of minutes |
| RankShard | 0.031 SOL/day permanent | closed after `DayFinal` |
| DayFinal | 0.0027 SOL/day permanent | **stays — under 1 SOL/year, and it should** |

Gas, one small account per day, and nothing else.
