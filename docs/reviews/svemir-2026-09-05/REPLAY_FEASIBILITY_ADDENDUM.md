# Replay feasibility — actual recovered mainnet proof, 2026-09-05

The proposed public-ledger recovery path has passed **byte reconstruction, Merkle membership, and verification of each included VAA signature for one real SOL update**. It has not yet passed a devnet receiver replay or the proposed Timepin challenge adapter. No Hermes API key, subscription, account funding, or transaction submission was used.

Successful finalized transaction:
`3jsTusGSZXNo7J42JHsmXfR7ehW9wQoEwTYNHoBXiJZxAUxmVxKwiSWeRCLts78oWSDow9616xwT2HWxWZM4Qm1Q`, slot444408680.

Recovered from public `getSignaturesForAddress` and `getTransaction` calls:

- Canonical SOL account `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`.
- Successful Wormhole `WriteEncodedVaa` and `VerifyEncodedVaaV1`, then `pyt2` `UpdatePriceFeed`, then inner `rec2` `PostUpdate`.
- Encoded VAA account `3ABTvgurA1xeQGYFr5NyRunuWo9jtcsfakcHBHuwjFAr` was already closed by the subsequent read. Its bytes were recovered from two successful writes: offset0/length1 and offset1/length291, with complete coverage and no conflicting writes. No live VAA account or pusher authority was needed to obtain the data.
- VAA292B SHA256 `e9d6e738054d6cf4d68e9fb893444ee72bb68909b98948ff5bf4587e8c001261`.
- Receiver post-update342B SHA256 `806f03ccb44c8f27dff6eb2914628b4c3c99187378f2a400793b10aa254c9015`:85B SOL price message,12-node Merkle path, treasury32.
- SOL price10187664638, exponent-8, confidence1204885, publish1788576472, previous1788576471. This particular recovered print has publish modulo5=2 and a1-second predecessor gap; it does not establish a whole-feed cadence.

Offline verification on the laptop used the project's existing noble crypto libraries; nothing was installed. The Keccak160 Merkle root recomputed exactly as Pyth's source specifies: `14f5e55ff08585e8c11319cacafce7c5577f3c97`. A changed message fails that proof. All3 included VAA signatures recover and verify against indexes0,1,2 of canonical guardian-set1; the guardian PDA, owner, discriminator and raw bytes were checked against two independent public endpoints. The set contains5 keys. **The meaning of the deployed HDw2 quorum, its generation pin, and devnet guardian compatibility remain explicitly unverified**;3 valid signatures alone must not be labeled a complete receiver replay acceptance.

Artifacts: `replay-probe/reconstructed-vaa.bin`, `reconstructed-post-update.bin`, `replay-reconstruction.json`, `replay-transactions.json`, `replay-proof-accounts-{0,1}.json`, native `REPLAY_CRYPTO_VERIFICATION.json`. Reproduction scripts: `reconstruct-replay.cjs`, `verify-reconstructed-replay.cjs`. The proof file is copied from successful observed instruction data; a replay must create fresh permitted accounts/signers and must never reuse the pusher's authority.

## Corrections and design boundaries sent to Sol

The user is right that strict first-crossing only removes choice among different accepted prices. If all useful capturers abstain and expiry refunds a losing shot, the silence/refund option remains. That residual existed before the proposed relaxed adapter.

Ledger recovery materially improves evidence availability for prints actually submitted to Solana. It does not make public RPC a permanent archival guarantee: the protocol must tolerate null/pruned/history-disabled/rate-limited responses, and preserve retrieved signed bytes for replay. [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction) and [getFirstAvailableBlock](https://solana.com/docs/rpc/http/getfirstavailableblock) describe endpoint availability, not indefinite free storage.

An arbitrary Full receiver account authenticates the message, not its prior appearance on the sponsored PDA. If the adapter accepts any such account, its candidate universe includes valid Pyth messages that were never pushed there. Specify global Pyth-first versus sponsored-first precisely; the on-chain program cannot infer ledger membership from receiver ownership alone. A minimum over replayed candidates remains dependent on an effective timely challenger, including access to the earlier eligible proof.

`posted_slot` is set to the current Solana slot by receiver `post_price_update_from_vaa` on every repost ([receiver source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-solana-receiver/src/lib.rs)). It is not the original authenticated publication slot. Distinct messages with the same publish time must trigger the specified conflict handling before a slot tie-break; duplicate message replay must not earn repeated bounties.

Do not promise a5-second bound from two cranks: simultaneous outage/censorship/slow inclusion can miss several intervals. Fifteen minutes measured from T is not fifteen minutes after a late first capture. Resetting the deadline on every replacement permits delay griefing. Rules must fix those boundaries before admission.

A longer finalization lag interacts with observed-entry age: a Ruleset whose maxEntryAge is below that lag cannot admit the freshly finalized entry. For example,300-second age versus900-second finalization needs explicit redesign/reconfiguration. Check reveal deadlines, horizon, score day and locked capital too.

New CHALLENGE_WIN receipts are not a trivial extra label: current Timepin WorkPage cap2 and FIRST_CAPTURE/TERMINALIZE dispositions are part of the interface. Paying each descending timestamp rewards self-staged challenges unless amounts/count are bounded. A final winning observation reward paid once is a candidate design to assess, not an implemented decision.

Next owner actions: Sol confirms receiver/Wormhole replay and devnet prerequisites; Svemir supplies real seven-feed cadence/coverage and only computes horizon reversal statistics where sufficient entry history exists; Astra reviews the proposed challenge state machine and its adversarial tests. The original S2 artifact is not approved for mainnet while this design gate is open.

Honest verdict: real mainnet proof recovery and component cryptography checked; one-feed/one-update evidence; deployed quorum, devnet replay, challenge program and economic security not yet proven.
