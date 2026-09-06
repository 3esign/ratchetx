# RatchetX devnet checkpoint

As of 2026-09-06T01:24:59.412Z. Owner goal: complete the game and website on DEVNET. Mainnet spending remains deferred.

## Funding is resolved

The confirmed deployment payer is wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz. The owner's two faucet transfers of 5 devnet SOL funded both programs and the first complete game. Independent finalized balance after the game: **2.908330240 devnet SOL**, slot 493820764. No additional funds or repeat address confirmation is needed for this work.

## Complete: deployed pair and first full game

- Canonical source-bound build/B1 PASS: Timepin 14/14 and Core 16/16 exact-SBF tests, zero ignored/filtered. Both deployed ELF payloads independently matched the accepted artifacts byte for byte. Deployment commit 88344a1; preparation commit 6aa1537.
- Core ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL and Timepin C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp are deployed on devnet. Authority was retained; no mainnet spend or freeze occurred.
- **15 actual setup/game transactions completed**: registrations/claim/history, both timed Needs, seal, both captures, both finalizations, activation, settlement and reveal. The executor exited successfully. Approved grid 300, lag 299 and grace 900 were preserved.
- Outcome **MISS**: the sealed prediction was UP; authenticated entry 103.33275188 and exit 103.32500025. Final player state: **9900 credits, 1 XP, 0 locked credits, 0 reserved credits/XP, 0 open games**, one scored shot, zero hits, Brier 36000000. Shot closed and the archive/history root verified.
- Independent finalized verification PASS at 2026-09-06T01:21:50.931Z: native Ed25519 verification of eight lifecycle transactions, both selected Candidate preimages and Need terminalization events, exact game/row/history hashes, full ledger counters and closed Shot. The public proof retains raw accounts/transactions and RPC provenance.
- [Final reveal transaction](https://explorer.solana.com/tx/41SRjy1VzX81YtsjeDmuGLpdtYUpN3cAzE2oNGx5KVExwRmj2ovG1Xw3sj1wmvLvKLYb6egYxjYnukbY224YAFmU?cluster=devnet). The browser must use this terminal signature to read the archive; settleSignature is not terminal.

**Delivered in commit 2b00fc4** (15 owned files). The post-commit gate at 2026-09-06T01:26:23.586Z passed **21/21**, exit 0. Exact output: docs/receipts/g2-devnet-final-gate-20260906.json. This used existing source-bound runtime evidence and did not rerun Cargo.

## Evidence and reviewed code

- docs/receipts/g2-devnet-first-shot-nonce0-20260906.json — fixed first-game receipt, SHA256 dd7cd31c8d110d4ea8ec6b15a452e6dc18b3a32adee4aabe4b025870514d059b.
- docs/receipts/g2-devnet-terminal-independent-20260906.json — independent finalized proof, SHA256 6af7cfeb364c8b22b370cdfc706224db15911d2fc72309a1c17acdc912574b7d.
- docs/receipts/g2-devnet-admission-independent-20260906.json and g2-devnet-entry-capture-independent-20260906.json — separate finalized admission and capture checks.
- tools/g2-devnet-play.mjs — actual concurrent observer/sender, 17/17 focused offline tests; completed the real run.
- tools/verify-g2-devnet-terminal.mjs — separate public read-only verifier, 41 offline checks plus finalized execution. Its documented single-run limits remain; it does not certify every negative path or a generic keeper.
- releases/g2-devnet-run.json — current gate receipt, COMPLETED with the actual L1 and L2 signatures.

## Remaining for public browser play, one owner per lane

- **Astra 2: website and browser integration.** Local page/controller/archive export and /play plus devnet RPC CSP wiring are implemented. Last public GET before publication still found the old homepage and the G2 file absent. Verify the actually published route, connected-wallet game flow, transaction links and terminal archive/save behavior. Preserve the existing working legacy/X path until its replacement is proven.
- **Lead: credit enrollment and persistent keeper ownership.** This immutable rehearsal economy contains a claim for the known wJ player only. Connecting an arbitrary wallet does not create credits. Choose the next browser test/enrollment route without changing this completed economy or exposing the payer key. Assign one owner to finish the existing generic crank, feeding confirmed public Shot addresses from browser seals into concurrent capture/finalization/settlement. Player reveal remains in the browser with its local secret.
- **Lead: production snapshot/root reconciliation and remaining release acceptance.** Keep the production root separate from the completed one-wallet test root. Live negative-path and additional-browser acceptance must retain their actual evidence status; one successful full game is not proof of every branch.
- **CodexAstra: first-game execution and independent evidence delivered.** Shared handoffs are docs/G2_PUBLIC_KEEPER_HANDOFF.md and docs/G2_DEVNET_TERMINAL_BROWSER_HANDOFF.md. Runtime hold is released after the finalized proof; preserve the fixed nonce-0 receipts and private restart state as history rather than overwriting them for a new run.

The program/game rehearsal is complete. Public website readiness is a separate remaining acceptance. A 21-row gate is scoped evidence; L2 itself accepts settlement and does not replace the terminal archive/accounting proof recorded here.
