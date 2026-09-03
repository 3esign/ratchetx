# Core G2 — the account layout, and the three blockers it closes

Status: **built.** Approved as written below and implemented as ruleset 2 on
2026-09-03. The proposal is kept intact because it is the argument, not the
changelog; **"What was actually built" at the end records where the code differs
from it, and why.** Where the two disagree, the code is the truth and the
difference is explained there rather than quietly edited out of here.

The execution plan lists eight release blockers. Three are closed (source-time
binding, Token-2022, and the legacy snapshot). Of the five open ones, three are
this document: an evicting ring used as final evidence, confidence that is not
preserved, and rules that are not version-bound on chain.

They are one design problem wearing three hats, and the fix is a single idea:
**evidence must be bound to the shot it settles, at the moment it exists, by
anyone.**

---

## 1. The ring can be emptied of the truth

`FeedClock` holds 64 observations in a circular buffer. `crossing(expiry_ts)`
searches it for the observation that brackets a shot's expiry:

```rust
self.observations.iter().copied()
    .filter(|o| o.prev_publish_time < expiry_ts && o.publish_time >= expiry_ts)
    .min_by_key(|o| o.publish_time)
```

`checkpoint` overwrites the oldest slot once the ring is full. So the valid
crossing for a shot can be **pushed out of the ring during the decision window**,
after which `crossing()` finds nothing and the shot voids and refunds.

That is not a lost edge case; it is an option somebody holds. An actor who can
influence how many checkpoints land in a window — and checkpointing is
permissionless, which is the point of it — can decide, after seeing the crossing,
whether the outcome stands or the stake comes back. A bigger ring moves the price
of that option. It does not remove it.

**The fix is not a bigger ring.** It is to stop treating a shared, overwritable
buffer as the final word:

```
bind_crossing(shot)          // permissionless, callable by anyone
```

When the ring currently contains a valid crossing for that shot's expiry, this
copies it *into the Shot account* and marks it bound. After binding, eviction is
harmless: `settle` reads the bound copy and never consults the ring again.

What this changes, precisely. Before: an actor who controls volume can force a
refund at any time up to settlement. After: they can only prevent *binding*, in
the window between the crossing appearing and anyone calling `bind_crossing` —
and the player, who is the one person guaranteed to care, can call it themselves
the moment their crossing exists. The option shrinks from "the whole decision
window" to "the seconds before an interested party notices", and the interested
party is not us.

The honest remainder: if nobody binds and the crossing is evicted, the shot still
voids. That is a liveness assumption, and it is now a *stated* one with a named
actor who can discharge it, rather than an unstated one nobody could act on.

---

## 2. Confidence is thrown away, so the band cannot exist

`Observation` is four fields: `prev_publish_time`, `publish_time`, `price_e12`,
`posted_slot`. Pyth publishes a confidence interval with every price and it is
discarded at the door.

Two consequences, and the second is worse than the first. The decision band the
owner approved — void when `|exit − strike| ≤ k × conf`, because that is exactly
the zone a manipulator pays for — **cannot be implemented**, since `conf` is not
there. And it cannot be **audited** either: a settled shot's account does not
carry the number the rule would have used, so nobody can check afterwards whether
the rule was applied correctly. A rule that cannot be checked is a promise.

This is also why no `k` may be frozen yet. There is nothing to measure it
against, on chain, retrospectively.

So: `Observation` gains `conf_e12: i64`, and `Shot` keeps the confidence of the
print it settled on. Then the band is implementable, auditable, and — once the
72-hour drill has produced real rounds — measurable.

---

## 3. A shot does not say which rules it was sold under

`Shot` carries no ruleset version. The feed/horizon matrix (five-minute rounds
for majors only; small caps at an hour and up; PUMP on the long clock) lives in
the board generator, which is a website. The plan is right to call that
presentation rather than protocol: a client that talks to the program directly
can seal a five-minute shot on the thinnest feed in the table, and the program
will take it.

`ruleset: u16` in the Shot, written at seal, read at settle. And the horizon
matrix enforced in `seal`, so it is a rule the program keeps rather than a
courtesy the website extends.

The version field is what makes every later change safe: a shot settles under the
rules it was sold under, forever, and a new generation never silently
reinterprets an old shot.

---

## The layout

```rust
pub struct Observation {
    pub prev_publish_time: i64,
    pub publish_time: i64,
    pub price_e12: i64,
    pub conf_e12: i64,          // NEW — the band needs it; the audit needs it more
    pub posted_slot: u64,
}                                // 32 -> 40 bytes

pub struct Shot {
    // ... every existing field, unchanged ...
    pub exit_conf_e12: i64,          // NEW — what the band was computed against
    pub exit_prev_publish_time: i64, // NEW — the bracket, kept with the price
    pub exit_posted_slot: u64,       // NEW — the slot the print was posted in
    pub ruleset: u16,                // NEW — which rules this was sold under
    pub band_k_bps: u16,             // NEW — the k in force at seal, not at settle
    pub crossing_bound: u8,          // NEW — 0 unbound, 1 bound
}                                    // 225 -> 254 bytes with the discriminator
```

`band_k_bps` is stored per shot deliberately. If `k` ever changes, shots already
in the air keep the number they were sold under. The alternative — reading a
global at settle — means a parameter change silently rewrites open positions,
which is the thing this whole generation exists to make impossible.

### What it costs, at the scale the owner asked about

Rent-exempt minimum on Solana is `(128 + size) × 6960` lamports.

| Account | Size | Rent | 1,000 of them |
| --- | --- | --- | --- |
| `PlayerLedger` | 139 B | 0.00186 SOL | **1.86 SOL** |
| `Shot` (G2, as built) | 254 B | 0.00266 SOL | 2.66 SOL |
| `FeedClock` (G2, as built) | 2,614 B | 0.0191 SOL | 12 feeds ≈ 0.23 SOL |

Player ledgers are permanent; that is the real number, and it is under two SOL
for a thousand players. Shots are working capital: the account closes when the
shot resolves and the rent comes back. `Shot` growing by 20 bytes costs
0.000202 SOL per open shot — a few cents at present prices, and refundable when
the shot closes.

The measurement that makes this tractable was the census: the entire canonical
state of the live game today is 64 players and 140 KB. What is large — 21 MB of
price telemetry — is evidence, and evidence does not belong in account state. It
belongs in Timepin and, eventually, Arweave.

---

## What this does not close

Blocker 8 stands: a sponsored Pyth account is overwritten by its own next update,
so the chain cannot be asked what a price *was*, only what somebody captured and
pinned. `bind_crossing` makes capture matter more, not less, and it does not turn
a live capture into an archive. Timepin remains a no-value prototype until that
has an audited answer.

Blocker 7 is documentation: the owner/PDA/verification checks stop fabricated
prices; they do not stop withholding. Every sentence in the repository that
claims otherwise needs correcting, and this document does not do it.

---

## The order, if this is approved

1. `Observation.conf_e12` and the `Shot` fields, with LiteSVM coverage that a
   settled shot carries the confidence it settled on.
2. `bind_crossing`, permissionless, plus the adversarial test that matters: fill
   the ring past capacity after binding and prove the outcome does not move.
3. `ruleset` written at seal and enforced at settle; the horizon matrix moved
   into the program with a negative control (a five-minute shot on a long-clock
   feed must be refused by the program, not by the website).
4. Golden vectors regenerated so program, server and JS client agree byte for
   byte, as they do today.
5. Only then a build, and only then a number for `k` — from the drill, not from a
   model.


---

## What was actually built

Ruleset 2, 2026-09-03. Five differences from the proposal above, each one found
while writing it rather than while planning it.

**`exit_posted_slot` was added.** The proposal kept the confidence and the
bracket. It did not keep the slot. Without it a settlement can be re-derived
arithmetically but not *located* — you cannot go and look at the transaction that
posted the print. That is 8 more bytes for the difference between "the numbers
add up" and "here is where it happened", so `Shot` grew by 29 bytes, not 20, and
is 254 on chain.

**`crossing_bound` has two values, not three.** The proposal had `2 =
bound-and-settled`. `Shot.state` already says whether a shot settled, and a
second field that also says it is a second field that can *disagree* with it.
One fact, one place.

**Two rules follow from binding that the proposal did not name.** Once evidence
belongs to the shot, the settle deadline stops being a deadline for settling and
becomes a deadline for *capturing* — so a bound shot settles however late a
cranker is. And `void_shot` had to be taught to refuse a bound shot, or the race
binding removed would simply move to whoever calls void first. It stays voidable
after the reveal deadline, as a last-resort unlock that cannot be used as a
weapon.

**The horizon matrix ships fully open.** `HORIZON_MASK[feed_index]` is a bitmask
over `HORIZONS`, checked in `seal`, and every bit is set. The mechanism is in the
program; the policy is not, because the policy is the stocks question and that is
not a decision to make from a keyboard at four in the morning. The negative
control the proposal asked for tests the *rule* (`horizon_allowed_in`) rather
than the shipped table, so a closed market can be proven to close without
shipping a closed market.

There is a second half of that question this does not touch, and it should be
written down where it will be found: `max_seal_age` is
`min(60, max(30, 0.15 × minutes × 60))`. The `min(60, …)` flattens the
window-proportional rule at one minute, which is right for feeds that print
constantly and wrong for anything slower. Cadence is a property of a feed, not of
a horizon. That is a real change and not part of ruleset 2.

**`k` is still zero.** The band is implemented, gated on `band_k_bps > 0`,
producing `VoidReason::TooClose = 3`, and `BAND_K_BPS` is `0`. A LiteSVM test
settles a shot whose move is well inside the print's own confidence and asserts
it settles anyway. If that test ever fails, somebody set `k` without saying so.

### What holds the promise

A ruleset bump is a claim about what did **not** change, and prose is not that
claim. `vectors/core-rules-v2.json` is printed by the program;
`test/test_core_vectors.mjs` holds it against `core-rules-v1.json` field by
field and fails if payout, XP, ranks, chambers, horizons, feeds, deadlines, the
burn split, the podium curve, the PDAs or the commit preimage moved — or if any
instruction that existed in ruleset 1 re-encodes differently. The measured diff
is exactly: two account layouts, one new instruction, four new rule facts.

`v1` stays on disk for that reason. Deleting it would leave the claim with
nothing to prove it.

### The adversarial test

`svm-tests`: two shots, same feed, same expiry, same crossing. One is bound the
moment it expires. Then the ring is flooded past capacity with 70 prints that
would flip both. The bound shot settles on the print it was bound to; the
unbound one, on identical facts, **cannot settle at all** — which is the
counterfactual that proves the flood really did destroy the evidence. Without
that second shot the first half proves nothing.

### Running it

`CORE_G2_BUILD.cmd` runs four steps and stops at the first failure: the
program's unit tests, the golden vectors against `core-rules-v2.json`,
`cargo build-sbf` with the frozen recipe, and the LiteSVM battery against those
exact bytes. CI does the same.

**The reproducibility gate will fail until a ruleset-2 artifact is committed, and
that failure is correct.** The workflow now uploads the fresh `.so` whatever the
gate decides, so the artifact can be taken from the run — download it, commit it
as `artifacts/ratchet_core-v2-YYYY-MM-DD.so`, re-run. Never edit the gate to make
it pass.
