# Blocker 8 — a mutable account is not an archive

Status: **historical proposal, not built, and rejected for the authority-first
successor.** The Hermes measurements and mutable-source warning remain useful.
The `FeedClock`/gap/ring design below is preserved only as archaeology and is
not an implementation instruction.

In the earlier eight-blocker framing, this document was written as the last
blocker and described the other seven as closed. That was the prototype ledger's
historical status, not a current release-completion claim. The earlier plan
reserved two acceptable answers for this source property:

> Core G2 value waits for an audited archival-challenge path **or** a narrower
> rule whose remaining omission assumption is explicitly accepted and
> economically defended.

The current successor direction is explicit: a predeclared shared Need captures
the admissible source crossing into terminal Timepin bytes. Those bytes are the
canonical decision evidence. A posted slot is only a provenance locator, and no
public or archival RPC is assumed to retain historical transactions for free.

---

## The problem, stated precisely

The sponsored Pyth shard-0 PDA holds one `PriceUpdateV2`: the latest. The next
push overwrites the previous bytes in that mutable PDA. Unless somebody already
copied the exact accepted evidence into a persistent account such as a terminal
Timepin, a program cannot recover the prior bytes from that sponsored PDA. It
can use only what was independently captured and pinned before the overwrite.

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
- Choosing a later source interval does not help them, because of the predicate.
  A later chained message cannot substitute for the interval that brackets the
  target. Distinct same-publish-time revisions can still satisfy the same
  interval; Timepin must preserve submitted conflicts as `Ambiguous`, and it
  cannot prove that an unsubmitted revision never existed.
- The write-authority worry — that the caller who posted the update could
  overwrite it between the post and our read — was addressed in ruleset 2 by
  copying values into the `Shot`. The successor applies that immutability at the
  evidence boundary: accepted decision bytes live in the terminal `Timepin`, so
  later mutation of the ingress account is irrelevant.

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
accounts over ordinary RPC, which needs no protocol credential. RPC transport,
rate limits and historical access can still have availability or monetary cost.

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

## What the signed predecessor does and does not prove

This argument proves that skipping to a later chained source interval cannot
substitute a different later price for the target. It does not prove that only
one revision of the qualifying interval ever existed.

Pyth's messages for a feed form a chain: message *n+1* carries, signed, the
`publish_time` of message *n* as its own `prev_publish_time`. Take three
consecutive messages with publish times `t1 < t2 < t3`, and an expiry `T` with
`t1 < T <= t2`.

- `m2` satisfies the predicate: `prev = t1 < T` and `publish = t2 >= T`. ✓
- `m3` does not: `prev = t2`, and the predicate needs `t2 < T`, but `T <= t2`. ✗

So a cranker who skips `m2` and posts `m3` cannot settle on `m3`; the
program refuses it. If no qualifying interval was captured, the Need eventually
becomes permissionlessly expirable and its consumer follows the named VOID rule.
If two distinct Full-valid revisions of the qualifying interval are submitted,
Timepin records `Ambiguous`. If one such revision is withheld, Timepin cannot
prove global nonexistence; that residual oracle/liveness limitation must remain
visible rather than being collapsed into an "exactly one message" claim.

---

## Canonical evidence without a historical-RPC dependency

Ruleset 2 demonstrated the minimum decision fields by copying them into the
Shot:

```
exit_e12                the price it settled on
exit_conf_e12           the confidence that print carried
exit_publish_time       the print's own timestamp
exit_prev_publish_time  the predecessor Pyth signed into it
exit_posted_slot        the Solana slot the print was posted in
```

`exit_posted_slot` is a provenance locator. If a chosen archival RPC retains
the block, a verifier can use it as additional corroboration. Public RPC history
may be pruned or rate-limited, archival access may cost money, and the program
cannot query an arbitrary past transaction. The slot and transaction are
therefore not canonical storage.

The value-bearing successor keeps the complete accepted decision bytes in the
terminal Timepin. Settlement, recovery and verification read that account, not a
promise that some RPC will serve the old block. The mutable Pyth account is live
ingress; the terminal Timepin is the canonical retained evidence.

---

## The residual liveness boundary

What survives all of the above is one thing, stated without hedging:

> **If no admissible qualifying source record reaches the shared Need by its
> sealed capture deadline — whether from the live sponsored PDA or from an
> independently retrievable, fully authenticated copy allowed by the same
> EvidenceSpec — the Need terminalizes `Expired` and its consumer follows the
> deterministic VOID/refund rule. Overwrite of one sponsored-PDA print alone
> does not prove that every admissible copy or revision is unavailable.**

The live-PDA portion of that window is bounded by source cadence; an allowed
authenticated-history route can extend delivery only until the sealed capture
deadline. The authority-first response is to predeclare a shared Need and let
any runner submit admissible evidence. This improves liveness but does not
convert an unavailable, uncaptured or withheld revision into evidence.

## Historical rejected prototype: FeedClock contiguity counters

> **Do not implement this section.** It describes the earlier
> `FeedClock.gaps`/`gaps_at_seal`/ring proposal. The successor does not pay or
> require continuous raw checkpoints and does not use an evicting clock as
> canonical evidence. It uses predeclared shared Needs and terminal Timepins.

### Historical sketch: contiguity counted on a protocol clock

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

The sketch intended `bind_crossing` to report:

> **`gaps_at_bind == gaps_at_seal` means this protocol clock observed every
> single Pyth publish for this feed between the moment the shot was sealed and
> the moment its crossing was frozen.** Not "the predicate was satisfied" —
> *nothing was missed*, provably, from data the chain holds.

Even in the sketch this proved only what that protocol clock observed. It did
not prove global source completeness or exclude an unsubmitted same-interval
revision, and it required continuous unrelated checkpoint traffic.

### Historical cost estimate — invalid for the successor

The rejected layout estimated twelve bytes on a `FeedClock` and four on a
`Shot`, plus one write per checkpoint. Those sizes and rent arithmetic do not
describe the successor's EvidenceSpec, Need, Timepin or voucher accounts and
must not be reused as a current cost claim.

### What it does not prove

- It does not make an uncaptured crossing recoverable. Nothing does, without a
  keyless historical source.
- It does not prove Pyth published what Pyth should have. Pyth publishers,
  Wormhole guardians, the Receiver's governance, and Solana consensus remain
  trust boundaries, as they always have.
- A gap-free clock is a statement about *this* clock, not about the feed. If
  Pyth stops publishing, the clock is contiguous and empty at the same time —
  which is why `observed` is counted alongside `gaps` rather than only the ratio.

### Why the sketch was rejected

The counter could describe a particular clock's capture history, but it required
continuous raw writes, did not preserve the demanded crossing by itself, and did
not remove withheld-revision uncertainty. A shared Need makes the target itself
the unit of work; its terminal Timepin retains the actual decision bytes without
making an evicting ring authoritative.

---

## Historical implementation order — do not execute

The following list is preserved only to explain the abandoned prototype. It is
not approved work and does not close the current Timepin schema-2 gate.

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
