# First launch: essential client and server-off handoff

Astra -> Sol, 2026-09-05. Implements Sol's ROOM assignment at 00:49:53Z and ACK at 00:54:25Z. This is a bounded acceptance handoff under `docs/PERMANENCE_EXECUTION_PLAN.md`, not a second launch tracker.

**Scope:** the complete permissionless G2 game, its rules and economy. Semir removed automatic legacy claims and the mandatory 72-hour observation from the first-launch critical path. Preserve historical obligations for later auditable reconciliation. No reset, transfer, authority revocation or deployment is performed by this handoff. Sol owns native artifacts, integration and chain execution.

## Inputs and evidence boundary

Before chain checks, Sol supplies:

- Candidate source commit, C8/Core ELF SHA-256 and exact byte lengths, compiler/SBPF generation and exact-SBF test receipt. The old `8d913a5d...` Timepin binary is not the C8 candidate.
- Public recovery manifest with schema 1, intended cluster `genesisHash`, canonical `economyHash` and `rulesetHash`, and `core`/`timepin` objects containing `programId`, `elfSha256`, `elfBytes`, and explicit expected `upgradeAuthority` (public address or null). Pin the reviewed candidate and intended authority, then compare deployed readback; do not adopt unexpected deployed values to make a check pass. Null must be confirmed by actual authority removal. Manifest hashes must be 64 lowercase hex characters; ELF sizes must be real, not placeholders.
- Canonical full Economy/Ruleset/EvidenceSpec arguments, their hashes/PDAs and readback; actual public player, admitted nonce, transaction receipts and two independently operated RPC endpoints for the same cluster. Retain the player's reveal material privately; it is not a public handoff input.

Canonical identities: Timepin `C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp`; Core `cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN`. US517 is closed. Do not create a second identity to bypass a failed pin.

The frozen R2 manifest is at `D:/Svemir/data/brain/scratch/ratchetx-mainnet-20260905/client-staging-r2/ASTRA_CLIENT_HANDOFF_R2.json` on the laptop, SHA-256 `9f8d3ad3d921333cc151706c2a627127233f6db7c9dd42f6977d14592e89e191`. It specifies the six-file import allowlist, predecessors and Rust source guards. Only Sol imports; an unrelated destination hash requires review. Review intentional C8/source changes against the captured guards and regenerate/re-pin affected references under the final candidate receipt. Preserve frozen R2 as historical evidence.

R2's old statement that P6 requires 72 hours is superseded by Semir's later instruction and Sol's 00:49:53Z ACK. Its implementation and test evidence remain frozen.

## Existing commands: run after integration

Working directory: `D:/Work/Software_Projects/ratchetx-c8-core-release-candidate`. Use the existing native Node/web3 installation; add no dependency. If a staging checkout requires it, `RATCHETX_WEB3_MODULE` may point to the existing installed module's file URL. No key file is involved.

```powershell
node --test test/test_core_g2_lifecycle_client.mjs test/test_core_g2_history_reconstruction.mjs
```

Expected baseline: 23 tests, zero failures/skips/cancellations. Existing native R2 receipt: Node v24.15.0, 38335 ms, `test-results.txt` SHA-256 `e90f865899734e298d0a12f572f229f59ae525db52480bc08e53ae0c8f7ed7d3`. This verifies JS, Rust-source-derived reference vectors and simulated RPC. It is not SBF execution or a live game. Record the integrated candidate's new receipt once; rerun for relevant changes/failures, not to manufacture more checks.

For each completed nonce, set `$launchManifestPath`, `$launchPlayer`, `$launchNonce`, `$launchRpcA` and `$launchRpcB` to the real public inputs above, then run:

```powershell
foreach ($launchRpc in @($launchRpcA, $launchRpcB)) {
  $launchOutput = & node tools/core-g2-recovery.mjs --manifest $launchManifestPath --rpc $launchRpc --player $launchPlayer --nonce $launchNonce
  if ($LASTEXITCODE -ne 0) { throw 'Recovery inspection failed; retain stderr as evidence.' }
  $launchResult = ($launchOutput -join "`n") | ConvertFrom-Json
  if ($launchResult.status -ne 'terminal-result-verified') {
    throw 'This nonce has not supplied a verified terminal result.'
  }
  $launchResult | ConvertTo-Json -Depth 30
}
```

For an admitted, still-open nonce, use the same CLI command directly and inspect its proposed action/reason; the terminal assertion above deliberately rejects that state. Omitting `--nonce` discovers open shots for the pinned Ruleset only. The inspector has no execute/signing mode and no output-file flag. Capture stdout/stderr and exit status with the execution receipt.

**Pass criteria:** both providers return authenticated programs and canonical data, then identical terminal nonce, state, VOID reason, game-result hash and reconstructed facts. Context slots/Clock timestamps may differ; do not compare entire JSON documents byte for byte. `no-ledger`, `open-shots-inspected`, an absent Shot, and exit code 0 alone are not lifecycle success. A closed Shot requires the permanent HistoryPage row plus authenticated Timepin Need/Candidate records. RPC errors, mismatched providers or changed account data are unresolved/failed evidence, never agreement.

## Essential execution matrix

All chain writes below belong to Sol's owner-controlled runner. These are required case outcomes, **not commands claimed to exist**. Each actual case receipt identifies candidate hashes, network, instruction sequence, actor/fee payer public keys, nonce, finalized signature/slot, raw before/after account evidence and its independent assertions. Simulated expected rejection and an RPC outage are not a finalized on-chain rejection.

| Check | Required result | Where it can be proved |
| --- | --- | --- |
| Canonical setup | Full Economy/Ruleset/Spec hashes, owners, schema and PDAs agree with the candidate. Identical repeat registration is idempotent; changed immutable arguments are rejected. A zero-root first-launch Economy cannot later be patched into a migration Economy. | Exact-SBF fixtures for failures; deployed readback on the chosen cluster. |
| Real funding and daily close | Finalize the previous UTC day, including the empty-day case, using all 16 canonical RankShard addresses. Open the reload history page; execute RCX reload with exact nonce and Token-2022 mint/ATA checks. Verify consumed RCX = burned + routed, credits = floor(consumed raw units / 1,000,000), and ledger/history conservation. Test existing, missing and self-owned podium seats, dust, and invalid accounts against pinned code. | Exact-SBF local matrix; real token movement only on a cluster carrying the exact production mint and under Sol's authorized execution. |
| Both entry modes | Funded player opens ledger/history as required; forward and observed admission each seal a real shot with canonical Needs, commitment, stake, fixed deadlines and score day. Observe actual debit, lock and nonce changes. Observed admission requires a valid existing final entry observation. | Local exact-SBF; public cluster only with documented valid funding and real evidence inputs. |
| Normal resolution | Entry activation, final exit observation and settle produce the expected outcome. Owner reveal before the fixed deadline authenticates commitment and awards the correct XP; preserve the terminal record. Exercise the supported delegate path and revocation without giving the delegate broader authority. | Exact-SBF boundary/adversarial cases; short live end-to-end successes through the shipped client. |
| Oracle and timeout paths | Authenticate Ambig/Expired Needs before entry/exit oracle VOID. Equal/confidence-band outcomes require resolved-VOID finalization. Ordinary resolution after the reveal deadline requires forfeit: stake is retired, XP is zero. An Open Need past its deadline still needs Timepin terminalization. Elapsed time alone is not an oracle-VOID instruction. | Exact-SBF exhaustive terminal/boundary matrix; focused public recovery case where valid inputs exist. No artificial 72-hour wait. |
| Permissionless recovery and permanent history | A second independent actor completes every action that requires no player authorization. Owner/delegate reveal still needs the valid secret and permission. After Shot closure, reconstruct the same result via both RPCs using the command above. Verify open-count release, history, rent recipient and cleanup reward against account deltas. | Exact-SBF accounting plus a real client/independent-operator recovery and readback. R2 reconstruction by itself does not prove rent transfers. |
| Invalid inputs and retries | Wrong program/ELF/genesis/policy/owner/PDA/metas, malformed data, stale evidence, invalid reveal and duplicate processing cannot change protected state or pay twice. State rollback excludes legitimate transaction fees. A transport failure is not a program rejection. | Existing JS negatives plus candidate exact-SBF tests; targeted signed negative receipts only where the owner runs them. |

Refunds in VOID cases are game credits; they do not reverse an earlier RCX burn or transaction fees. Record actual fees, transient rent returned, permanent accounts and who pays. Do not turn the goal of no paid application API into an unsupported claim that every Solana account/transaction costs zero.

**Devnet limitation:** the program pins RCX mint `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`. Devnet funding/reload coverage requires that exact mint with the required extensions and authorities; it must be checked, not assumed. Fake RPC, injected local account state, a different mint, a legacy-credit test Economy or a rebuilt program with a different mint cannot certify production-token reload. A no-value public Timepin/Core rehearsal must disclose how its ledger is funded and which economic behavior remains proved only by local exact-SBF. Do not confuse that narrower rehearsal with the entire public game.

## Short server-off drill

Use an isolated client/browser profile and independently operated runner. Deny the founder application API, database, hosted settlement runner and fallback endpoints from this test environment; do not shut down the production site. Load the exact candidate client assets locally or from the intended static release. Permit only declared public chain/evidence endpoints and the user's wallet interaction; retain a network trace showing the actual hosts contacted. Any oracle-evidence transport dependency must be named and reproducible by another operator.

With this isolation already active, execute funding/admission through terminal history for the supported game flows; separately demonstrate independent terminal recovery. Replace RPC A with independently operated RPC B and repeat canonical reads without restoring the application API. Preserve a brief receipt of the denied endpoint controls, transaction outcomes, browser errors and terminal reconstruction. Merely loading the page, probing a dead server or reading a pre-existing history row does not prove new gameplay works without the server.

Permissionless settlement has a liveness assumption: somebody must submit valid evidence and crank the applicable actions on time. Nobody can be forced to do so. Missing oracle terminal evidence can lead to VOID/refund; delayed normal settlement/reveal can lead to forfeit with zero XP. The client must state the actual pending action and fixed deadline; an expired timer must not announce that settlement happened automatically.

## Concrete implementation gaps to route after this handoff

The inspected R2 package contains forward admission helpers, terminal transaction builders and a read-only inspector. It does **not** supply a complete write-side CLI or establish that the production browser uses these paths. In these checked modules, registration of Economy/Ruleset, `reload_rcx`, `finalize_day`, observed admission and delegate granting/sealing still lack their full client path; Timepin prerequisite finalize/expire construction is outside R2. Sol should map any equivalent existing owner implementation before assigning new files. Astra's `launch-staging` is only source copies: no new launch module was written.

Those missing paths must be implemented/wired and tested to claim the full game works. Do not mark their rows PASS because the terminal library passed 23 tests. The separate optional P6 staging is paused: its seven focused guard regressions pass locally, but its complete revised suite/runtime/adapter is unverified and it must not certify this launch.

## Preserved obligations receipt, outside launch's automatic-claim dependency

Retain the authoritative legacy snapshot and an obligations receipt: capture time/source, file hash, protected storage location, record/amount totals, open-position status, known exclusions and cutoff consistency. Keep wallet-level records private while retaining audit access. If capture is incomplete, record that and preserve the live source; never label a partial scan a final snapshot. The current seal-freeze alone does not stop every balance writer, and SCAN alone is not atomic.

This preservation work proceeds alongside launch; automatic root/claim integration and player distribution are deferred. Do not delete/overwrite the source before a trustworthy snapshot exists. Later compensation needs explicit recipients/amounts and a supported mechanism: G2 has no arbitrary admin ledger-credit edit, and its Economy arguments are immutable. Do not advertise an already completed migration or an available claim.

## Handoff verdict

**Verified:** frozen R2 manifest/test hashes, 23/23 native JS receipt, actual inspector interface and captured Core/client behavior. **Required evidence still outstanding here:** final C8/Core artifacts and exact-SBF parity, integrated full client/write paths, deployed lifecycle and isolated server-off receipts, authoritative snapshot receipt. No chain write, Cargo/build, deployment, token distribution or freeze was executed by Astra in this handoff. The delivered checklist is ready; it is not a mainnet acceptance certificate.
