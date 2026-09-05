# The game costs 3.4 SOL a day in permanent rent, and nothing recovers it

**From:** the lead, 2026-09-05. **Derived from constants, not sampled.**
**For:** Semir — this is a product decision, and it is the largest number nobody has stated.

## The fact

Timepin v2 has **no close instruction at all**. Its own header says so:
`lib.rs:3` — *"permissionless and holds no value, admin, pause, close, or …"*; `lib.rs:75` — *"The
resulting PDA has no edit or close instruction."* Every `EvidenceSpec`, every `Need` and every
`Candidate` is permanent, and so is its rent.

That is a deliberate and good property: nobody can delete evidence. It also has a price, and the
price scales with **time**, not with players.

## The number

A `Need` is one per `(spec, target_ts)` — shared by every player on that target — so the count is
set by the grid alone. Rent from the two measured figures (Codex: Candidate 1,564,251 lamports at
119 bytes, Need 1,646,580 at 132), which agree on one constant of 6,333 lamports per `(128 + len)`:

| grid | targets/day | today (Need + Candidate) | with the inline observation |
| --- | --- | --- | --- |
| 60 s | 1,440 | **4.62 SOL/day — 1,688 SOL/year** | **3.36 SOL/day — 1,225 SOL/year** |
| 300 s | 288 | 0.92 SOL/day — 338 SOL/year | 0.67 SOL/day — 245 SOL/year |

Permanently locked, accumulating, whether one person plays or a thousand do. **The player who opens
each Need pays it**, so it is not a treasury cost — it is a per-target toll charged to whoever moves
first, and it never comes back to anyone.

## Three things this changes

1. **The inline observation is worth 1.27 SOL/day at a one-minute grid**, not just the tidier code.
   That is 463 SOL a year. It was already the right call; this is the number.
2. **The grid is an economic decision, not only a game-shape one.** A five-minute round costs a fifth
   as much. If Semir wants the one-minute game — and the game is better at one minute — that is fine,
   but it should be chosen knowing it is five times the permanent cost.
3. **"No close" deserves to be re-examined once, deliberately, before the economy is registered.**
   Not to weaken immutability — evidence must stay — but a terminal Need whose every referencing shot
   is settled and past its reveal deadline is holding 240 bytes that nobody will ever read again. A
   close path that (a) requires terminal state, (b) requires the reveal window to have elapsed,
   (c) writes the terminal result hash into a permanent record first, and (d) refunds to the recorded
   payer, would keep every claim provable while returning the rent. That is a design change, not a
   fix, and it is out of scope for the launch — but the launch should be made in full knowledge of
   what it is choosing.

## What this is not

Not a bug, not a theft path, and not urgent. It is a cost that is invisible until the year it is
not, and it is the kind of number that should be on the table when the write-once economy is
registered rather than discovered afterwards, because that economy cannot be edited.
