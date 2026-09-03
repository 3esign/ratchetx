# RCX Timepin v1 protocol sketch

Status: executable prototype specification, no value, not deployed.

## Canonical identity

One Need exists per tuple:

```text
(schema_version=1,
 oracle_domain=PYTH_PUSH_ORACLE_ID,
 feed_id[32],
 target_unix_seconds)
```

Its PDA is derived under the Timepin program from these seeds, in order:

```text
"need"
u16_le(1)
PYTH_PUSH_ORACLE_ID bytes
feed_id bytes
i64_le(target_unix_seconds)
```

No opener, sponsor, application, player, or mutable config participates in
the identity. Different applications asking for the same evidence share the
same permanent account.

## Opening bounds

- The Need must be opened at least 30 seconds before the target.
- The target may be at most 7 days ahead.
- Targets are aligned to a 5-second UTC grid. This reduces duplicate public
  evidence accounts; a different grid requires a new schema version.
- The common capture/challenge deadline is exactly target + 180 seconds.
- All timestamp arithmetic is checked.

## Accepted source

`capture` accepts exactly one source family:

1. account owner equals pinned Pyth Receiver `PriceUpdateV2` owner;
2. account address equals the sponsored shard-0 PDA derived from
   `(u16_le(0), feed_id)` under the pinned Pyth Push Oracle program;
3. `write_authority` equals that same sponsored PDA;
4. verification level is exactly `Full`;
5. message feed equals the Need feed;
6. signed interval strictly satisfies
   `prev_publish_time < target <= publish_time`;
7. price and confidence are positive, exponent is in `[-18, 18]`, and
   confidence is no wider than the positive price;
8. Pyth `posted_slot` is not in the future and signed `publish_time` is not
   more than 5 seconds ahead of the Solana clock or after the common source
   deadline;
9. account data length and discriminator exactly match pinned
   `PriceUpdateV2` schema v2.

No historical-price API, server, RPC credential, or client assertion enters
this decision.

### Live sponsored-capture boundary

Schema v1 deliberately accepts only the live sponsored shard-0 account. That
account is mutable: a later Pyth push overwrites the earlier
`PriceUpdateV2`. Once overwritten, the earlier message cannot be submitted to
v1 from a separate receiver-owned account because the canonical-address and
`write_authority` checks reject it. The 180-second window is therefore a
submission/challenge deadline, not 180 seconds of source retention.

A `Final` Need proves the narrower fact that exactly one distinct valid
message was submitted while capture was open. It does **not** prove that the
mutable source never held another qualifying message that every caller missed
or withheld. Detecting every ambiguity requires at least one independent
honest watcher to observe and land every relevant source transition before it
is overwritten. No Core G2 or other value-bearing protocol may consume this
prototype until devnet measures that capture boundary and the design either
makes the watcher assumption explicit and acceptable or removes it.

A later schema may consider fully verified historical/ephemeral
`PriceUpdateV2` accounts so an overwritten crossing can still be challenged.
That path must first prove its Pyth Receiver owner, Full verification semantics,
feed and interval rules, and safe treatment of caller-chosen
`write_authority`; it must also remain API-keyless. Schema v1 must not be
silently broadened.

## Permanent evidence

Each evidence record stores the raw feed id, price, confidence, exponent,
publish time, previous publish time, EMA price and EMA confidence. It stores
Pyth posting provenance (`price_update`, `write_authority`, Full marker,
`posted_slot`) separately from Timepin capture provenance (`capturer`,
`capture_slot`, `capture_ts`). `message_hash` is a domain-separated SHA-256 of
the raw Pyth price message only.

There are exactly two permanent evidence slots, not a ring. The second exists
only to prove ambiguity. Records are sorted by `message_hash`, so the evidence
message set has a canonical order. Capture actor/time/slot and terminal
provenance remain truthful to the actual submission history, so complete
account bytes are not claimed to be order-independent. Terminal accounts have
no close instruction in this program version.

## State machine

- `Open`: no accepted crossing evidence.
- First valid capture before the deadline: `Candidate`.
- Re-capturing the same message before the deadline: idempotent no-op.
- A distinct valid crossing before the deadline: immediate terminal
  `Ambiguous`; both full records remain.
- Distinct means distinct raw-message hash, not distinct publish time. A Pyth
  revision with the same signed interval/publish time but a changed raw
  price, confidence, exponent, or EMA is therefore terminal `Ambiguous`.
- At or after the common deadline, anyone changes a sole submitted
  `Candidate` to terminal `Final`. `Final` is finality of the submitted
  set under this state machine, not proof of complete historical observation.
- At or after the common deadline, anyone changes `Open` to terminal
  `Expired`.
- Capture at the exact deadline is rejected; finalize/expire at the exact
  deadline is allowed.
- `Final`, `Ambiguous`, and `Expired` reject every further transition.

Higher-level protocols must treat `Ambiguous` and `Expired` as fail-closed
outcomes (for a game, normally VOID/refund). Timepin itself assigns no game
meaning and moves no value.

## Trust and authority boundary

The message is authenticated through the pinned Pyth Receiver and Push Oracle
programs; their code, upgrade governance, publisher set, Wormhole verification,
and availability remain oracle trust. Solana's Clock and consensus remain chain
trust. Timepin removes a Ratchet operator from the accepted-input rule; it does
not remove those external authorities or guarantee that a transaction will be
landed.

This source tree has no admin instruction, but deployment upgrade authority is
outside program source. Until a separately reviewed deployment is made
immutable, no deployed instance may be described as permanently immutable.
There is no deployment or freeze in this slice.

## Deliberate omissions

RCX vouchers/bounties, Core G2 settlement, economic accounting, clients,
indexers, deployment, and authority handling are later gated slices. Keeping
them out makes this account an independently testable evidence primitive.
The live-capture completeness question above is an explicit blocker for Core G2
or any value path, not work delegated to those later slices.

## Deterministic host vector

For the explicitly non-deployment prototype program id in this workspace,
feed id `07` repeated 32 times, and target `1800000000`:

```text
Need PDA: 2MVzFKdx4HCPP75hv297VKj8uHrqhr9Ne75MqyuxLCnQ
bump: 254
message hash for the test record:
672f49696d41304b30d66b687b2c5dfb4ba7ddf7109d3a39535effd10500d038
```

The vector is asserted by the Rust suite. A real program id intentionally
changes the PDA and requires a reviewed vector update before deployment.
