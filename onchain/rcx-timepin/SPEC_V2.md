# RCX Timepin schema 2: multi-cadence evidence network

Status: design specification plus a complete local no-value Rust/SBF/LiteSVM
lifecycle. No deployment, generated client/IDL, value path, release program id
or freeze is implied.
Recorded: 2026-09-03.

Schema 1 remains preserved in `SPEC.md` as the 180-second no-value prototype.
Schema 2 is a new identity. It must not reinterpret an existing Need account.

## Product purpose

Solana is the canonical economic database, but that does not mean copying every
server row or every oracle tick into a new account. Clients recompute boards,
history, leaderboards, aggregates and feed health from public state. Timepin
materializes only the boundary fact that cannot be recomputed later because a
valid mutable oracle account will be overwritten:

```text
(evidence policy, feed, target) -> authenticated source crossing or terminal absence
```

One target is shared by every shot and every application using the exact same
policy. This is the data-network effect: derive most views, pin one irreversible
fact, and never create a private copy per consumer.

## Canonical identities

An immutable EvidenceSpec account is addressed by:

```text
PDA("evidence_spec", u16_le(2), evidence_spec_hash)
```

where:

```text
evidence_spec_hash = sha256("rcx-timepin:evidence-spec:v2\0" || canonical_spec_bytes)
```

A Need is addressed by:

```text
PDA("need", u16_le(2), evidence_spec_hash[32], i64_le(target_ts))
```

No opener, player, sponsor, application, bounty, board or mutable configuration
participates in either identity. If any accepted-source policy field changes,
the canonical bytes and hash change and therefore the Need address changes.
This prevents a first opener from griefing later consumers with a shorter
deadline or weaker source rule.

All string-like domains are fixed numeric enums or 32-byte public keys. Integer
encoding is little-endian. Canonical bytes contain no JSON, floating point, map
iteration order, optional trailing fields or host-language serialization.

The pure model wraps the 134 canonical bytes in a 142-byte EvidenceSpec account
envelope: `sha256("account:EvidenceSpecV2")[0..8]` followed by the canonical
bytes. `openNeed` authenticates its program owner, non-executable flag, exact
length/discriminator, byte-for-byte encoding and derived PDA before using the
policy. The isolated schema-2 Rust register/open build in `../rcx-timepin-v2`
adopts this envelope exactly and proves it with manual-encoding LiteSVM
transactions. The future capture/terminal build must preserve it or replace it
together with new golden vectors; it may not silently reuse this claim for
another layout.

The Need v2 account is also fixed now. Its discriminator is
`sha256("account:TimepinNeedV2")[0..8]`; its 174-byte payload, in order, is:

```text
schema u16 | bump u8 | state u8 | evidence_spec_hash [32]
target_ts i64 | source_deadline_ts i64 | capture_deadline_ts i64
opened_ts i64 | opened_slot u64 | opener Pubkey
candidate_count u8 | next_capture_ordinal u8
candidate_a_hash [32] | candidate_b_hash [32]
```

The complete account is therefore exactly 182 bytes. Full evidence records and
completion receipts are separate deterministic accounts; the pure model's
`records` and `completions` arrays simulate that account bundle and are not
fields serialized inside Need.

## EvidenceSpec v2 fields

The first implementation pins one adapter (`PythPushPriceUpdateV2`) but retains
the adapter byte in identity so a later source cannot be confused with it.
Adapter `1` accepts only the official Pyth Receiver
`rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` and official Push Oracle
`pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou`; arbitrary programs that merely
copy the byte layout are rejected at EvidenceSpec registration.
Canonical bytes contain, in this order:

1. schema version (`u16`, exactly 2);
2. adapter (`u8`);
3. receiver program id (`[u8;32]`);
4. push-oracle program id (`[u8;32]`);
5. shard id (`u16`);
6. feed id (`[u8;32]`);
7. required verification level (`u8`, exactly Full for this adapter);
8. target grid seconds (`u32`);
9. minimum opening lead seconds (`u32`);
10. maximum target-ahead seconds (`u32`);
11. maximum signed pre-target gap seconds (`u32`);
12. maximum post-target publication lag seconds (`u32`);
13. capture grace seconds (`u32`);
14. maximum source-clock future skew seconds (`u16`);
15. minimum and maximum exponent (`i8`, `i8`);
16. maximum confidence-to-absolute-price ratio in basis points (`u32`).

Every duration is finite and nonzero where zero would make the profile
unusable. Checked arithmetic derives all deadlines. Registration rejects an
unknown enum, inverted exponent range, zero grid, lead below the program hard
minimum, target-ahead above the hard maximum, or policy outside compile-time
safety bounds. Permissionless registration does not bypass those bounds.

## Opening and target alignment

`open_need(spec_hash, target_ts)` succeeds only when:

- the EvidenceSpec PDA, owner, discriminator, canonical bytes and hash agree;
- `target_ts` is exactly aligned to `target_grid_seconds`;
- `Clock.unix_timestamp <= target_ts - min_open_lead_seconds`;
- `target_ts - Clock.unix_timestamp <= max_target_ahead_seconds`; and
- the derived Need is absent, or already contains exactly the same identity.

An existing Need is accepted idempotently only after its owner, discriminator,
exact length, schema, spec hash, target, PDA/bump, both recomputed deadlines,
legal state/candidate-count combination and candidate hashes are authenticated.
Changing stored deadlines or state can never extend a window.

The caller supplies no deadline. The program derives:

```text
source_deadline  = target_ts + max_post_target_lag_seconds
capture_deadline = source_deadline + capture_grace_seconds
```

At the exact capture deadline, capture is closed and terminalization is open.
Capture grace extends transaction-submission time only while the exact
authenticated source account bytes remain available. It does not resurrect a
message after the mutable sponsored PDA has been overwritten, and therefore is
not an archival guarantee.

## Accepted Pyth source

`capture` accepts the current source account only when all conditions hold:

1. the authenticated Solana Clock has reached `target_ts`;
2. the entire Need passes the shared integrity validator above;
3. account owner is the pinned Pyth Receiver program;
4. account address is the shard PDA derived from the pinned push-oracle
   program, shard id and feed id;
5. PriceUpdateV2 discriminator and exact supported layout match;
6. write authority equals the same derived source PDA;
7. verification level is exactly Full;
8. message feed id equals the EvidenceSpec feed id;
9. `prev_publish_time < target_ts <= publish_time`;
10. `target_ts - prev_publish_time <= max_pre_target_gap_seconds`;
11. `publish_time - target_ts <= max_post_target_lag_seconds`; 
12. `publish_time <= source_deadline`; 
13. capture transaction time is strictly before `capture_deadline`; 
14. publish time is not more than the allowed future skew ahead of Solana Clock;
15. price is positive, confidence is nonnegative, exponent is in range, and the
    checked integer confidence ratio is within the policy bound;
16. posted slot is not in the future.

No client-decoded price, HTTP response, API key, server assertion, previous
protocol checkpoint or latest-price fallback participates in validity.

## Permanent decision material

Each distinct record retains feed, price, confidence, exponent, publish and
previous publish time, EMA price/confidence, verification marker, source account,
write authority, posted slot, capture slot/time, capturer and a domain-separated
message hash. A transaction signature/slot may locate provenance but is not a
substitute for these bytes: arbitrary historical ledger data is not readable by
a Solana program and is not guaranteed by every public RPC forever.

Records are sorted by message hash for canonical set order. Actor/slot/time
provenance plus a monotonic capture ordinal remains truthful to actual execution
order. The pure model retains every field used by its domain-separated message
hash, so an inspector can recompute it from the permanent record.

The executable schema freezes each record in a separate Candidate account:

```text
PDA("candidate", Need, message_hash[32])

CandidateV2 payload (307 bytes):
schema u16 | bump u8 | need Pubkey | EvidenceRecordV2[272]

EvidenceRecordV2 (272 bytes):
message_hash [32] | feed_id [32] | price i64 | conf u64 | exponent i32
publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64
verification_level u8 | layout_length u16
source_account Pubkey | source_owner Pubkey | write_authority Pubkey
posted_slot u64 | capture_slot u64 | capture_ts i64
capture_ordinal u8 | capturer Pubkey
```

The complete Candidate account is 315 bytes including its discriminator. The
capture ordinal preserves transaction-order provenance while Need stores the two
message hashes in bytewise canonical order.

Every terminal path creates one immutable terminal account:

```text
PDA("timepin", Need)

TerminalTimepinV2 payload (221 bytes):
schema u16 | bump u8 | terminal_kind u8 | need Pubkey
evidence_spec_hash [32] | target_ts i64 | candidate_count u8
candidate_a_hash [32] | candidate_b_hash [32] | result_hash [32]
terminal_slot u64 | terminal_ts i64 | terminal_actor Pubkey
```

The complete terminal account is 229 bytes. Final and Ambiguous result hashes
commit to Need plus the canonical evidence-hash set. Expired commits to Need and
target under a separate domain. Candidate, terminal Timepin and completion
receipt accounts have no edit or close instruction.

## State machine

```text
Open --capture_first(valid)----> Candidate
Candidate --capture_first(same)-> Candidate (idempotent no-op)
Candidate --capture_conflict---> Ambiguous (terminal)
Candidate --finalize(deadline)-> Final (terminal)
Open ------expire(deadline)----> Expired (terminal)
```

- Capture at `capture_deadline` is rejected.
- Finalize/expire at that exact time is allowed.
- A duplicate/no-op never creates a completion receipt or reward entitlement.
- There are exactly two numeric work kinds: `1 = FirstCapture` and
  `2 = Terminalize`. This avoids three mutually exclusive terminal work kinds
  whose unused vouchers could strand.
- Each receipt is the Work Market-compatible PDA
  `PDA("completion", Need, work_kind_u8)` and uses its exact 125-byte
  `CompletionReceipt` schema-1 layout.
- First valid capture writes a payable FirstCapture receipt for its capturer.
  Ambiguous, Final or Expired writes one payable Terminalize receipt for the
  actor who performed that terminal transition. Expired additionally writes a
  nonpayable FirstCapture receipt with the default worker so a voucher for work
  that never happened refunds instead of paying the expirer or remaining stuck.
- The receipts survive cleanup of transient consumer state.
- Final, Ambiguous and Expired reject all later evidence transitions.
- `Final` means one distinct admissible record was submitted before the
  deadline. It does not prove that the oracle never produced and withheld
  another valid revision.

Higher-level games map Ambiguous/Expired/policy-limit failure to an immutable
named result, normally exact credit VOID/refund. Timepin itself holds no player
funds and assigns no game payout.

## Core G2 consumer patterns

Fast profiles may use observed entry. Seal validates and stores the current Full
entry message and opens or validates a predeclared exit Need.

Slow profiles use future entry:

```text
T0 = ceil((Clock.now + min_open_lead) / target_grid) * target_grid
T1 = T0 + horizon
```

In one seal transaction Core fixes commitment, direction/probability and stake,
then opens or validates both Needs. The Shot becomes PendingEntry and has no
post-entry cancel. `activate_entry` consumes only Final T0 evidence. Settlement
consumes only Final T1 evidence. Horizon is T0 to T1. Entry/exit failure reasons
are explicit and deterministic; Final versus VOID paths are mutually exclusive.

A thousand shots selecting the same spec, grid bucket and horizon reuse the same
T0 and T1 facts. This is the intended cost amortization; a global checkpoint
purse or evicting ring is not.

## Incentives are a separate protocol

Timepin never transfers SOL or RCX during open, capture, finalize or expire.
Canonical completion records the subject, work kind, worker, result and
provenance once. A separate RCX Work
Market may escrow a demand-bound voucher keyed by subject, work kind, asset kind,
sponsor and nonce, then pay that immutable completion in a later claim.

An empty, malformed or depleted voucher can reduce motivation but cannot roll
back Timepin or change its result. Raw feed cadence, duplicates and unrelated
targets earn nothing. RCX uses Token-2022 transfer_checked; optional SOL fee
reimbursement uses System Program transfer CPI. Neither mechanism mints tokens,
uses a global purse, or chooses a recipient administratively.

## Required model and release controls

Before program work carries value, preserve vectors and adversarial tests for:

- canonical byte/hash changes for every policy field;
- fixed-program-id golden PDAs for EvidenceSpec and Need seed order/bump (the
  deployment manifest later substitutes and pins the real program id);
- same policy/target deduplication and different deadline-policy separation;
- future T0 alignment and T1 overflow/alignment;
- 60-second crypto plus candidate 600/870-second stock gap/lag profiles (these
  are test policies, not a publisher cadence or SLA);
- exact bracket and exact deadline boundaries;
- source-at-source-deadline capture during grace, with the explicit requirement
  that the authenticated bytes still exist;
- wrong program owner, source PDA, write authority, shard, feed, discriminator,
  verification level, exponent, confidence, slot and future timestamp;
- literal 134-byte Full `PriceUpdateV2` length plus an independently pinned
  mainnet shard/feed source-PDA vector;
- duplicate, reorder, two distinct revisions, ambiguity and expiry;
- first-opener grief, missed/overwritten source and no latest fallback;
- 1,000 consumers sharing one Need;
- no reward side effect in any Timepin transition;
- durable completion receipts whose identity cannot be redirected by choosing a
  different worker or result;
- clean-machine two-RPC reads and two unrelated devnet capturers.

Schema 2 remains non-production until source, IDL, client, pure model, golden
vectors, exact SBF artifact, LiteSVM tests, devnet full-life report and authority
state all identify the same bytes.
