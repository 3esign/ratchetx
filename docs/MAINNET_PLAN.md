# The last step: RatchetX on mainnet, permissionless, no ongoing cost

> **SUPERSEDED as a plan on 2026-09-05.** The single tracker is
> [`docs/ROAD_TO_MAINNET.md`](ROAD_TO_MAINNET.md); agents enter through
> [`AGENT_ONBOARD.md`](../AGENT_ONBOARD.md). This file is kept as history — do not plan from it, do
> not claim work out of it, and do not update it. Where it disagrees with the tracker, the tracker
> wins. Six overlapping plans is what produced the integration bottleneck this project is fixing.


> **SUPERSEDED IN PART, 2026-09-04 23:0x.** This page was written believing no
> ruleset-2 artifact existed and that building one blocked everything. That was
> wrong: `onchain/ratchet-core-g2/` already has a built artifact, a program id
> and SVM lifecycle tests. **P1 below is DONE.** The trunk is `ratchet-core-g2`,
> not `ratchet-core`, and g2 is a further generation rather than ruleset 2 in a
> new folder — economy and ruleset as on-chain PDAs, domain-separated hashes,
> sharded ranks, paged history, and a `foreign_timepin` evidence path in place
> of the fixed ring.
>
> The revert of `c42baf8` at 00:43, which section 4 treats as an unexplained
> collision, was consolidation into g2 and was the **correct call**.
>
> `docs/AGENTS_CHANNEL.md` carries the current starting point and the g2 cost
> numbers. Read that first; this page is kept for the phases and the goal
> correction, which still stand.

**Written 2026-09-04 for four agents working in parallel.** Purpose: agree on
what is true before agreeing on what to do. Every claim below was checked
against a file or a measurement today; where something is unverified it says so.

---

## 0. One correction to the goal, because it changes what "done" means

The goal as stated is "fully mainnet permissionless decentralized **rent free**
game on Solana". Rent-free is not achievable and should not be planned for:
**Solana requires a rent-exempt deposit on every account that persists.** There
is no configuration, no program design and no future upgrade that removes it.

What *is* achievable, and what the measurements say we already have:

- every deposit is **refundable** — `close_shot` returns the Shot rent to the
  player who paid it
- the house pays **nothing ongoing** — no sponsorship, no keeper subsidy, no
  server bill in the settlement path
- the only recurring cost, the crank, can be **funded from the game's own flow**

So the goal restated in terms that can actually be met: **no ongoing cost to
anyone but the player taking the action, and every lamport a player locks comes
back to them.** That is the target. Measured numbers in `ONCHAIN_COST.md`:
0.002659 SOL locked per open shot (returned), 0.00002 SOL spent per shot
lifecycle (gone), 0.0108 SOL per player to exist on chain with three chambers.

---

## 1. What is true right now

**Where the money lives: Upstash Redis.** Every credit, XP point and open shot
is a database row. The game is well-tested, well-defended and **custodial**.
Replacing this is the whole remaining job; nothing else on this page matters
except as a means to it.

**What is genuinely trustless already: the referee.** Seal v2 is on mainnet and
proven — a sponsored Pyth push account read in-program, a permissionless clock,
settlement on the unique first update crossing expiry, equality voids. Nobody
can choose the price a shot settles on. This was the hard problem and it is
solved.

**And the half that sentence always owes.** Nobody can pick the price; nobody
can be *made* to crank either. `settle`, `checkpoint` and `bind_crossing` are
permissionless, which means anyone may call them and no one is obliged to. A
shot nobody records **voids and refunds** rather than resolving wrongly — the
failure is bounded and returns the stake, but it is a real failure mode and not
a footnote. This is precisely why the crank levy exists: it converts "somebody
should" into "somebody is paid to", and until it ships with a non-zero number
the liveness assumption is that somebody cares.

**What exists in source and has never run anywhere:** ruleset 2 (credits, stake,
1.7× payout, XP, streaks, podium, reload, delegation, legacy claim,
`bind_crossing`, confidence preservation, version binding, horizon mask), plus
the crank purse and `bind_entry`.

**What does not exist:** a ruleset-2 build artifact.
`onchain/ratchet-core/artifacts/` holds three `.so` files and all three are v1,
newest 2 September. The deployed program is **devnet only, running v1**. Nothing
written in the last two days has ever been compiled for BPF, let alone deployed.

**Release blockers:** 5 of 8 closed, each by a test rather than by prose.
Blocker 6 needs a run. Blocker 8 is narrowed and has a proposal.

---

## 2. What was learned in the last 24 hours that changes plans

Four findings, each of which invalidates something previously written down.
They are listed because a plan built on the superseded versions will waste time.

**The crank is not a fixed bill.** A checkpoint is only useful where a shot
expires, and one serves every shot expiring in that publish interval — so cost
per shot *falls* as the game grows (1.33 per shot at one player, 0.32 at ten
thousand). That is the shape a self-funding levy needs, and it means the
recurring cost can come from the flow instead of a sponsor.

**But the ring covers almost nothing.** Measured over 8 hours at a 5-second
poll: SOL produced 5,435 distinct publish times in 5,516 polls. The cadence is
at or below 5 seconds, so a 64-slot ring covers **at most 5.3 minutes**. **Every
horizon the game sells outruns it, including the 5-minute flash.**
`bind_crossing` is on the critical path of *every shot*, not an edge case for
long horizons. Any levy must be sized for one bind per shot as a floor.

**The 24/7 stock market was five-sixths wrong.** TSLAX, NVDAX, MSTRX, CRCLX
stopped publishing at 15:47 ET and SPYX at 15:57 ET — the US close — and wrote
nothing for the next eight hours. Only AAPLX is genuinely 24/7 (600s exactly,
through the night). The earlier 71-minute run sat entirely inside market hours
and could not have seen it. **Stocks are one feed, not six, and nothing should
be listed before a measurement across a weekend.**

**The levy had a bug that only a validator could catch.** It debited lamports
directly from a Signer owned by the System Program. That compiles, passes all
native tests, and is rejected on chain. Fixed with a CPI. The general lesson for
everyone: **`cargo test` cannot see account ownership, compute limits, stack
depth or CPI rules.** Native green says nothing about BPF.

---

## 3. The plan

Five phases. Each has one exit test, and the exit test is a command someone can
run — not a judgement.

### P1 — Build the artifact (BLOCKING EVERYTHING)

`CORE_G2_BUILD.cmd`. Nothing downstream can start without it, and the code has
only ever been compiled natively. Expect BPF-only failures: stack frames over
4KB, compute limits, CPI signatures. **A failure here is the point of the
phase**, not a setback.

*Exit:* a `.so` in `artifacts/`, its sha256 recorded in `docs/CORE.md`.

### P2 — Devnet, full lifecycle

Deploy the artifact. Drive `seal → checkpoint → bind → settle → reveal →
close_shot` end to end, plus `void_shot` and `forfeit`.

*Exit:* a devnet signature for every instruction, and `close_shot` demonstrably
returning rent.

### P3 — The number that decides the design

`mainnet-exercise.mjs --dry --cu-out` against the deployed program, then
`onchain_cost.mjs --cu`. This needs no SOL — simulation reports compute units
for free.

*Exit:* real CU per instruction in `ONCHAIN_COST.md`, replacing the Seal v2
lower bound. **If a shot's lifecycle does not fit in a reasonable compute
budget, the design changes here** — which is why this comes before any decision
that is expensive to reverse.

### P4 — The three decisions that are the founder's

Not engineering. Each needs a number chosen, not a thing built.

1. **`BAND_K_BPS`** — the confidence band. Mechanism ships, number is 0. Needs
   the 72-hour drill against real confidence data.
2. **`CRANK_LEVY_LAMPORTS` / `CRANK_BOUNTY_LAMPORTS`** — sized from P3's compute
   numbers and one bind per shot.
3. **Stocks: list or don't.** Currently one viable feed pending a weekend
   measurement. Growing `FEEDS` from 7 to 13 is a product choice.

### P5 — Migration, and only then

Freeze (`RX_MIGRATION_FREEZE=1`, tested, stops selling and never stops
settling) → drain open shots → build the root from a quiet store → compile
`LEGACY_ROOT` → deploy → players claim.

*Exit:* balances live on chain and Redis is no longer authoritative.

---

## 4. The biggest risk is not technical

**Four agents are editing `onchain/.../lib.rs`.** That is a larger threat to
this timeline than any item above, and it has already cost work:

- Commit `c42baf8` (the crank purse — which also carried `bind_entry` and
  `ENTRY_FORWARD`, because both staged the same file) was **reverted at 00:43
  with no reason recorded**. Whoever did it may have had a good one; nobody can
  tell, and that is the problem.
- Eleven commits sit in a cloud clone that cannot push (the proxy denies the
  repo), including the CPI fix. Anyone rebuilding the purse from scratch will
  reproduce the lamport bug.

Two rules that cost nothing and prevent most of this:

1. **A revert states its reason in the commit message.** "This reverts X" alone
   makes the next agent guess, and guessing produces either a re-revert war or
   silent loss.
2. **One agent owns `lib.rs` at a time.** Everything else — docs, tools, tests,
   scripts — parallelises safely. The Rust file does not.

---

## 5. Sequencing, honestly

P1 → P2 → P3 are strictly serial and each is short. P4 is decisions, and two of
the three depend on P3's output. P5 is last because it moves real balances.

The single thing standing between here and all of it is **one build that has
never been attempted**. Everything else is either done, decided, or waiting on a
number that build produces.
