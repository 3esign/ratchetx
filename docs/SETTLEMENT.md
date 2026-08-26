# How RatchetX pins the exit price

The whole game rests on one sentence: **the exit price is the first oracle
sample at or after expiry — settling early, late, or by a stranger produces the
same number.** This page documents how that sentence is enforced today, and how
the v3 program enforces it on-chain. The mechanics below were worked through
with the Pyth team on their developer forum in August 2026, after the Pyth Core
upgrade (August 26, 2026, 16:00 UTC) put Hermes and historical timestamp API
access behind API keys.

## Today (v2, API layer)

The backend reads Pyth's **sponsored on-chain push feeds** (shard 0; per-feed
heartbeat/deviation parameters are in the Pyth docs). Sponsored accounts are
the *latest* on-chain value — not a historical archive — so the server records
samples as they arrive, and settlement takes the first recorded sample at or
after expiry. If no sample lands within 15 minutes of expiry, the shot **voids
and refunds** — we would rather give the stake back than invent a price. Anyone
can trigger settlement (see [SELF_HOST.md](SELF_HOST.md) and `tools/crank.mjs`).

This path uses no Pyth API key and is unaffected by the Core upgrade.

## v3 (on-chain settlement, trust-free cranks)

v3 moves the same rule into bytecode. Two paths, layered so that the game never
depends on a paid external service:

### Primary: the checkpoint race (free, fully on-chain)

After a shot expires at `T`, **anyone** can call the `checkpoint` instruction.
It reads the sponsored push account for the shot's feed and, if that account's
`publish_time >= T`, records `(price, publish_time)` into the shot — keeping,
across *all* checkpoint calls, the observation with the **earliest**
`publish_time`. Settlement then finalizes on that earliest qualifying print;
if none is recorded inside the void window, the shot refunds.

Why this is safe to open to strangers: the recorded value is monotone — a
competing cranker can only *improve* the answer by submitting an **earlier**
qualifying print, never worsen it. The party who profits from prompt settlement
has every incentive to checkpoint immediately; our own keeper and every
`tools/crank.mjs` runner add redundancy; and the void refund caps the damage of
total neglect. This is v2's "first recorded sample" rule with the recording
moved on-chain and the recorder role opened to the world.

### Optional precision upgrade: signed historical updates (API-keyed)

For exact *first-print* proofs, the upgraded Hermes timestamp endpoint
(`https://pyth.dourolabs.app/hermes/v2/updates/price/{publish_time}`, binary
encoding — **requires a Pyth API key** after the Core upgrade) returns the
signed Core update whose metadata includes `prev_publish_time`. A cranker
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

RatchetX's stance: the checkpoint race is the guaranteed floor and ships
first; the keyed predicate path is an optional sharpening we can turn on
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
