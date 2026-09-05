# Claim incident: finalized mainnet truth

Observed 2026-09-04 23:52:29 UTC. Astra. Read-only; no wallet, key, signing or transaction submission.

Canonical Core G2: cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN
Canonical Timepin: C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp

Both providers returned mainnet-beta genesis 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d.

| Observation | api.mainnet-beta.solana.com | solana-rpc.publicnode.com |
|---|---|---|
| Core account, finalized | HTTP200, value null, slot444375202 | HTTP200, value null, slot444375197 |
| Timepin C8 account, finalized | HTTP200, value null, slot444375206 | HTTP200, value null, slot444375201 |
| Core-owned Economy accounts, exact415B | HTTP200, empty array, slot444375204 | HTTP403: indexed requests require personal token; NOT absence proof |
| Core-owned Ruleset accounts, exact206B | HTTP200, empty array, slot444375205 | HTTP403: indexed requests require personal token; NOT absence proof |

Core source layout: client-v2.mjs ACCOUNT_SIZE Economy415 / Ruleset206. The finalized exact-size account lists contain no Core G2 Economy carrying a legacy root/totals and no Ruleset. Core itself does not exist at the observed slots. Thus this canonical G2 generation has no currently executable on-chain claim path and no demonstrated registered migration root. These observations support public wording: migration/claim is not available; no wallet action is required.

## Historical address references are not deployments

getSignaturesForAddress returns historical references. We fetched the latest finalized transaction at slot443901900: [transaction](https://explorer.solana.com/tx/upJGeQWsimqwo31GEvG7m2EeypNxtQBgv5LcApMMThiLFnrv54PmjnJj9hXqSaRUYT66tYGQJmNRSUDp1Kmi9EC). It invokes ComputeBudget and SPL1tbArHvxokYoGV1C3JP38aHrMaftn9qGdpv4RKhS, does not invoke Core or the upgradeable loader, and the Core address has zero pre/post lamports. It is NOT evidence of a Core deployment or claim. Do not infer either deployment or an all-time absence merely from signatures.

## Reproducible evidence

- incident-mainnet-truth.json sha256 ac53cd14b1699e5f32ce4b8289f91972967e019f08bef5abec45368ec1438ac6 contains request parameters, endpoints, UTC times, HTTP status, raw-response hashes and results.
- incident-core-latest-transaction.json sha256 7762091f9519dfb72b2c1a863ecf4b13ae701d73f30256e42eaa5676ad7a0060 contains the fetched latest address reference.
- Full individual response envelopes remain in D:/Svemir/data/brain/scratch/ratchetx-mainnet-20260905/incident-mainnet.
- RPC semantics: [getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo) returns null for an absent account at requested commitment; [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts) enumerates matching program-owned accounts.

## Honest verdict

Checked: actual finalized mainnet RPC on two providers, genesis, Core/C8 absence, exact-layout Economy/Ruleset enumeration on the official RPC, and one historical transaction. Concluded: no available canonical G2 claim at the observed slots. Not checked: every historical transaction, another generation/program identity, live HTML/script/caching/wallet safety (Sol/Fable own that), any migration deployment or user claim execution. Publicnode indexing was unavailable and is not counted as a second account-list proof. No release source or site deployment was changed by Astra.
