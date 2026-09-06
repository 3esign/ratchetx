# Sixty — the mini-game, and why it needs no new program

**Scope proposal, lead, 2026-09-06.** Semir asked for a small on-chain game that
is extra fun and genuinely feeds the token. Here is a scope I would defend, with
the parts that are free separated from the parts that are not.

---

## 1. The constraint that shapes everything

**No new program.** A second deploy costs SOL he does not have, and the programs
are finalised with exact capacity. So the mini-game must be built out of what is
already on chain.

That sounds limiting until you notice what the parameters actually are: **a
different evidence spec and ruleset ARE a different game.** The grid, the lag,
the capture grace, the horizon, the stake bounds and the band are all per-spec
and per-ruleset accounts. Register two accounts and you have a second game, with
the same proofs, the same verifiability and the same settlement machinery.

Cost: one `EvidenceSpecV2` (262 bytes) and one `Ruleset` (206 + discriminator).
At the RPC's real rent that is **about 0.005 SOL, once.**

## 2. The actual problem this solves

OpusB measured it tonight and it is a product fact, not a test fact:

> A player waits about twenty minutes after their target to see a settled result.
> Target at 00:55, settlement no earlier than 01:19:59.

The 300-second horizon is the game; the other 1199 seconds are the evidence
window — lag 299 plus capture grace 900. **The shortest chamber we have feels
broken, and no amount of design on the waiting screen fixes a twenty-minute
wait.**

## 3. Sixty

One minute of game, and a result in about four minutes.

| | today | Sixty |
|---|---|---|
| grid | 300 s | **60 s** |
| admissible lag | 299 s | **59 s** |
| capture grace | 900 s | **60 s** |
| horizon | 300 s | **60 s** |
| target → settled | **1199 s** | **119 s** |

Every one of those numbers is legal, and I checked each against the program
rather than proposing them:

- `lag < grid` — 59 < 60 (`lib.rs:618`, the rule R2 enforces)
- `grid ≤ MAX_GRID_SECONDS` — 60 ≤ 86,400 (`state.rs:53`)
- `lead ≥ MIN_OPEN_LEAD_SECONDS` — 60 ≥ 30 (`state.rs:54`)
- `lead ≤ horizon` — 60 ≤ 60
- forward mode: `horizon % grid == 0` — 60 % 60 = 0
- `ahead − lead ≥ grid − 1` — 3600 − 60 = 3540 ≥ 59
- **and the one that would have bitten:** `spec.target_grid_seconds ==
  rules.target_grid_seconds` (`lib.rs:4549`). The grid lives in BOTH accounts and
  they must agree, so this is two registrations, not one.

## 4. Why this feeds $RCX, said plainly

The only sink in the whole economy is `reload_rcx`: RCX is burned, routed and
retained, and the consumed amount becomes credits at 1,000,000 raw units each —
one RCX, one credit. Nothing else consumes the token.

So token demand is a function of **how many shots a player takes**, and shots are
a function of **how fast the loop closes**. A four-minute loop instead of a
twenty-four-minute one is roughly six times the shots in the same sitting. That
is not a gimmick or a bonus mechanic; it is throughput, and it is the honest
version of "contributes to value through fun".

I am deliberately not proposing a new token mechanic. Anything that mints,
multiplies or rewards differently changes the economy the owner signed, and the
manifest is approved. **Sixty changes the clock, not the money.**

## 5. What makes it fun rather than just faster

The ledger already carries `streak` and `best` and nothing surfaces them
properly. At five minutes a round a streak is a thing you can actually build
inside one sitting — at twenty-four minutes it is a statistic. **The mini-game is
the ladder: consecutive hits, live, with the streak visible while it is running
and your best beside it.** No chain change; the fields exist.

That is the whole design. A shorter clock makes an existing number matter.

## 6. Explicitly not in scope

- No new program, no upgrade, no second deploy.
- No new token mechanic, multiplier, jackpot or bonus pool.
- No change to the approved economy: same stake bounds, same band, same XP base.
- No new feed. SOL, the one the observer already watches.
- Not a replacement for the 300-second game. It sits beside it.

## 7. Who, and when

- **CodexAstra: nothing.** She is the bottleneck until L2 closes and this must not
  touch her.
- **OpusB** — validate the seven parameter rules above against the Rust rather
  than against this document, the same way he verified the airdrop tree. If one of
  them is wrong the whole scope changes and it costs him ten minutes to find out.
- **Astra 2** — the ladder is surface work and it is hers, after the site.
- **Me** — the two registrations, once L2 is green and the machine is proven on
  the long game first.

**Order matters: the 300-second game settles a real shot before anything is built
for Sixty.** A second game registered on top of a first that has never completed
would double our unknowns for no reason.
