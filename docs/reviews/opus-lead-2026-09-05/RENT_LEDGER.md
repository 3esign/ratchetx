# The whole permanent-rent ledger — and every line of it is recoverable

**From:** the lead, 2026-09-05. Derived from constants, one measured rent figure, and the PDA seeds.
**Rule being applied:** it runs on gas and mini fees. Anything permanently locked is a defect until
proved otherwise.

## What is locked, and by whom

| account | size | how many | closed today? | who pays |
| --- | --- | --- | --- | --- |
| Timepin `Need` | 240 B | one per target — **1,440/day** at a 1-minute grid | **no close instruction exists** | first player on that target |
| Core `PlayerDay` | 100 B | **one per player per day** (`[PLAYER_DAY_SEED, economy_hash, score_day, player]`) | **never closed** | the player |
| Core `RankShard` | 180 B | 16 per day | never closed | whoever seals first |
| Core `DayFinal` | 291 B | 1 per day | never closed | whoever finalizes |
| Core `Shot` | 780 B | one per shot | **yes** — `close = rent_refund`, 6 sites | refunded |
| Core `PlayerLedger`, `Economy`, `Ruleset` | — | one each, permanent by design | n/a | correct as-is |

`Shot` is the only account in either program that gives its rent back.

## The number

| daily players | Core accounts | + Timepin Needs (1-min grid) |
| --- | --- | --- |
| 100 | 0.18 SOL/day — **65 SOL/year** | 3.53 SOL/day — **1,290 SOL/year** |
| 1,000 | 1.48 SOL/day — **539 SOL/year** | 4.83 SOL/day — **1,764 SOL/year** |

And the line that matters most, because it is charged to a person rather than to a system:

> **A player who plays every day for a year permanently locks 0.527 SOL in `PlayerDay` accounts
> alone** — accounts that exist to hold one day's score, after a day that is finalised and paid.

That is not gas. That is a subscription nobody agreed to.

## Why every line is recoverable

Same argument as the Need, checked the same way — does this account hold anything nothing else holds,
after its purpose is served?

- **`PlayerDay`** holds one day's score for one player. After `finalize_day` the day is closed and the
  podium is paid; the outcome lives in `DayFinal` and in the player's `PlayerLedger`. The per-player
  daily row is spent state. **Close it, refund the player.**
- **`RankShard`** is the day's ranking working set, 16 of them. After `DayFinal` it is spent the same
  way. **Close, refund whoever funded it.**
- **`DayFinal`** is the one account per day that genuinely is a permanent claim — 0.0027 SOL/day,
  under 1 SOL a year. **Keep it.** That is the honest cost of a day that can be proved later.
- **`Need`** — argued in `RENT_IS_TEMPORARY.md`: everything it holds is copied into every `Shot` that
  uses it, and `Shot` outlives it. **Close on `open_refs == 0`.**

So the recoverable share is roughly **1,763 of 1,764 SOL a year**. What should remain permanent is
one small account per day.

## Shape of the fix, and it is one shape three times

Every one of these is the same two-part change: **record who paid, and close when the account's
purpose is provably finished** — by a counter or a terminal state, **never by a timer**. A
time-based close re-creates the reveal-budget defect: someone else's clock destroying a player's
claim.

- `Need`: `open_refs == 0` and terminal → refund `rent_payer`.
- `PlayerDay`: `DayFinal` exists for that day and the player's row is settled → refund the player.
- `RankShard`: `DayFinal` exists for that day → refund its payer.

## Sequence

`Need` goes in Opus A's current pass — same struct, same ABI break, same build. The two Core closes
are independent of MIN-CAPTURE and can follow, but they must land **before the economy is
registered**: `register_economy` is content-addressed and immutable, and a launch without them bills
every daily player half a SOL a year for storage nobody reads.
