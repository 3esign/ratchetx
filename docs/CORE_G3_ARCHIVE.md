# Blocker 8 — a mutable account is not an archive

Status: **proposal, not built.** Nothing here is in Rust. It exists to be argued
with before it is bytes, the same way `CORE_G2_LAYOUT.md` was.

This is the last of the eight release blockers. Seven are closed. This one has
stood since it was written because it is not a bug — it is a property of the
data source — and the plan reserved two acceptable answers for it:

> Core G2 value waits for an audited archival-challenge path **or** a narrower
> rule whose remaining omission assumption is explicitly accepted and
> economically defended.

This document does two things. It closes the first option with a measurement
rather than an opinion, and it proposes something for the second that is
stronger than an accepted assumption: a number, on chain, free, that says
whether the assumption held for a particular shot.

---

## The problem, stated precisely

The sponsored Pyth shard-0 PDA holds one `PriceUpdateV2`: the latest. The next
push overwrites the previous bytes, and they are gone from every account on
Solana. So a program cannot ask "what was the price at time T". It can only ask
"what did somebody capture and pin, before it was overwritten".

That is the whole of it. Everything else in this document follows from that one
sentence.

---

## The archival-challenge option is closed, and not by soundness

The intended fix was to accept a *reposted historical* update: fetch the signed
message for the crossing timestamp from Pyth's Hermes, post it through the Pyth
Receiver — which verifies the Wormhole guardian signatures and marks it
`VerificationLevel::Full` — and let the program read that account instead of
insisting on the sponsored PDA.

**That design is sound.** Worth being precise about why, because the reason will
matter again:

- A caller cannot fabricate. `VerificationLevel::Full` means the receiver
  verified guardian signatures over the message. A caller can choose *which*
  real Pyth message to post; it cannot invent one.
- Choosing which does not help them either, because of the predicate. See
  "Skipping cannot substitute" below: exactly one message in existence satisfies
  `prev_publish_time < expiry <= publish_time`.
- The write-authority worry — that the caller who posted the update could
  overwrite it between the post and our read — is answered by ruleset 2. The
  program binds the values *into the shot*. After `bind_crossing`, what happens
  to the account it was read from is irrelevant, exactly as it is irrelevant
  what happens to the ring.

So the objection is not the mechanism. It is the supply.

**Measured 2026-09-03**, against the two Hermes hosts this repository has ever
named:

| Request | Result |
| --- | --- |
| `hermes.pyth.network/v2/updates/price/1788300000?ids[]=<SOL>` | **401** |
| `hermes.pyth.network/v2/updates/price/latest?ids[]=<SOL>` | **401** |
| `pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=<SOL>` | **401** |

Pyth's own documentation says it plainly: *"since August 26, 2026 at 16:00 UTC
every request must include an `Authorization: Bearer $PYTH_API_KEY` header."*
The instances page still lists `hermes.pyth.network` as a free public endpoint
with a 10-requests-per-10-seconds limit. That page is stale; the endpoint
answers 401.

Note what the probe shows beyond the historical question: **the keyless Hermes
mirror is gone for `latest` too.** The live game does not care, because it
stopped calling Hermes at all — prices are read from the sponsored push
accounts over ordinary RPC, which costs nothing and needs no credential. That
was the right call before this measurement and it is a better one after it.

The standing rule on this project is that no correctness or liveness path may
require a paid credential; paid data may make settlement *sharper*, never
*possible*. An archival-challenge path that only works with `PYTH_API_KEY`
would put a subscription underneath the settlement of real stakes. **So option
one is closed** — not because it would not work, but because it would only work
for as long as somebody paid, and that is precisely the dependency the whole
design exists to avoid.

If Pyth ever restores a keyless historical endpoint, this reopens in an
afternoon: the program-side rule is written above and the client work is one
fetch. It should be revisited then, and not before.

---

## Skipping cannot substitute a price. It can only cause a void.

This is worth writing out, because it is what shrinks blocker 8 from "the
settlement price can be wrong" to "the settlement can fail to happen" — a much
smaller claim, and a survivable one.

Pyth's messages for a feed form a chain: message *n+1* carries, signed, the
`publish_time` of message *n* as its own `prev_publish_time`. Take three
consecutive messages with publish times `t1 < t2 < t3`, and an expiry `T` with
`t1 < T <= t2`.

- `m2` satisfies the predicate: `prev = t1 < T` and `publish = t2 >= T`. ✓
- `m3` does not: `prev = t2`, and the predicate needs `t2 < T`, but `T <= t2`. ✗

So a cranker who skips `m2` and posts `m3` does not settle the shot on a price
of their choosing. The program refuses `m3` and the shot voids. **The set of
messages that can settle a given shot has exactly one member.** That is the
source-predecessor fix (blocker 1) doing the work, and it is why "missed
crossing" is not a separate hazard from "withheld crossing": both produce a
refund, neither produces a wrong number.

---

## What is actually archived, for free, already

The program never needs to answer "what was the price at T". It needs a settled
shot to be *checkable* afterwards by a stranger. Ruleset 2 made that possible
without any archive of Pyth's accounts, because the shot now carries every
number the settlement used:

```
exit_e12                the price it settled on
exit_conf_e12           the confidence that print carried
exit_publish_time       the print's own timestamp
exit_prev_publish_time  the predecessor Pyth signed into it
exit_posted_slot        the Solana slot the print was posted in
```

The last one is the pointer. Solana's ledger is an archive — a real one, kept by
Solana, at no cost to us — and `exit_posted_slot` says exactly where in it to
look. A verifier with any archival RPC can fetch that block, find the Pyth push
transaction, and confirm that the message the program read is the message Pyth
published. The sponsored account is not an archive; **the transaction that wrote
it is**, and the shot now records which one.

That is the honest reframing: we do not need Pyth's account to remember. We need
our settlement to be locatable in a ledger that already does.

---

## The residual, and a number that measures it

What survives all of the above is one thing, stated without hedging:

> **If nobody captures the crossing print before Pyth's next push overwrites it,
> that shot can never settle. It voids and refunds, and no honest party who saw
> the print can rescue it afterwards.**

The size of that window is Pyth's push cadence for the feed — on a major, under
a second when the market is moving. The defence today is that `checkpoint` is
permissionless and cheap and a runner does it continuously. That is a real
defence and it is also an *unmeasured* one, which is the part worth fixing.

### The proposal: contiguity, counted on chain

`FeedClock` already knows, at every `checkpoint`, whether the incoming message's
signed `prev_publish_time` equals `latest_publish_time` — the publish time of the
last message this clock saw. If they are equal, this clock missed nothing
between the two. If they differ, it missed at least one push.

Two fields, twelve bytes, on the clock:

```rust
pub struct FeedClock {
    // ...
    pub gaps: u32,        // NEW — times an arriving message did not link to ours
    pub observed: u32,    // NEW — messages this clock has accepted, ever
}
```

and one on the shot, written at seal and compared at bind:

```rust
pub struct Shot {
    // ...
    pub gaps_at_seal: u32,   // NEW — the feed clock's gap count when this sealed
}
```

Then `bind_crossing` can state something no amount of prose can:

> **`gaps_at_bind == gaps_at_seal` means this protocol clock observed every
> single Pyth publish for this feed between the moment the shot was sealed and
> the moment its crossing was frozen.** Not "the predicate was satisfied" —
> *nothing was missed*, provably, from data the chain holds.

A shot settled under that condition does not rest on the liveness assumption at
all for its own window. A shot settled with `gaps_at_bind > gaps_at_seal` still
settled on the one message that can settle it (see above), but its clock is
known to have blinked, and anybody can see that it did.

### What this costs

Twelve bytes on a `FeedClock` (one per feed, permanent) and four on a `Shot`
(refunded when the shot closes). One `u32` comparison and one increment per
checkpoint. `Shot` would go from 254 to 258 bytes on chain, about 0.00003 SOL
more rent per open shot, refundable. It is close to free, which is the point:
this is a measurement, and a measurement that costs anything meaningful will be
switched off the first time somebody is in a hurry.

### What it does not prove

- It does not make an uncaptured crossing recoverable. Nothing does, without a
  keyless historical source.
- It does not prove Pyth published what Pyth should have. Pyth publishers,
  Wormhole guardians, the Receiver's governance, and Solana consensus remain
  trust boundaries, as they always have.
- A gap-free clock is a statement about *this* clock, not about the feed. If
  Pyth stops publishing, the clock is contiguous and empty at the same time —
  which is why `observed` is counted alongside `gaps` rather than only the ratio.

### Why this is the better answer than accepting the assumption

The plan's second option was "a narrower rule whose remaining omission
assumption is explicitly accepted and economically defended". Accepting an
assumption is a sentence in a document; it is worth exactly as much as the
reader's trust in the author. Counting it turns the same claim into something a
stranger can check for a specific shot, on chain, without asking us anything —
which is the standard the rest of this system is held to and there is no reason
this one should be exempt.

---

## The order, if this is approved

1. `gaps` and `observed` on `FeedClock`, incremented in `checkpoint`, with a
   host test that a linked message does not increment `gaps` and an unlinked one
   does.
2. `gaps_at_seal` on `Shot`, and `bind_crossing` / `settle` emitting whether the
   window was contiguous. Golden vectors reprinted; ruleset stays 2 if nothing a
   player is paid by moves, and `test_core_vectors.mjs` decides that, not this
   sentence.
3. A LiteSVM test that seals a shot, deliberately skips a push, and proves the
   shot still settles on the one message that can settle it *and* is marked as
   having settled across a gap. Both halves, or the field means nothing.
4. Surface it: the record page and the shot page show "clock contiguous" or "1
   push missed in this window", because a measurement nobody can see is a
   measurement nobody checks.
5. Revisit the archival-challenge path **only** if a keyless historical endpoint
   exists. Re-run the three probes in the table above before believing any
   documentation page that says one does.
