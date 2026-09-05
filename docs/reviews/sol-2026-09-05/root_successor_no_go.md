# ROOT_SUCCESSOR source audit — NO-GO

**Date:** 2026-09-05  
**Scope:** public-format and source audit only; no transaction, deployment, key access, or artifact execution  
**Decision:** `ROOT_SUCCESSOR` is not a valid certificate of the first per-feed update after `T`.

## Reviewed claim

Candidate HEAD was `fcaab92694eb894a4771e803b6998ab2a63ef779`. The reviewed
model is [`adapter4.mjs`](../fable-2026-09-05/v3-rule/adapter4.mjs), SHA-256
`5613cb7096d5416cace050725bbb26144bab0e3a870ee3c03ccac74e4dcc741b`.

The model proposes adjacent attested roots at lines 8–11. Its validator checks only
the two root timestamps and membership in the second root at lines 33–34. The
required invariant is introduced synthetically at line 89, where `rootsFrom`
copies every feed's last-known leaf into every root. No audited Pyth wire field or
verifier check establishes that invariant.

The uncertified fallback is also not a canonical payout rule: lines 15–16 admit a
minimum over submitted messages, lines 61–64 accept/replace that candidate, and
line 72 finalizes it. A submitter can change the observed set and therefore the
winner. If no valid strong certificate arrives, the deterministic terminal must be
`VOID/REFUND`, not an uncertified payout.

## Exact source findings

The Pyth sources below are pinned to `pyth-crosschain`
[`859113ec53e59a3abaeeb3333ae71ef1fa09615e`](https://github.com/pyth-network/pyth-crosschain/tree/859113ec53e59a3abaeeb3333ae71ef1fa09615e)
and `pyth-client`
[`acba47ff1879ed1150b02bb502ec74eb766a934e`](https://github.com/pyth-network/pyth-client/tree/acba47ff1879ed1150b02bb502ec74eb766a934e).

1. [`PriceFeedMessage`](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/messages.rs#L84-L106)
   carries feed-local `publish_time` and `prev_publish_time`. Lines 92–103 define
   the intended bracket, then explicitly warn that Pythnet updates may not be sent
   cross-chain and that equal publish times can occur. This is already a documented
   source-to-broadcast gap.
2. [`AccumulatorUpdateData` and `WormholeMerkleRoot`](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/wire.rs#L38-L126)
   commit a VAA plus membership updates; the signed root payload is only
   `{slot, ring_size, root}` at lines 121–126. It has no feed roster, roster hash,
   leaf count, completeness bitmap, per-feed sequence, or source watermark.
   `ring_size` is retention metadata, not the number of leaves.
3. Hermes receives [`AccumulatorMessages`](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/apps/hermes/server/src/state/aggregate.rs#L136-L153)
   as `{magic, slot, ring_size, raw_messages}`. It constructs states for exactly
   those supplied messages at [lines 471–502](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/apps/hermes/server/src/state/aggregate.rs#L471-L502);
   it does not synthesize absent feeds or compare against a canonical roster.
4. Hermes' official test generator constructs a tree from an arbitrary
   `Vec<Message>` at [lines 591–634](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/apps/hermes/server/src/state/aggregate.rs#L591-L634),
   and `test_store_works` accepts a one-feed root at
   [lines 664–684](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/apps/hermes/server/src/state/aggregate.rs#L664-L684).
5. Hermes' Merkle verifier rebuilds a tree solely from `raw_messages`, compares the
   root, and produces membership paths at
   [`wormhole_merkle.rs` lines 64–89](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/apps/hermes/server/src/state/aggregate/wormhole_merkle.rs#L64-L89).
   The generic tree check is membership-only at
   [`merkle.rs` lines 71–78](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/accumulators/merkle.rs#L71-L78).
   Construction accepts an arbitrary list, including duplicates, at lines
   [106–142](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/accumulators/merkle.rs#L106-L142),
   and sorted child hashes at
   [180–185](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/accumulators/merkle.rs#L180-L185)
   do not provide an ordered non-membership proof. The test comment at lines
   [291–296](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/pythnet_sdk/src/accumulators/merkle.rs#L291-L296)
   explicitly permits targeting a subset of accounts.
6. The oracle's accumulator accounts are optional at
   [`upd_price.rs` lines 82–99](https://github.com/pyth-network/pyth-client/blob/acba47ff1879ed1150b02bb502ec74eb766a934e/program/rust/src/processor/upd_price.rs#L82-L99).
   Lines [190–220](https://github.com/pyth-network/pyth-client/blob/acba47ff1879ed1150b02bb502ec74eb766a934e/program/rust/src/processor/upd_price.rs#L190-L220)
   describe and implement delayed/conditional message sending while publishers
   migrate. An aggregate can therefore exist before its cross-chain message does.
7. Message Buffer writes only as many caller-supplied messages as fit. The instruction
   logs a short write but still returns `Ok(())` at
   [`put_all.rs` lines 22–26](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/message_buffer/programs/message_buffer/src/instructions/put_all.rs#L22-L26).
   Capacity exits are in
   [`message_buffer.rs` lines 86–110](https://github.com/pyth-network/pyth-crosschain/blob/859113ec53e59a3abaeeb3333ae71ef1fa09615e/pythnet/message_buffer/programs/message_buffer/src/state/message_buffer.rs#L86-L110),
   with truncation tested from line 215.
8. Wormhole pins a VAA by `(emitter_chain, emitter_address, sequence)` and defines
   sequence as the number of messages published by that emitter. Its timestamp is
   the emitter-chain block timestamp, not a Pyth feed publish time. See the pinned
   [VAA format lines 15–41](https://github.com/wormhole-foundation/wormhole-docs/blob/e84e8aaa15491d45d285d39baea264f77f6b2732/docs/protocol/infrastructure/vaas.md#L15-L41).
   Consequently, adjacent sequence numbers prove only that there is no intervening
   *emitted Wormhole message* from that emitter, subject to finality. They say
   nothing about source updates that never reached emission.

The legacy [Pyth whitepaper v2](https://pyth.network/whitepaper), section 2 on
PDF page 3, describes roots over feeds updated in a slot. A newer descriptive
[pre-upgrade page](https://docs.pyth.network/price-feeds/core/how-pyth-works/cross-chain)
says “all the prices” and one root per slot. The executable/public verifier accepts
subsets and has no completeness field, so that prose cannot be used as an on-chain
non-omission certificate.

Since 2026-08-26, the upgraded
[Pyth Core architecture](https://docs.pyth.network/price-feeds/core/upgrade/how-it-works)
describes five routers calculating “all price feeds” each tick with a 3-of-5 quorum.
That is a different signer architecture from two Full Wormhole VAAs. The public
consumer proof described there still verifies quorum plus the requested membership;
it does not expose a signed roster/completeness proof. Operational all-feed behavior
must not be imported into this legacy adapter as a cryptographic invariant.

## Minimal counterexample

1. The trusted emitter publishes root VAA `V[n-1]` before `T`.
2. The canonical SOL feed produces update `U1` after `T`, but the optional send path
   does not trigger, or the supplied/buffered message list omits or truncates `U1`.
   No Wormhole message is emitted for `U1`.
3. The next emitted root VAA is `V[n]`; it includes a later SOL update `U2` and a
   valid membership path.
4. `V[n-1]` and `V[n]` have adjacent sequence numbers, their block timestamps can
   bracket `T`, and membership for `U2` succeeds. The proposed validator therefore
   certifies `U2`, although `U1` was the actual first SOL update after `T`.

The omission occurs before Wormhole emission, so sequence adjacency cannot detect it.
Requiring `U2.prev_publish_time < T <= U2.publish_time` is the separate predecessor
certificate already modeled by adapter 4; it does not make ROOT_SUCCESSOR valid.
It can also legitimately produce no certificate under the documented source-to-
broadcast gap, which must resolve to permissionless `VOID/REFUND` at a fixed deadline.

## Reopening condition

`ROOT_SUCCESSOR` may be reconsidered only if the accepted, signed, on-chain-verifiable
format adds all of the following:

- an epoch/version-bound canonical feed-roster commitment and exact leaf count;
- exactly one leaf per active feed per signed tick, including deterministic
  status-bearing carry-forward when no new price exists;
- a signed one-to-one binding between adjacent root sequence values and consecutive
  canonical source ticks, with feed timestamps distinct from transport timestamps;
- either membership for both feed states bracketing `T` or a signed per-feed sequence /
  predecessor-hash chain that closes every intermediate update; and
- deterministic conflict handling: exact duplicates are no-ops, distinct equally
  ranked facts are `AMBIGUOUS/VOID`, and silence reaches `VOID/REFUND` permissionlessly.

Until those fields are present and checked by the deployed verifier, keep
ROOT_SUCCESSOR synthetic/research-only and exclude it from canonical payout rules.

## Source receipts

| Source | Bytes | SHA-256 |
|---|---:|---|
| `pyth-crosschain/.../messages.rs` | 8,783 | `859f315c9474e694dc5ddb04d1900c5bae8b115a347c4e59746123245cbabc2a` |
| `pyth-crosschain/.../wire.rs` | 24,216 | `1588ca1d38b4bb3c5bf9136badd1b72e76fd34cef333852c94168118b8326914` |
| `pyth-crosschain/.../aggregate.rs` | 42,091 | `1123074995309c72926d1b0150022c2e70223f7e6ef5fd0d53ad0a11cd173c20` |
| `pyth-crosschain/.../wormhole_merkle.rs` | 7,701 | `6e25cf10d41d34548b969cb7ec29b85b41f668046c6e2854c272df0c5744fad6` |
| `pyth-crosschain/.../merkle.rs` | 17,255 | `e92e4181f7e0dbf035e1b277b2c2d62791ff95fad522cb2026d3b9f4e311b629` |
| `pyth-crosschain/.../put_all.rs` | 1,378 | `1c5d077b3a95a3e02240672215698f5143515e5264e76f86c4800a65e0c79d26` |
| `pyth-crosschain/.../message_buffer.rs` | 16,705 | `fb389c581153593dbe43c83f565909d92245f05941dd6491e9bf83ae7021003b` |
| `pyth-client/.../upd_price.rs` | 15,484 | `740fcd08fcc232da0da35ab7b38b1b7f683f27bb10f1fb4e9a4d83ce8f6644ed` |
| `wormhole-docs/.../vaas.md` at `e84e8aaa15491d45d285d39baea264f77f6b2732` | 14,559 | `0b6210e1d14cdd3b23f0219fa7f67328b3ca6242db84ec0bee228f18dab27e73` |
