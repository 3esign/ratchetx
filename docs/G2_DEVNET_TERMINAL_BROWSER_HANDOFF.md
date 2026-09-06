# G2 devnet terminal browser handoff

Read-only schema review, 2026-09-06. The observed public run was still RUNNING; no terminal outcome is asserted here. The live adapter remains unchanged. Astra2 owns browser presentation and export integration.

The runner receipt is an execution summary, not the archived Shot object. Use it to locate the successful terminal transaction, then let the existing reader authenticate the actual Core event.

| Browser input | Exact public source |
| --- | --- |
| Cluster/program/economy/ruleset identity | `releases/g2-devnet-run.json`: `clusterGenesis`, `programs`, `economyHash`, `rulesetHash`; require agreement with browser config before using the receipt. |
| Player and nonce | `run.payer`, checked `config.watchNonce` (this first run is nonce 0). The run does not currently carry a top-level nonce. |
| Terminal transaction | Last successful step named `reveal`, `void_pending_entry`, `void_active_shot`, or `finalize_resolved_void`: use its `signature`. `settleSignature` is not terminal; settlement leaves Shot open. |
| Archive snapshot | Call `game.readShot({ player, nonce, terminalSignature })`. `lib/g2/read-game.mjs:119` checks the successful Core event and returns `kind: 'archive'`, `shot: null`, and `receipt`. |
| Outcome summary | `run.result`: `outcome` (`HIT`, `MISS`, `VOID`), string `voidReason`, decimal-string `refundCredits`, `credits`, `xp`, hex `gameResultHash`, `rowHash`, `resultsRoot`, and `shotClosed`. Treat this as the runner's verified summary, not a browser replay. |
| Captured prices | Capture step `readBack`: `need`, `candidate`, `messageHash`, decimal-string `price`, `conf`, `publishTime`, `postedSlot`, `captureSlot`, `captureTs`, numeric `exponent`. Match `messageHash` to the corresponding `finalize_entry`/`finalize_exit` step's `readBack.candidateHash`; the first capture need not be the final selection. |
| Need targets/configuration | Public bootstrap receipt: `addresses`, `evidenceSpecHash`, and `observer.needs` with target/source/capture deadlines. Bind that receipt to `run.bootstrapReceiptSha256`. |

The reader's archive event contains:

```text
economyHash, player, nonce, pageIndex, slot, sequence, rowHash, resultsRoot
result: rulesetHash, proofMaterial, state, voidReason, stake, sealedTs,
        entryTargetTs, exitTargetTs, side, pBps, delegate, gameResultHash
```

It also supplies `receipt.transaction {signature, slot}`, log `provenance`, and explicit `checks`. Bytes are Uint8Array, exact integers are BigInt, state/reason/side codes are numeric. The runner summary omits this event; do not synthesize it from `run.result` or invent a live Shot after closure. `proofMaterial` is the actual public terminal material: the salt after reveal, or commitment for void. Never fill it from a private browser/server backup.

Current integration points: `lib/g2/game-page.mjs:82` gets the shared-run terminal signature only from the URL query; `lib/g2/browser-game.mjs:152` forwards it to the reader. `lib/g2/shot-view.mjs:94` renders archive results explicitly. `lib/g2-text/say.mjs:169` and `:177` already provide archive-aware sentence/export wrappers; the earlier side/missing-hit issues have been corrected by their owner.

`saveReaderResult` currently exports a useful compact archive JSON with transaction coordinates and honest `resultEconomics: false` / `historyCommitment: false`. That download is readable offline and can be checked against the chain later. It is not a complete offline economics proof: the compact event omits prices, hit/XP and permanent oracle facts, while capture summaries omit `prevPublishTime`, `emaPrice`, and `emaConf` needed to recompute the canonical message hash.

For complete local economics/hash replay, retain the public Economy, Ruleset, EvidenceSpec, both permanent Need/Candidate account bytes, HistoryPage bytes, terminal transaction/event, and read-slot/provenance metadata. The final Candidate must be selected by the permanent Need's hash. This bundle enables local hash and accounting replay; canonical chain inclusion/finality still requires chain evidence. Preserve that distinction in UI and exported checks, and do not label RPC log decoding alone as full verification.
