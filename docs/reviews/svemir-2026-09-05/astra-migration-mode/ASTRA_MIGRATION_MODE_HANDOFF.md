# Astra — migration mode patch for Sol

Prepared and independently tested; not deployed. The public-site patch is reviewable. The release gate still fails on an existing old-Core cost/source mismatch.

- Exact base: `fcaab92694eb894a4771e803b6998ab2a63ef779`.
- Reviewed patch SHA-256: `e42cdc636fc35fbcf34dbf79e17b75e30d6399bfa8890612b317d10a08e63d2e`.
- Expected Git tree: `f5a8312d85d8fb869e58b797e428c28e80d1a118`.
- Receipt SHA-256: `4afaceee0837ffee747cd32655721131bdac80fa3e91b32fbadee3fd54dd9739`.
- Isolated review worktree: `D:/Work/Software_Projects/ratchetx-astra-migration-review`; only the explicit patch allowlist is staged. Shared working source and the S2 candidate were not edited.

## Behavior

Ten legacy APIs (agent-entry, blink, feeds, game, ledger, log, mcp, record, shot, snapshot) return HTTP503 with MIGRATION_IN_PROGRESS before loading any legacy import. HEAD has an empty503 response; OPTIONS is an empty204 preflight. Responses are not cacheable and contain no wallet transaction, payment requirement or claim action. The existing three /api aliases still resolve to the guarded game handler.

The homepage, index.html, agents, gauntlet, observatory and play-session paths point to the existing claim.html, now a site-wide migration status notice: gameplay paused, migration has not happened, nothing claimable, no wallet action. It has no scripts, buttons, forms or inputs. Proof/supply links remain. The old gameplay HTML and backend remain in source for the historical tests. Both scheduled Vercel jobs are disabled.

Proof and supply are retained diagnostic routes, **not KV-free chain readers**. They still need legacy KV and public RPC and may fail or be stale. The proof page no longer promises a September8 program revocation; its authority decoding remains unchanged. A new proof cache namespace prevents an old cached promise from returning. README, llms.txt and AGENT_STATE carry migration status and no committed freeze date. Historical deployment IDs remain historical; this patch does not overwrite them with an invented deployment.

`RATCHETX_SITE_MODE` defaults to migration. Keep it unset or exactly `migration` for this release. Only exactly `legacy` re-enables the preserved backend and its original durable-store prerequisite. Requests cannot alter it. That setting alone does not restore public rewrites or crons. The test runner explicitly selects legacy for historical tests; the migration suite tests the default independently in VM contexts.

## Verification

- Native Node24.15: migration suite8/8, including70 real loopback HTTP requests across ten APIs and seven methods, poisoned legacy imports/network/timer functions, default/legacy mode and schema gating.
- Full113-suite run: **107 passed, six failed, zero skipped**, including actual browser suites. The log is retained. Three failures were old route assertions; one correctly caught the undocumented mode variable. Those were corrected and all four targeted reruns passed.
- A fifth failure printed14 successful freeze assertions then crashed Node at forced process.exit. It reproduced on rerun. Replacing forced exit with process.exitCode lets cleanup complete: the same14 assertions now pass with exit0. Production code was not changed for this fix.
- One failure remains: test_onchain_cost expects CrankPurse in the old Core lib.rs. The test, cost tool, exercise tool and Rust source match their exact base blobs; a separate rerun reproduces it. **The full release suite is not green.** Do not weaken this assertion to manufacture a pass; Sol owns the canonical source/test reconciliation.
- Release-safety:103 deployment-input files pass;489 tracked/deployment files pass credential/artifact checks. Version/digest and migration build-schema gates pass. These gates ran on the final production bytes; the last change affects only the freeze test teardown.
- Headless installed Chrome at360px and1280px: status text/nav verified, zero scripts/forms/buttons/inputs, no horizontal overflow. This is local rendering with external HTTP blocked. It is not a Vercel routing/deployment readback.
- The final complete patch applies to a separate index populated from the exact base, and its resulting tree equals the isolated staged tree. Per-file pre/post hashes are in PATCH_MANIFEST_REVIEWED.json.

## Integration handoff

Sol owns integration and deployment. Resolve the inherited cost-test mismatch, then use the reviewed patch and hash manifest in the clean release checkout, keeping the folder-deploy guard active. Confirm migration mode in the build output. Preview/public readback must check apex and www with cache-busting, / and /index.html plus all rewritten page variants, all ten paused APIs and existing aliases; confirm status/copy/no wallet action, no-cache behavior, and report proof/supply freshness independently. The expected new claim.html hash is `8b9c298eb0d8d64fb40b3dee716bfb64d03b211dc2182381e3c79928081730a3`.

This changes neither chain programs nor player balances and performs no snapshot export/restore. It makes no assertion that legacy reconciliation is complete. It does not implement a drain: paused legacy APIs also stop legacy settlement, so unresolved obligations must remain accounted for in the separate migration/reconciliation work. Mainnet oracle, economy, exact-SBF, deployment and authority decisions remain separate gates.

## Honest verdict

Verified: patch bytes/application, focused behavior, targeted fixes, native test outcomes, local notice layout and release surface checks. Concluded: the migration surface is ready for Sol to review and integrate. Not verified/completed: an all-green release suite, production rewrite behavior, production deployment, snapshot completeness, or mainnet readiness.
