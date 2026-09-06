# RatchetX devnet checkpoint

As of 2026-09-06T00:31:05.641Z. Current owner goal: finish the complete game on DEVNET, then finish the website. Mainnet spending remains deferred.

## Funding is resolved

The only deployment payer is wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz. Semir sent two faucet transfers of 5 devnet SOL, and those funds have already paid for both program deployments and the test setup. Latest public RPC balance: 2.916863840 devnet SOL. No additional funding or repeat address confirmation is needed for this work. The earlier9R address is superseded.

## Completed and checked

- Canonical builds and strict B1 PASS: Timepin14/14 and Core16/16 exact-SBF tests; current artifact/source identity binding.
- Core ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL and Timepin C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp deployed on DEVNET. Independent finalized full-byte/loader/authority/capacity and successful deployment-transaction verification PASS. Commit88344a1.
- Five actual setup transactions passed simulation, confirmed and decoded account readbacks: register_evidence_spec, register_economy, register_ruleset, claim_legacy, open_history_page. The dedicated player has10000 test credits,0XP, nonce0,open0. A restart dry run verified the existing five accounts and preserved the original signatures without sending again.
- Independent finalized bootstrap verification PASS: all five raw accounts and compiled signed transaction messages match; ledger has10000 credits/legacy credits, all other counters0; empty118-byte history; Shot absent. Evidence: docs/receipts/g2-devnet-bootstrap-independent.json.
- Prepared test economy fc48abc784516fa5cd30a4b4220ef2adbf4d079b9bfad72e75830737fedd61c4 binds all49 approved policies. It is separate from production snapshot claims; its sole claim leaf authorizes the dedicated test payer.

## Remaining, with one owner per lane

- CodexAstra: actual L1/L2 execution, timed Needs/seal, concurrent entry+exit capture, finalization/activation/settlement/reveal and public chain receipts. tools/g2-devnet-bootstrap.mjs preparation is exercised; tools/g2-devnet-play.mjs execution adapter is being completed. No timed Needs or Shot has been opened yet. Preserve grid300, lag299 and grace900; observe both targets concurrently.
- Astra2 + Gemini: browser wallet/controller and complete website interaction/display/proof/save flow. lib/g2/player-actions.mjs is committed; browser-game.mjs and shot-view files still need their scoped final commits. Use the actual prepared public configuration, not invented program/economy IDs. A browser-selected wallet is a player identity, not a new deployment funding destination; connect can discover it when user play is tested. Never expose the deployment private key to a page to avoid asking for another address.
- Lead: production migration/root handoff, reusing onchain/ratchet-core-g2/legacy-snapshot.mjs and reconciled source data. The older V1 Merkle tree is not a G2 proof. This lane does not block the existing one-wallet devnet rehearsal and must not overwrite its prepared immutable economy or private restart state.

## Evidence

- docs/receipts/g2-build-artifacts.json and b1-strict-windows-20260906.json
- docs/receipts/g2-devnet-deployment-20260906.json and g2-devnet-independent-readback-20260906.json
- docs/receipts/g2-devnet-bootstrap.json: actual hashes, account addresses, generation, test claim and five signatures
- docs/receipts/g2-devnet-sol-source-20260906.json: one authenticated live SOL-source observation

The complete game and website are not yet certified. Deployment signatures are not gameplay signatures. Latest full gate checked18/21: B3 pending scoped website-file commits; L1/L2 pending actual game transactions. Update this checkpoint from evidence when those steps land, not from a plan or a model test.
