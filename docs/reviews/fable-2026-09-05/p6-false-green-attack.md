# P6 evidence — false-green attack and the record that defeats it (Fable, 2026-09-05)

Companion to `docs/CLIENT_SERVER_OFF_ACCEPTANCE.md` (Astra, C1–C9) and `docs/reviews/svemir-2026-09-05/serveroff-review.md`. This does not restate them. It asks one question: **assuming C1–C9 pass exactly as written, how could a 72-hour P6 window still be false-green?** Ten vectors, each with the evidence that closes it. Status: acceptance design; nothing here was executed.

## The uncomfortable one first
**V1 — "independent submitter" is unfalsifiable from chain data.** A third-party fee payer is a keypair. If we fund it and run it, it is our operation with extra steps, and no skeptic can tell from signatures. Therefore P6 cannot *prove* that others will run the game; it proves that the **published bundle suffices for someone who is not us**. The proof of decentralization is elsewhere: code properties (every exit permissionless and chain-time-gated — `coupled-chain-proof.md` §5), no privileged writer, and immutability (P10).
*Defeat:* (a) at least one genuinely external operator (a student, a community member, one of the infra contacts) publishes their pubkey and a signed statement **before T0**, funds the fee wallet from their own funds, and runs the bundle on a machine we do not control; (b) every operator's pubkey is listed in the T0 record; (c) the report says in plain words that P6 is a bundle-sufficiency rehearsal, not a proof that strangers will show up. Anything else is theater.

## The rest
**V2 — incentive is untested by construction.** On devnet there is no real RCX and WMv2 cannot be funded against upgradeable producers, so all crank/settle work in P6 is volunteer work. *Defeat:* the report states "liveness with volunteer runners"; the self-sustaining claim is deferred to P7→P10 with real RCX and immutable producers (Opus's incentive proof).

**V3 — hidden founder dependency that nobody turned off.** *Defeat:* founder services are **deliberately off** for the whole window (the site is down on Upstash quota today, which makes this real), and the T0/T72 record logs that state; the operator machine has no reachable route to ratchetx.xyz/Upstash/Vercel (DNS-blackholed or simply down). The only declared external transports are the public RPC(s) and the Pyth sponsored feed.

**V4 — outcome cherry-picking.** Pyth devnet SOL stalled ~5 minutes today; a 72h window will contain `EXPIRED` and `VOID` outcomes. *Defeat:* report the **full outcome distribution** per shot (Final-hit / Final-miss / Equality-void / Band-void / Ambiguous-void / Expired-void / Forfeit) with every terminal receipt; a captured-only table is false-green.

**V5 — candidate drift inside the window.** *Defeat:* at T0 dump on-chain ProgramData for Core and Timepin and record sha256 + the ELF `e_flags` (`EXPECT_SBPF=3 tools/verify-artifact.mjs`); at T72 dump again; any byte difference invalidates the window. If the devnet generation is frozen (see V10) this is automatic, but record it anyway.

**V6 — two runners that never disagree because they never overlap.** *Defeat:* at least two operators must attempt the **same** permissionless transitions on the **same** shots (settle/forfeit/expire races). Evidence = a per-shot reconciliation table: who submitted, which landed, both readbacks identical. Determinism means the loser's transaction fails with the expected state error, not a different outcome.

**V7 — the client in the window is not the client in the bundle.** *Defeat:* sha256 of every client/recovery file used is recorded at T0 and must equal the bundle manifest; any hotfix mid-window resets the clock (Astra C9 already says so; the record makes it checkable).

**V8 — devnet conditions read as mainnet conditions.** Fees, congestion, RPC behaviour and Pyth cadence differ. *Defeat:* costs reported per C8 are labelled devnet; the mainnet cost model is Opus's P7 packet, not P6 data.

**V9 — P6 green quietly implies P8.** Test ledgers on devnet prove nothing about the legacy snapshot, claim proofs or balance conservation across the cutover. *Defeat:* the report carries an explicit line: "P8 accounting not exercised".

**V10 — burning 72-hour windows on bugs.** If we freeze the devnet generation first (needed to exercise WMv2) every bug means a new program id and a restarted clock. *Defeat:* order = (1) short server-off rehearsal (C9) on an **upgradeable** devnet deployment to shake out client/runner bugs, (2) freeze a devnet generation (throwaway ids), (3) start the 72h clock. Never the other way round.

## The T0 / T72 record (one JSON, published with the bundle)
```
{ "cluster": { "genesis": "...", "rpc": ["..."] },
  "programs": { "core": {"id":"...","programdata_sha256":"...","sbpf":3}, "timepin": {"id":"...","programdata_sha256":"...","sbpf":3}, "work_market": {...} },
  "economy": { "pda":"...", "hash":"..." }, "ruleset": { "pda":"...", "hash":"..." },
  "bundle": { "manifest_sha256":"...", "client_files": {"path":"sha256"} },
  "operators": [ { "pubkey":"...", "signed_statement":"...", "machine":"external|team", "funded_by":"self|team" } ],
  "founder_services": { "api":"off", "db":"off", "indexer":"off", "runner":"off", "checked_at":"T0/T72" },
  "window": { "t0_slot":..., "t72_slot":..., "continuous": true },
  "outcomes": { "final_hit":n, "final_miss":n, "void_equality":n, "void_band":n, "void_ambiguous":n, "void_expired":n, "forfeit":n },
  "reconciliation": [ { "shot":"...", "attempts":[{"operator":"...","sig":"...","result":"landed|expected_state_error"}], "readbacks_identical": true } ],
  "disclaimers": ["volunteer runners, incentive untested", "devnet costs only", "P8 not exercised"] }
```
If any field cannot be filled honestly, the window is not P6 evidence. That is the whole point of writing it down before we start.
