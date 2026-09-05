# How RatchetX pins the exit price

The whole game rests on one sentence, and the sentence has two halves. Both
matter, and for a long time this page printed only the first.

> **Which price is not a choice.** The exit is the first fully verified oracle
> print at or after expiry. Settling early, late, or by a stranger produces the
> same number.
>
> **Whether it settles at all is a liveness assumption.** If nobody records the
> crossing inside the window, the shot voids and the stake comes back. That is
> not a guarantee that a shot always settles; it is a guarantee that the worst
> case is a refund rather than an invented price — and that anyone, including
> the player, can discharge the assumption themselves.

The distinction is the whole honest content of the claim. The program's checks
— owner is the Pyth receiver, the account is the canonical shard-0 PDA for that
feed id, `VerificationLevel::Full`, feed id match, confidence bound — stop a
cranker from **fabricating or substituting** a price. They do not, and cannot,
stop one from **doing nothing**. A party who withholds cannot make you lose on a
price they chose; they can only turn a settlement into a refund, which is a real
loss of expected value to a winning position and is the residual risk this
system carries.

Ruleset 2 closed the other half of that exposure. A cranker who could influence
checkpoint *volume* used to be able to push the crossing out of the 64-slot ring
during the decision window and force the refund at will; `bind_crossing` is
permissionless, costs one cheap transaction, and freezes the crossing into the
shot the moment it exists. After it lands, no amount of later cranking moves the
outcome. What remains is the window between the crossing appearing and anyone
binding it — seconds, dischargeable by the person with the most to lose.

This page documents how the price half is enforced today, and how the v3 program
enforces it on-chain. The mechanics below were worked through
with the Pyth team on their developer forum in August 2026. Ratchet uses the
PriceUpdateV2 state Pyth publishes on Solana as the canonical live evidence plane.

## Today (v2, API layer)

The backend reads Pyth's **sponsored on-chain push feeds** (shard 0; per-feed
heartbeat/deviation parameters are in the Pyth docs). Sponsored accounts are
the *latest* on-chain value — not a historical archive — so the server records
samples as they arrive, and settlement takes the first recorded sample at or
after expiry. If no sample lands within 15 minutes of expiry, the shot **voids
and refunds** — we would rather give the stake back than invent a price. Anyone
can trigger settlement (see [SELF_HOST.md](SELF_HOST.md) and `tools/crank.mjs`).

This path keeps the game and settlement evidence on the same Pyth/Solana account identity.

## v3 (on-chain settlement, permissionless cranks)

v3 moves the same rule into bytecode. Two complementary Pyth integration paths:

### Primary: the checkpoint race (fully on-chain)

After a shot expires at `T`, **anyone** can call the `checkpoint` instruction.
It reads the sponsored push account for the shot's feed and, if that account's
`publish_time >= T`, records `(price, publish_time)` into the shot — keeping,
across *all* checkpoint calls, the observation with the **earliest**
`publish_time`. Settlement then finalizes on that earliest qualifying print;
if none is recorded inside the void window, the shot refunds.

Why this is safe to open to strangers: the recorded value is monotone — a
competing cranker can only *improve* the answer by submitting an **earlier**
qualifying print, never worsen it. It is monotone in the price, not in the
outcome: a cranker who submits nothing at all still converts a settlement into a
refund, which is why the paragraph at the top of this page is two halves and not
one. The party who profits from prompt settlement
has every incentive to checkpoint immediately; our own keeper and every
`tools/crank.mjs` runner add redundancy; and the void refund caps the damage of
total neglect. This is v2's "first recorded sample" rule with the recording
moved on-chain and the recorder role opened to the world.

### The two adapters, and which one settles money

The evidence spec carries an `adapter` byte. It selects the predicate, and there
are exactly two.

**Adapter 2 — MIN-CAPTURE. The mainnet-class rule.**

> For target `T`, the admissible observation is the sponsored print with the
> **smallest `publish_time` such that `publish_time >= T`**, among all
> observations submitted before the Need's `capture_deadline_ts`. Ties: smaller
> `posted_slot`, then smaller `price_message_hash`. **The order of submission
> never selects the price.**

`prev_publish_time` is not part of this predicate, so `max_pre_target_gap_seconds`
carries no meaning under it and is pinned to zero at registration — the field
cannot be dropped, because it is inside `canonical_policy_bytes` and every spec
hash, and a live-looking number that nothing reads would mislead every later
reader. `max_post_target_lag_seconds` is what keeps the rule finite and is the one
bound that matters.

The honest limit, which belongs on this page and not in a comment: the sponsored
`PriceUpdateV2` account holds **one message at a time** and the pusher overwrites
it. A print that was on the account at `T+2` is gone by `T+7`, and the program
reads the live account, never a cache. So a later observer can displace an earlier
capture only *while the message is still on the account*. The assumption is
**1-of-N among observers watching in real time during that window** — not "anyone
until the deadline". A capturer who lets `T+2` vanish and submits `T+7` cannot be
caught by the program. Two independent cranks polling every second are therefore
part of the security argument, not an operational nicety.

**Adapter 1 — the strict bracket. Experimental; not for mainnet.**

```
prev_publish_time < T <= publish_time
```

This is the rule with no chooser at all: it identifies exactly one signed message
per target. It is not a worse rule — it is a rule for a source we do not have. It
needs a feed that delivers *every* aggregate, and the sponsored account is not one:
the pusher posts on its own schedule at a phase that sweeps. Measured over 63
minutes and **442 targets** at grid 60
(`docs/reviews/cadence/cadence-2026-09-05.ndjson`): the bracket settles **11.1 %**
on SOL/BTC (15.4 % at grid 300) and **0–1.6 %** on ETH, BONK, PUMP, JUP and WIF,
while MIN-CAPTURE settles **100.0 % on every feed**. First-print lag p99 is **4 s**
for SOL and BTC and **51–52 s** for the other five, which is why
`max_post_target_lag_seconds` has to be per feed.

The bracket is therefore *not* zero, and an earlier 0-of-25 figure quoted across
this project was one unlucky 25-minute window rather than the rule — SOL visited
all five phase values inside a single hour. The verdict is unchanged: 11 % is not
a game, and a phase that *moves* is the worst possible thing to pin into a
write-once ruleset. But the reason is now the true one.

Such a source does exist in one sense — Pythnet's accumulator ring carries every
aggregate and is readable by anyone with no key — but its leaves cannot be brought
to Solana: the ring's wrapper is signed under the legacy emitter, while the
receiver this program authenticates against accepts only chain-26 emitter
`507974…` under guardian set 1, and no public index carries that emitter at all.
The leaves are free; the signature that would be accepted is not obtainable. That
is the whole blocker, and it is the one thing that would reopen adapter 1.

**The two predicates must never be unified.** They look like a strict and a relaxed
form of one rule, and they are not. On a full-aggregate source the strict `<` on
the left is the only thing excluding intra-second repeats — messages carrying
`pub == prev == T` that genuinely differ in price, conf and ema; 20 of 98 sampled
keys carried up to three of them. Under `publish_time >= T` all of those tie at the
minimum and the tie-break falls to the submitter, handing back the chooser the
design exists to remove. MIN-CAPTURE is safe from this **only** because the account
it is pinned to holds one message at a time: 235 consecutive sponsored writes
carried 235 distinct publish times and zero duplicates. Change the pin and you
change which predicate is safe.

**No key, in either.** A keyed Hermes endpoint would make first-print proofs easy
and is permanently out of scope: a secret in the canonical settlement path is a
project-level failure, not a shortcut. Everything above is reachable from public
Solana state by anyone.

### Design consequences we accept on purpose

- **No paid dependency in the trust path.** Correctness and liveness of v3
  settlement must never require a subscription. Paid data can make settlement
  *sharper*, never *possible*.
- **Liveness is incentive-shaped, refund-floored.** Prompt checkpointing is in
  the winner's interest, redundant crankers make it likely, and the void
  refund makes the worst case a returned stake — never an invented price.
- **The receiver is not an archive.** We never ask "what was the price"
  after the fact from on-chain state; we either record the print as it happens
  (checkpoint) or require a signed update whose publish-time interval brackets
  expiry (predicate).

One rule, three enforcement layers — server today, program tomorrow, refund
always. The proof page re-verifies the claims; the crank keeps them honest.
