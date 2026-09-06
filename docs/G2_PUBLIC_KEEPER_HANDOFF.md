# G2 public keeper handoff

Status: implementation handoff, 2026-09-06. Lead should assign one keeper owner. This document adds no implementation or new acceptance evidence. The current live first-game executor remains under its existing owner until its run finishes.

## What exists

| Component | Actual capability | Remaining limitation |
| --- | --- | --- |
| [tools/g2-devnet-play.mjs](../tools/g2-devnet-play.mjs) | Actual single-game executor. CLI: `node tools/g2-devnet-play.mjs --rpc URL [--keypair PATH] [--send] [--max-seconds 5400]`. Default is one read-only observation; send mode watches both Needs and submits verified lifecycle transactions. Entry capture already has independent finalized evidence. | Binds the saved bootstrap state, designated payer, nonce 0, history page 0, stake 100 and fixed initial accounting. It also signs that player's reveal. It cannot serve arbitrary browser games unchanged. A running process is not proof that its remaining terminal steps have completed. |
| [ops/g2-crank/crank.mjs](../ops/g2-crank/crank.mjs) | Existing location for the generic keeper. Recognizes `--rpc`, `--send`, `--keypair`, with `RATCHET_RPC_URL` / `RATCHET_CRANK_KEYPAIR` fallbacks. | `readState()` at line 80 throws. The action loop logs plans without building or sending them. The comment's `--core` / `--timepin` options are not parsed. |
| [ops/g2-devnet/observe.mjs](../ops/g2-devnet/observe.mjs) | Older observer shell: `--rpc URL --price ACCOUNT --needs FILE [--send --keypair PATH]`. Pure decision helpers exist in [observer.mjs](../ops/g2-devnet/observer.mjs). | Reads a static Need file once, uses host wall time, and its price decoder supplies no message hash. Line 91 calls `sendOne` without connection, web3, built instruction or expected account. It does not finalize/expire Needs or advance Core shots. It is not an operational alternative. |
| [lib/g2/browser-game.mjs](../lib/g2/browser-game.mjs) | Wallet-owned claim, seal, reveal, saved-secret recovery and read-only reconciliation. `seal()` returns `{signature,result}`, including public Shot identity. `reveal({nonce})` uses local saved material and the connected player's signature. | No keeper handoff follows a confirmed seal. `reconcile({nonce})` reads state/signatures and discovers terminal receipts; it never submits keeper actions. |

[lib/g2/player-actions.mjs](../lib/g2/player-actions.mjs) already builds owner reveal after checking the saved commitment against the live Shot. [lib/g2/read-game.mjs](../lib/g2/read-game.mjs) reads authenticated live accounts or successful archive events. Neither is a keeper. [scripts/reconcile.mjs](../scripts/reconcile.mjs) exports old KV balances to a Merkle input, and [tools/crank.mjs](../tools/crank.mjs) touches the legacy game API; neither operates G2 chain accounts.

## Smallest integration for one owner

Complete the existing G2 crank's public Shot input, live account reads and send loop. Reuse the actual executor's `authenticateSource`, `decodeCandidateAccount`, `chooseCapture`, `timepinInstruction`, `readTick`, `sendVerified` and `verifyTransaction` behavior; parameterize the identity assumptions instead of starting another observer implementation. Its current exported helpers still contain payer/context assumptions and must not be treated as generic without that change.

The browser hands off only a confirmed public Shot address/signature. The keeper authenticates the Shot, economy, ruleset and evidence spec, derives player/nonce, history page, score day, refund recipient and both Need addresses from chain state, and persists a public watch list and execution receipts. It refreshes Need/Candidate state and real Solana Clock after actions and on restart. A later nonce or another player must not require the first game's private bootstrap file.

Both Needs must be watched concurrently. With the approved grid/horizon 300, lag 299 and capture grace 900, entry finalization is at T+1199, after the exit source window ends at T+599. Waiting for entry finalization before watching exit misses that window. Preserve the approved policy; no shorter grace or new cadence-measurement prerequisite.

The keeper uses its own explicitly configured funded signer for permissionless actions:

- Timepin: `capture_first`, strictly earlier `capture_conflict`, `finalize`, `expire`.
- Core: `activate_entry`, `settle_final`, `void_pending_entry`, `void_active_shot`, `finalize_resolved_void`, and `forfeit` only after the Shot's stored reveal deadline.

These decisions/account names already exist in [decide.mjs](../ops/g2-crank/decide.mjs), [plan.mjs](../ops/g2-crank/plan.mjs), the canonical client and the actual executor. Dispatch still requires authenticated live inputs and clean simulation. Player reveal stays with the connected browser wallet and its locally retained secret; the keeper must not acquire the player's or first-run payer's keypair, reveal key, salt, or side/probability preimage. Its status/receipt handoff lets the UI show when the Shot is ready for reveal.

## Minimum acceptance

1. A second independently selected browser Shot, distinct from the saved first test shot, is confirmed and handed off using public identity only. No hardcoded nonce-0, payer, stake or private-bootstrap dependency remains in this path.
2. One assigned keeper captures both Needs while their windows are live, finalizes them, activates entry and settles that Shot. Restart it during the run: it reconstructs work from public chain state and durable public records, without duplicate admission, forgotten Needs or a replacement watcher.
3. The browser reloads/restores its own saved reveal material, reads the actual AwaitReveal state/deadline, and the connected player signs reveal. No payer keypair or browser secret is copied into the keeper. A void is recorded honestly and does not substitute for this reveal-path proof.
4. Record real devnet signatures and decoded readbacks. For closure, verify Shot absence, correct ledger debit/payout/XP/open counters, and the exact successful ShotArchived event folded into the persistent HistoryPage root. Preserve the terminal signature so browser reconciliation works after restart.

Acceptance is these observed transactions and postconditions. Unit/model tests, a dry-run, an empty action list, an observer process merely running, or a hand-edited green gate do not satisfy it. No new measurement campaign is required.
