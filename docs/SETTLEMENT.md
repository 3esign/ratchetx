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

### Optional precision upgrade: signed historical updates

For exact *first-print* proofs, an authenticated Hermes timestamp endpoint can
return the signed Core update whose metadata includes `prev_publish_time`. A cranker
submits `binary.data` through the upgraded Core Solana receiver, and the
program enforces:

```
prev_publish_time < expiry <= publish_time
```

which cryptographically proves the posted update is the first publish at or
after expiry — no trust in the cranker at all. Per Pyth's guidance: if
settlement can happen after the available Hermes history window, the
application must **archive the Core-compatible payloads itself or run a keeper
that fetches and posts them promptly** — a sponsored push account alone cannot
reconstruct arbitrary historical updates. (Also per Pyth: the Pyth Pro
`/v1/{channel}/price` payload is a different format and is *not* a drop-in
replacement for a Core receiver.)

RatchetX's stance: the checkpoint race is the floor that ships first — a floor
in the sense that the worst case is a refund, not in the sense that a settlement
is guaranteed to happen; the keyed predicate path is an optional sharpening we can turn on
without changing any game rule, if and when we choose to pay for it.

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
