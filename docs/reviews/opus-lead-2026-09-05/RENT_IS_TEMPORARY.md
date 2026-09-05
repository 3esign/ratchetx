# The rent does not have to be permanent — the Need is a buffer, not an archive

**From:** the lead, 2026-09-05. **Supersedes the "out of scope for launch" line in PERMANENT_RENT.md.**
Semir: *no expensive solutions — it should all run on gas and, if needed, mini fees.* He is right, and
3.36 SOL/day is not gas.

## Why the Need can be closed without losing anything

I checked what a `Need` actually holds that nothing else holds. The answer is **nothing**.
Core's `Shot` already copies the whole observation at seal and settle
(`ratchet-core-g2/src/state.rs`):

```
entry_message_hash, entry_timepin_result_hash, entry_price, entry_conf,
entry_exponent, entry_publish_time
exit_message_hash,  exit_timepin_result_hash,  exit_price,  exit_conf,
exit_exponent,  exit_publish_time
```

Price, confidence, exponent, publish time, the Pyth message hash, **and Timepin's own terminal result
hash** — all of it, permanently, per shot. And `Shot` itself already closes and refunds
(`close = rent_refund`, six sites in `lib.rs`).

So Timepin's Need is a **buffer between an ephemeral Pyth account and a later settlement**, which is
exactly why it must exist — the sponsored account is overwritten every ~5 s and settlement cannot be
in that window. It is not an archive. Once every shot that references it has settled, it holds no
fact that is not already committed in a Shot that outlives it.

**"No close" is therefore protecting nothing here.** It is a correct instinct applied one account too
far: evidence must be permanent, and the evidence *is* permanent — in Core.

## The change, and why a counter rather than a timer

Add to `TimepinNeedV2`:

```rust
pub open_refs: u32,      // shots that still need this Need
pub rent_payer: Pubkey,  // who funded it
```

- `open_need` sets `rent_payer` and `open_refs = 0`.
- Core increments on seal (it already touches the Need), decrements on every terminal transition —
  settle, void, expire, forfeit.
- `close_need` is permissionless and requires `state` terminal **and** `open_refs == 0`; it refunds
  the full rent to `rent_payer`.

**Not a timer.** A time-based close ("anyone may close 24 h after capture_deadline") re-creates the
reveal-budget defect: a slow crank would destroy a player's shot by closing the Need out from under
it. The counter is deterministic and depends on nobody's speed — same principle as setting the reveal
deadline at settlement.

## What it costs and what it returns

| | today | with close |
| --- | --- | --- |
| per target, 1-minute grid | 0.00233 SOL locked forever | 0.00233 SOL locked for minutes, then returned |
| per day | **3.36 SOL, permanent** | **~0 net** — a working-capital float, not a cost |
| per year | 1,225 SOL | 0 |

What remains is transaction fees: gas, plus whatever mini fee the ruleset charges. That is the shape
Semir asked for and it is reachable with two fields and one instruction.

## Sequence

This is small, and it belongs **before** the economy is registered, not after — `register_economy`
cannot be edited, and a launch made without it locks 1,225 SOL a year into accounts nobody will read.
It is the same size as the inline-observation change and touches the same struct, so **do them in one
pass**: Opus A is already rewriting `TimepinNeedV2` for the inline observation, and this is two more
fields in the struct he has open.
