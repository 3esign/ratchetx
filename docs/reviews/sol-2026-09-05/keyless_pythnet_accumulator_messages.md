# Keyless PythNet AccumulatorMessages replay receipt

Date: 2026-09-05  
Scope: read-only public-network and offline verification; no secret/key material; no Solana write transaction; no release-source edit.

## Verdict

- **GO, operational mainnet primitive:** the live System Program PAS1 ring account can be read without an API key, all raw leaf bytes can be recovered while the slot remains in the ring, the official Keccak160 tree can be rebuilt, and a PNAU membership proof can be constructed and parsed offline. The recorded mainnet slot below matches its guardian-signed AUWV root exactly.
- **GO, raw Pythtest primitive:** an independently selected Pythtest PAS1 slot was read without a key and its complete tree plus a 13-node membership proof were reproduced.
- **NO-GO, real Pythtest-to-Solana-devnet parity:** the raw Pythtest PAS1 root could not be paired with a keyless signed legacy guardian VAA accepted by the current devnet Receiver. Hermes beta returned HTTP 401, the Wormholescan testnet emitter query returned no VAAs, and the current devnet Receiver is configured for the newer Pythnet 3-of-5 router emitter. No synthetic or unsigned PNAU is promoted as evidence.
- This proves **membership**, not root completeness, non-omission, or a unique-successor property. It does not remove the separate Timepin liveness STOP.

## Pinned official implementation

Official checkout:

- Origin: https://github.com/pyth-network/pyth-crosschain.git
- Commit: 859113ec53e59a3abaeeb3333ae71ef1fa09615e
- Checkout status at audit: clean
- Local checkout: D:\Work\Software_Projects\pumpmind\.scratch\pyth-crosschain-source

The live Hermes route is not the old 7Vb message-buffer store:

- apps/hermes/server/src/network/pythnet.rs:118-133 subscribes to System Program accounts with memcmp offset 0 equal to PAS1.
- apps/hermes/server/src/network/pythnet.rs:145-156 Borsh-decodes AccumulatorMessages and authenticates the address as PDA([AccumulatorState, ring_index.to_be_bytes()], SystemProgram).
- apps/hermes/server/src/state/aggregate.rs:149-167 defines the wire account as magic [u8;4], slot u64, ring_size u32, raw_messages Vec<RawMessage>, with ring_index = slot % ring_size.
- pythnet/pythnet_sdk/src/accumulators/merkle.rs:140-167 pads leaves to the next power of two with H(0x02), and builds parents bottom-up.
- pythnet/pythnet_sdk/src/accumulators/merkle.rs:190-206 defines leaf H(0x00 || message), sorted parent H(0x01 || min(left,right) || max(left,right)), and null H(0x02).
- pythnet/pythnet_sdk/src/hashers/keccak256_160.rs:10-28 defines H as the first 20 bytes of Keccak-256.
- pythnet/pythnet_sdk/src/wire.rs:35-89 defines PNAU v1.0 and WormholeMerkle proof framing.
- pythnet/pythnet_sdk/src/wire.rs:100-137 defines AUWV plus Merkle payload {slot, ring_size, root}.
- price_service/sdk/js/src/AccumulatorUpdateData.ts:168-214 is the official JavaScript PNAU parser used for the recorded round trip.

Local checkout byte SHA-256 values (the pinned commit remains the portable identity):

| File | SHA-256 |
| --- | --- |
| apps/hermes/server/src/network/pythnet.rs | e779eb5b3769e3cfbb6c841050a7751d6aa855d1b1b8f8469dae67ec3e3dfc99 |
| apps/hermes/server/src/state/aggregate.rs | e4f7c18cecd34888dc18efae5b3942d299e5d16552aefa47715d5bfac2713e2c |
| pythnet/pythnet_sdk/src/accumulators/merkle.rs | 7711a88c881dc4db8a3771b5f99351e1dadb3712add7917cd979801d52eac37a |
| pythnet/pythnet_sdk/src/hashers/keccak256_160.rs | bc1a05ba8830fb61d878ce562a22a6355904f68db37d1be7a1acb38595232b5d |
| pythnet/pythnet_sdk/src/wire.rs | 8ffefeaa6162e1113d774f517cae34714e9ca0082965476fd28f9c190f62baea |
| pythnet/pythnet_sdk/src/lib.rs | d7243c0a58b831466040ac21e5ba425e2a9b2e9079f249d1c135fedd53de9b21 |

The sparse local checkout does not contain the JavaScript parser. Its pinned Git blob at the same commit is 8380fd9c870f64637bd06a70e7b1b7a5e349c1e0.

## Mainnet keyless replay: independently checked artifact

Public PythNet:

- Endpoint: https://api2.pythnet.pyth.network
- Genesis: GLKkBUr6r72nBtGrtBPJLRqtsh8wXZanX4xfnqKnWwKq
- System Program owner: 11111111111111111111111111111111
- PAS1 slot: 312586654
- Ring size/index: 10000 / 6654
- Derived PDA: 5FkFu69fc9NrZnjAVQfbcBKQWMVZoLvZUfwePR7xHcvb
- Account bytes/messages: 596619 / 6113
- Signed and recomputed root: 7b2fb7cf7c978c099cdfbf3a6c100d25243c8ad8

Guardian VAA decoded from the PNAU:

- VAA version 1; guardian-set index 7
- 13 signatures with strictly listed indices: 0, 1, 2, 4, 5, 6, 7, 8, 10, 13, 16, 17, 18
- Emitter chain 26
- Emitter e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71
- Sequence 227789814
- AUWV payload: variant 0, slot 312586654, ring size 10000, root 7b2fb7cf7c978c099cdfbf3a6c100d25243c8ad8
- VAA length/SHA-256: 952 / f88d77fe04a323165b1244ac8daf0b97185d9df3b8c9e78988073d1f6c027840

Offline PNAU verification:

- Artifact: D:\Work\Software_Projects\pumpmind\.scratch\keyless-replay\price-update.pnau
- Length/SHA-256: 1311 / da647bdd3cf907028b7b538e83b9bfda5be5c7c787e12f64d0eabbe44f1db160
- PNAU v1.0, WormholeMerkle proof type, one update
- Feed: ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
- Price message SHA-256: c60e1ed7910a2abc47658d2f88855f45de3c3968b494abdcbccc2583425ed369
- Publish/previous publish: 1788584128 / 1788584128
- Proof depth/SHA-256 of concatenated nodes: 13 / 9254d2a4f139fd0b96754d8dbefe157b1953c394b20557f240539d397ae7d46b
- Recomputed root: 7b2fb7cf7c978c099cdfbf3a6c100d25243c8ad8 (**exact match**)
- Parser consumed all 1311 bytes with no trailing bytes.

The independent audit parsed the generic Wormhole VAA header/body, the AUWV payload, PNAU framing, message, and proof, then recomputed the leaf and every sorted parent. It did not independently recover guardian public keys and re-run secp256k1 signature recovery; the 13 signature bytes are carried by the public VAA and are content-bound by the VAA SHA-256 above.

The producer receipt is:

- D:\Work\Software_Projects\pumpmind\.scratch\keyless-replay\receipt.json
- SHA-256: 943251e555aea4dc28a69d859fd60ea52569761cb4ee561c0ad5a3959bb53703
- It records 100 VAA/account candidates checked, the full 6113-message rebuild, two reconstructed feed proofs, and official parser round trips.

## Independent second slot: Pythtest raw-account proof

Read at 2026-09-05, with no API key or authentication:

- Endpoint: https://api.pythtest.pyth.network
- Genesis: EkCkB7RWVrgkcpariRpd3pjf7GwiCMZaMHKUpB5Na1Ve
- RPC context slot: 311849903
- PAS1 slot: 311847600
- Ring size/index: 10000 / 7600
- Derived PDA/bump: GLmQ6S8tnM39dgZS8SncF6xAwpeyMjMcMydB4HyWFdQn / 254
- Owner: 11111111111111111111111111111111
- Data length/SHA-256: 561175 / 5f88fb957b6874c32c143a63cc5101633b55fa2b09d8cbfdd0a3248deb1ea7c0
- Raw messages: 5781
- Message lengths: 2890 x 85 bytes, 2890 x 101 bytes, 1 x 491 bytes
- Parser consumed all 561175 bytes; trailing bytes 0
- Recomputed Keccak160 root: e4ab8f56b88cca35cb96675addb3d514052de3a8

Membership proof for raw message index 0:

- Feed: 003fa32d7602c28e7b2496391395b856e66c57f46b239bf91bce3b8eece9ef72
- Publish/previous publish: 1788374654 / 1788374654
- Message SHA-256: 3238e4b41cc6d5c9728e3c189bfac204677aaabcc577acc67628e771c0dba234
- Proof depth/SHA-256 of concatenated nodes: 13 / 99077da02615747028bd11e14364aad3f4ea4538fc2ee0e01e4a4e8ca27522e8
- Offline proof result: **verified**, root e4ab8f56b88cca35cb96675addb3d514052de3a8

No PNAU was emitted for this Pythtest slot because no accepted signed VAA was found for the root. Wrapping the correct leaf proof around an unsigned or unrelated VAA would be a false-positive artifact.

## Testnet/devnet compatibility boundary

Bounded keyless probes at 2026-09-05T05:32:36Z:

- Hermes beta latest update for the Pythtest feed: HTTP 401, body unauthorized.
- Wormholescan testnet query for chain 26 / emitter e101faed... / recent 20: HTTP 200 with an empty data array.
- A larger Solana-devnet transaction scan was stopped at the requested bounded boundary after no quick legacy-PAS1 match; no comprehensive absence claim is made.

Current Solana devnet Receiver boundary (from the independently recorded receiver audit):

- Genesis: EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
- Receiver: rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp
- Receiver config PDA: H3R4M45f2gyqp6geVUruapzZdyxpgGZ96UnWkDM3ndye
- Configured verifier: HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL
- Accepted source chain: 26
- Accepted emitter: 507974686e6574507974686e6574507974686e6574507974686e657450797468 (the newer Pythnet router emitter)
- Minimum signatures: 3

The existing devnet replay receipt proves the modern 3-of-5 route, not legacy PAS1-to-VAA parity:

- D:\Work\Software_Projects\pumpmind\.scratch\replay-devnet\receipts\devnet-full-replay.json
- SHA-256: 07a4cc71dc3c3632bbafdef89c45d3bf908414bea2fc935f544f290607acab61
- A separate 2-of-5 negative receipt has SHA-256 83e5fedfba4a0b7d5f168735a709af68b5389620043949a96b58e8177f7e0e34.

## Why 7Vb is not the live evidence source

The pinned source still declares message-buffer program 7Vbmv1jt4vyuqBZcpYPpnVhrqVe5e6ZPb6JxDcffRHUM, but that account family is a different, per-producer mutable store:

- pythnet/message_buffer/programs/message_buffer/src/lib.rs:15 declares 7Vb.
- Its MessageBuffer has only 255 end offsets.
- put_all overwrites the buffer and is capacity-bound.
- A public PythNet probe saw 3066 7Vb accounts: 3001 empty and 64 nonempty accounts carrying only two messages. It did not expose the live complete-slot leaf set.

Hermes instead subscribes to System-owned PAS1 accounts and authenticates their slot-modulo PDA as shown above.

## Retention and automation contract

The observed live accounts use ring_size 10000. The PDA index is slot modulo 10000, so an address is reused after one full ring. At an assumed 400 ms slot cadence this is roughly 66.7 minutes; that duration is an estimate, not a protocol guarantee.

Standard Solana getAccountInfo reads current account state and has no historical-slot selector. Therefore a keyless collector must archive, before reuse:

1. exact PAS1 account bytes and RPC genesis/context slot;
2. parsed slot, ring size, PDA and PDA bump;
3. ordered raw messages and full account SHA-256;
4. matching signed VAA bytes and VAA tuple;
5. computed root and requested Merkle paths;
6. final PNAU bytes plus SHA-256 and an official-parser round trip.

Automatic STOP conditions:

- genesis mismatch;
- PAS1 magic/schema/trailing bytes mismatch;
- PDA derivation mismatch, wrong owner, or slot/index mismatch;
- account overwritten before its matching VAA is obtained;
- AUWV slot/ring/root differs from the PAS1 account;
- computed root differs from signed root;
- unavailable or unaccepted VAA emitter/guardian route;
- proof/parser does not consume exactly the recorded bytes.

Public availability observed here is an operational fact as of 2026-09-05, not a contractual availability guarantee. A retained content-addressed artifact remains necessary.

## Security scope

Merkle inclusion proves that a message is in the signed root. The official tree accepts duplicate leaves and the root carries no independently enforceable full-feed roster or non-membership proof. Neither this replay nor adjacent VAA sequences prove that a submitted record is the first source update after a target time. See root_successor_no_go.md and Solana skill reference 111 for the separate non-omission/liveness analysis.

