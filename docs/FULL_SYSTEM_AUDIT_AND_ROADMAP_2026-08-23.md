# RATCHET / RatchetX — full system audit and technical roadmap

**Audit date:** 2026-08-23  
**Production version inspected:** `h67-2026-08-23`  
**Repository commit inspected:** `c321798c36258ace77c0963067f5ae8c22b75799`  
**Mainnet program:** `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX`  
**SOL FeedClock:** `CE5m9Xag3wwgcfVkbSBnv5WFKPrY1ZhLwSSru9wu9gN`

This is a deliberately severe audit. Its purpose is not to produce an all-green launch document. It is to separate what is working, what is merely demonstrated, what is still centralized, what is overstated, and what must be proven before Ratchet can honestly call its referee autonomous.

## Executive verdict

Ratchet is a real, working game with unusually strong public evidence for a small product:

- the live site and API are on `h67`;
- real Token-2022 burns and Champion's Cut transfers are wallet-signed;
- Pyth sponsored push accounts are read directly from Solana for production settlement eligibility;
- Supabase holds durable game state and is locked to the server service role;
- the event log is hash-chained and exportable;
- the v2 Solana program is executable on mainnet;
- the exact deployed mainnet ELF is byte-identical to the repository artifact, SHA-256 `4947daeba64711b3e21b681870c3e6c61db510ee19922e925221fc28f9b486a8`;
- the program holds no player funds;
- the production browser can optionally seal an eligible SOL shot on-chain;
- all 33 current automated tests pass;
- the inspected mobile widths do not overflow the document and the wallet control is in the intended top-right position.

But Ratchet is **not yet a fully on-chain game or an autonomous on-chain referee**. The canonical game settlement, credits, XP, podium, history, and reveal remain server-side. The mainnet program is an optional receipt path in a soak period. Its upgrade authority is active. Its price clock has correctness and liveness weaknesses that must be fixed before the program is allowed to become canonical. Production oracle capture improved materially in h67, but the inspected 24-hour duty metric was only 81.94%, and the system still carries a historical period dominated by `crossing-update-missed` voids.

The shortest safe path is therefore:

1. keep h67 economics and game rules frozen;
2. fix proof/copy/test integrity without changing settlement;
3. prove the current capture architecture unattended for 72 hours;
4. re-anchor the current log head and automate an anchor freshness policy;
5. build Seal v3 on devnet, not mainnet;
6. fuzz, soak, externally review, and only then decide whether on-chain settlement becomes canonical.

No new mainnet deploy is justified today.

## Audit method and evidence

The audit covered the clean release clone, production endpoints, the mainnet program account, the deployed binary, the Pyth capture and settlement flow, Supabase permissions, authentication, public proof and record surfaces, the browser UI, mobile layout, and the project’s previous decision history.

Evidence gathered:

- `npm test`: **33 passed, 0 failed, 0 skipped**.
- Live state: `h67-2026-08-23`, Pyth on-chain source, Supabase durable state.
- Live Proof: 19 lines; 15 green, two grey, two red. The two red lines are two views of the same known event-log gap at entry `#345`.
- Mainnet RPC: program is executable under `BPFLoaderUpgradeab1e...`; ProgramData is `BiMrv5BAjxCPzH2sFFARbDnrXmn4FRTULfnKgeAVL4CF`; last deploy slot `441092765`; upgrade authority `AAaU3oyrcmy6GDGxcSUEgg4uUag4pF9jwL2rThB49gks`.
- Mainnet binary: on-chain bytes and `onchain/ratchet-seal-v2/mainnet-c37fa32.so` are identical.
- Observatory at inspection time: 1,180/1,440 expected samples, **81.94% duty**; feed coverage around 99.92–100%; maximum observed publish gaps around 109–126 seconds; stream surface 7/7 green at the instant inspected.
- Recent public record after index 600: 17 hits, 16 misses, 23 voids. Twenty-two voids were `crossing-update-missed`; almost all were before the latest stream correction. The most recent inspected sequence was predominantly clean hit/miss settlements, which is encouraging but not yet a long enough proof.
- Log: current head around `#1062`; latest discovered on-chain anchor only covered entry `#11`.
- Mobile inspection at 375, 390, and 412 CSS pixels: no document-level horizontal overflow; two-row HUD; wallet control in the intended place. The mobile audit itself contains stale selectors and can falsely report zero targets.

## Truth-plane matrix

The phrase “on-chain” must always name the exact component.

| Component | Current source of truth | Status | Honest wording |
|---|---|---|---|
| RCX supply, authorities, burns | Solana Token-2022 | Mainnet, canonical | On-chain |
| Champion's Cut transfer | Player-signed Solana transaction | Mainnet, canonical | On-chain transfer |
| Pyth input eligibility | Sponsored Pyth push accounts read from Solana | Production, canonical input | On-chain oracle accounts |
| Game settlement result | Ratchet server + observed Pyth transition log | Production, canonical | Server-settled from on-chain oracle data |
| Credits, XP, streak, chambers | Supabase/Postgres | Production, canonical | Durable off-chain game state |
| Daily/weekly/all-time ranks | Supabase projections | Production, canonical | Server-computed leaderboard |
| Event history | Hash-chained Supabase log | Durable but one known gap | Tamper-evident between anchors, not complete |
| Log timestamp anchor | Solana Memo | Mainnet, stale | Periodic on-chain checkpoint, not every mutation |
| Seal v2 receipt | Ratchet Seal v2 | Mainnet beta | Optional on-chain seal receipt |
| Seal v2 settlement | Ratchet FeedClock + program | Deployed, not integrated end to end | Experimental mainnet program, not canonical game referee |
| Modeled floor | Server model | Simulation | Non-redeemable model |
| Vault / redeemability | None | Not built | Roadmap only |
| Player passport | Token-2022 devnet experiment | Research | Devnet experiment, not production identity |

This matrix should be the source for website, README, X articles, Proof, DEX copy, and future announcements. “Mainnet live” without a component is prohibited because it is true for some rows and false for others.

## Severity scale

- **P0:** direct loss of player funds, arbitrary economic mutation, or production compromise. None was proven in this audit.
- **P1:** incorrect public proof, incorrect settlement, stuck on-chain state, or a claim materially stronger than the implementation.
- **P2:** security, reliability, scalability, or test weakness likely to become material with more users.
- **P3:** maintainability, polish, or documentation debt.

## Findings

### P1 — public v2 shot proof recomputes the wrong commitment

`api/shot.js` verifies only the legacy commitment `sha256("SIDE|salt")`. New production shots use the wallet-bound v2 preimage:

`RATCHET|v2|<wallet>|<shotId>|<SIDE>|<salt>`

`lib/record.js` understands both versions, but the public single-shot proof page does not. A correctly settled v2 shot can therefore be displayed as a commitment mismatch. The existing shot-page test only seeds a v1 fixture, so the full green suite does not detect this.

**Required fix:** use one shared commitment verifier in the game, record, snapshot, and shot page; add v1 pass, v2 pass, wrong-wallet fail, wrong-shot fail, and wrong-salt fail fixtures.

**Acceptance:** the same real v2 shot verifies identically on `/api/shot`, `/api/record`, snapshot restore, and the local verifier.

### P1 — the deployed FeedClock does not prove the first Pyth publish after expiry

The program receives Pyth’s real `msg.prev_publish_time`, but stores the previous **Ratchet checkpoint** as `Observation.prev_publish_time`. It then describes a crossing as the unique first Pyth update after expiry. Those are not equivalent.

If the capture process misses one or more sponsored account mutations, the later checkpoint can create a synthetic Ratchet interval spanning expiry. Settlement then proves “first Ratchet checkpoint observed after expiry,” not “first Pyth publish after expiry.” The event emits Pyth’s real previous time while stored settlement uses the synthetic previous checkpoint time, which makes review harder.

**Required v3 fix:** store and validate Pyth’s signed `msg.prev_publish_time`; never synthesize source chronology. A missed source transition must remain unprovable, then defer/void by policy. Update every comment and public claim accordingly.

**Acceptance:** property tests show that removing any source transition can never produce a different valid winner; it may only make the shot unresolved.

### P1 — the 64-entry ring buffer is incompatible with the supported horizon

The program supports expiries up to 90,000 seconds while retaining only 64 observations. During active markets, 64 price updates may represent minutes, not 24 hours. A permissionless cranker can also accelerate eviction whenever genuinely newer sponsored updates exist. A valid expiry crossing can disappear before anyone settles.

This is a liveness failure and a griefing surface, even though it cannot steal player funds in the current non-custodial program.

**Required v3 design decision:** either restrict on-chain eligible windows to what the retention proof can support, or replace the global ring with immutable/chunked crossing checkpoints retained through the claim deadline. Document rent and crank cost. Do not simply increase the array without computing account size, update rate, and worst-case retention.

**Acceptance:** a declared worst-case update rate and horizon cannot evict a still-claimable crossing; adversarial checkpoint order is fuzzed.

### P1 — seal does not enforce an initialized clock

The source comment says a shot must begin after the clock is initialized, but `seal` only validates the current Pyth price account and does not require the FeedClock. A shot sealed before the first checkpoint has no historical crossing and can only time out and void.

**Required v3 fix:** include and validate the matching FeedClock at seal, require a non-zero latest publish time, and bind the shot to a clock version or epoch.

### P1 — a settled but unrevealed on-chain shot has no escape path

`settle` moves a shot to `Settled`. `close_shot` accepts only `Revealed` or `Voided`. `void_shot` accepts only `Sealed`. If the reveal salt is lost or the reveal automation fails, rent is stuck permanently.

**Required v3 fix:** add a reveal deadline and an explicit expired-unrevealed cleanup path. Because the current program holds no wager funds, the safe outcome is “no record credit, rent returns to the recorded player.” If value is added later, non-reveal economics must be specified before commit.

### P1 — public record language overclaims settlement and completeness

`api/record.js`, `docs/DATASET.md`, `docs/GAME_MODES.md`, `docs/ONCHAIN.md`, and older articles contain combinations of:

- “settled on chain”;
- “first Pyth publish after expiry”;
- “gapless” log;
- the same predicate as the on-chain program.

Production settlement is server-canonical, based on the first fully validated Pyth transition that Ratchet observed. The log has a known missing entry `#345`. The on-chain beta uses a different clock. These documents must not be used as release evidence until corrected.

**Required fix:** replace every absolute statement with the truth-plane matrix. Keep the gap visible. Version the dataset schema so old rows retain their original semantics.

### P1 — Proof’s chain anchor is far behind the current history

At inspection, the event head was around `#1062` while the latest discovered memo anchor covered only `#11`. A hash chain proves internal ordering from an available predecessor. It does not independently timestamp or prevent a rewrite after the last external anchor.

The historical gap and stale anchor are separate issues: the gap is an incomplete record; anchor staleness is a weak external checkpoint.

**Required action:** the user signs one new anchor for the current head after the proof bug/copy patch, then the system enforces an explicit freshness SLO. Signing and fees always remain a user action.

**Suggested SLO:** Proof turns amber after 24 hours or 500 entries without an anchor and red after 72 hours or 2,000 entries. The exact threshold must be chosen before observing whether it is convenient.

### P1 — current capture quality is promising, not yet launch-grade evidence

The stream was green during the audit and recent h67 settlements were mostly hit/miss rather than void. However, the 24-hour sampler duty was 81.94%, and the recent public record still contains a block of 22 `crossing-update-missed` voids. Pyth’s own documentation says sponsored push feeds can be delayed and recommends operating a price pusher when reliability matters.

This does not mean a paid Hermes key is required. Ratchet’s primary path can remain free: sponsored Solana push accounts plus independent RPC capture. It means the capture and recovery system must be measured as infrastructure, not inferred from a green instant.

**Required gate:** 72 unattended hours before changing mechanics or promoting the referee. Suggested pre-registered criteria:

- zero invented prices and zero Coinbase-settled real shots;
- zero duplicate settlement/reward application;
- zero stuck chambers after their deadline plus grace period;
- less than 1% platform-caused voids, separately from genuine oracle equality/uncertainty;
- every missed crossing has a machine-readable cause and raw evidence pointers;
- p50/p95/max capture latency and reconnect count published;
- restart and RPC-failover drills recover without manual page refresh.

### P2 — wallet authentication is a reusable two-hour bearer signature

The wallet signs `RATCHET | wallet | unix_ms`. The signature is valid for two hours, stored in `localStorage`, and is not bound to domain, URI, chain, nonce, session ID, or intended action. If copied through an XSS, extension, log, or support screenshot, it can replay authorized in-game actions until expiry.

No player-funds key is exposed and the server cannot transfer the player’s tokens, so the blast radius is game state rather than arbitrary wallet custody. It still matters once ranks and rewards have value.

**Required hardening:** adopt a Sign-In With Solana-style structured message with domain, URI, chain, nonce, issued-at, expiration, and session ID; store server nonces durably; make replay one-time; shorten the session; prefer an HttpOnly session token where practical; require transaction signatures for token value movement.

### P2 — CSP permits inline scripts while the page has many HTML sinks

The entire application is one large HTML file and the CSP permits `'unsafe-inline'` for script and style. The client uses many `innerHTML` assignments. Current server fields are mostly constrained, but the review surface is too large and one future unsanitized field can convert the reusable wallet signature into a meaningful exploit.

**Required hardening:** move script and style to versioned local files, remove `unsafe-inline`, use nonces or hashes during transition, replace dynamic HTML with DOM/text APIs where data is not static, and add an XSS fixture for agent labels, error reasons, feed names, and wallet-derived strings.

### P2 — rate limiting is instance-local

The API allows 20 writes or 80 reads per IP per minute using process memory. Serverless instances do not share that map. It is a useful local brake, not an economic or abuse boundary.

**Required hardening:** move mutation, scan, snapshot, and oracle-ingest limits to durable storage; use separate budgets by wallet, IP, action, and global circuit; preserve idempotency as the real protection against retries.

### P2 — Supabase is locked down, but the SQL can follow stricter current guidance

The table has RLS enabled; access is revoked from `public`, `anon`, and `authenticated`; functions are re-revoked and granted only to `service_role`. This is materially correct.

The functions are `SECURITY DEFINER` in the exposed `public` schema with `search_path = public, pg_temp`. Current Supabase guidance prefers an empty search path, fully qualified names, explicit execute grants, and avoiding exposed-schema definer functions where possible.

**Required hardening:** move privileged functions to a private schema or set `search_path = ''` and schema-qualify every object; add a migration test that anon/authenticated cannot call any `ratchet_kv_*` function; keep the service key server-only.

### P2 — the public snapshot path will become expensive

The resurrection endpoint is valuable, but it scans and exports the whole state. As players and price history grow, it becomes a cost, timeout, memory, and denial-of-service surface. A single known event gap also means “resurrection” must not be described as recovering a complete gapless history.

**Required hardening:** generate immutable content-addressed snapshot objects asynchronously, paginate manifests, publish hashes and counts, retain multiple generations, rate-limit generation separately from download, and run a restore drill into an empty database.

### P2 — the Blink reward is eventually detected, not atomically awarded

The Action returns an unsigned memo transaction. XP is credited later when Ratchet scans recent wallet transactions. The game checks a limited recent window, so the wording “receives XP” is stronger than the mechanism if the user sends many transactions before detection or the RPC is unavailable.

**Required fix:** say “credited after Ratchet detects and verifies the memo,” expose a claim/status endpoint, scan by returned signature rather than a small generic recent window, and make the credit gate idempotent.

### P2 — the test suite is green but misses the highest-risk edges

Known gaps:

- no v2 shot-page commitment fixture;
- mobile audit queries stale `.target`/`window.STATE` surfaces and can falsely report zero targets/state;
- no full browser test for seal → checkpoint → settle → reveal → close;
- no property/fuzz tests for clock chronology, ring eviction, commitment domains, and outcome math;
- no concurrency/load test against the real serverless + Supabase topology;
- no restore drill with the known gap semantics;
- no live canary for anchor freshness and capture duty.

Tests should be fewer and sharper, not merely more numerous. Each release gate must exercise the actual production version and at least one real failing control.

### P2 — release and repository hygiene are fragile

The parent workspace contains multiple copies and a heavily dirty tree. The clean synchronized clone is the correct release source, but that rule is not yet an enforced artifact. Giant files (`api/game.js` and `index.html` are each about 150 KB) create a large blast radius for small changes.

**Required release discipline:** one canonical repository; clean worktree gate; commit-bound release manifest; artifact hash; program ID and authority; frontend/API version; environment dependency matrix; live endpoint smoke output; rollback target. Modularization follows stabilization and must not be mixed with mechanic changes.

### P3 — current mobile is functional, not the final casino experience

The main layout now avoids horizontal document overflow and the wallet control is placed correctly. The page remains very long on mobile, navigation is wider than the viewport, and dense proof/dependency copy competes with the play loop. A likely missing favicon produces a harmless 404.

Do not redesign it during the settlement stabilization window. After correctness gates pass, build the elegant casino UI as a separate, screenshot-tested layer over stable state contracts.

## Game mechanics and economy

The current rules should remain frozen during the technical stabilization:

- every non-void settlement earns 1 basic XP;
- hits add skill XP and return 1.7× credits;
- misses earn only the basic XP and reset the streak;
- voids refund credits and earn no XP;
- daily podium remains dynamic;
- weekly remains;
- all-time rank is record-only, without a payout;
- reload remains 70% burn / 30% Champion’s Cut / 0% team;
- the floor remains a non-redeemable model;
- no vault or hold/sell condition is added now.

The economy deserves simulation before the next change. A reload irreversibly consumes/routes 100% of the RCX while a hit returns only internal play rights. That is a strong sink and may limit repeat play. It can also be the defining identity of the token. Do not soften or intensify it from anecdotal play sessions. Model cohorts under low, medium, and high hit rates; measure credits per RCX, sessions per reload, time to exhaustion, concentration of Champion’s Cut, and whether podium incentives dominate prediction skill.

Question generation should also be changed from evidence, not frustration. The recent void problem was primarily capture failure, not proof that SOL five-minute questions are conceptually bad. First complete the 72-hour capture study. Then compare each feed/window by settlement rate, latency, equality rate, confidence rejection, and player selection. Retire or widen only the cells that fail a pre-registered threshold.

## Target architecture

### 1. Source events

Read Pyth sponsored push accounts from Solana. Preserve `feed_id`, price, exponent, confidence, `publish_time`, **source `prev_publish_time`**, posted slot, account address, RPC identity, fetch/receive time, and raw-data hash.

### 2. Independent capture lanes

- Primary: one long-lived Cloudflare Durable Object or equivalent connection manager per feed group, with reconnect/backoff and durable cursor.
- Secondary: an independent RPC/WebSocket provider or self-operated lightweight observer.
- Existing Vercel heartbeat: watchdog and gap detector, not the primary event stream.
- Optional Hermes: explicit degraded/recovery lane only when configured. The primary product must not silently depend on a paid key.

Deduplicate by source identity such as `(feed, publish_time, prev_publish_time, posted_slot, raw_hash)`, not by timestamp alone.

### 3. Canonical reducer

One deterministic reducer consumes immutable source events and produces seal eligibility, first-observed crossing, settlement, reward, rank, and public receipt projections. The reducer is replayable from an ordered input set. API and UI never implement a second interpretation of the same outcome.

### 4. Receipts and projections

Store one canonical settlement receipt containing rule version, source event IDs, entry and exit evidence, commitment version, arithmetic inputs, reward deltas, and reducer version. UI cards, ranks, Proof, Record, snapshots, and agents are projections of that receipt.

### 5. On-chain canonical path

Only after v3 passes devnet gates, the browser may seal, permissionless infrastructure may checkpoint/settle/reveal/close, and the server may mirror the on-chain receipt. The transition must name one authority boundary: either on-chain is canonical for eligible shots or it is an optional proof receipt. It cannot be both depending on which page is describing it.

## Phased execution plan

### Phase A — 0–24 hours: make h67 internally honest

Small, low-blast-radius changes only:

1. Fix shared v2 commitment verification and add the missing fixtures.
2. Correct “settled on chain,” “first Pyth publish,” and “gapless” copy.
3. Repair the mobile audit selectors and add the missing static asset.
4. Add an explicit `truthPlane`/`settlementAuthority` field to state and public receipts.
5. Add anchor age/head distance to Proof.
6. Publish a release manifest for h67: commit, endpoint versions, program/clock IDs, binary hash, authority, and current known limitations.
7. User signs one fresh log anchor after the patch. No automated tool signs for the user.

**Exit gate:** all proofs agree for the same v1/v2 fixtures; no public page calls the server result an on-chain settlement; production smoke is green except the explicitly retained historical gap.

### Phase B — 24–96 hours: prove the free autonomous clock

1. Freeze mechanics and question mix.
2. Run the pre-registered 72-hour capture canary unattended.
3. Record reconnects, RPC provider, received events, dedupe outcomes, latency, blind intervals, settlements, deferrals, voids, and manual interventions.
4. Add a second independent observer lane and compare event sets.
5. Execute controlled failure drills: kill one stream, deny one RPC, restart the worker, delay Supabase, and reload the browser mid-settlement.
6. Publish both success and refutation, including platform-caused void rate.

**Exit gate:** the acceptance criteria above pass for a full 72 hours, or the failure becomes the next bounded engineering task. No marketing redefinition of duty is allowed during the run.

### Phase C — week 1: Seal v3 on devnet

1. Write a short RFC defining canonical time, admissible source events, missed-event behavior, retention horizon, reveal deadline, and cleanup.
2. Replace synthetic checkpoint chronology with signed Pyth chronology.
3. Require initialized matching clock at seal.
4. Replace or bound the ring buffer so live claims cannot be evicted.
5. Add reveal expiry and permissionless cleanup.
6. Publish `security.txt` and canonical IDL metadata.
7. Add property tests and adversarial crank tests.
8. Run the entire lifecycle on devnet with real Pyth accounts and a browser wallet.

**Exit gate:** source is reproducibly built, devnet bytes match the published artifact, every state has a terminal path, and an external Solana developer can reproduce a hit, miss, void, missed-crossing rejection, and rent return.

### Phase D — weeks 2–4: external review and mainnet decision

1. Request a focused external review of clock correctness, state transitions, account constraints, and authority handling.
2. Publish the threat model and every finding.
3. Decide upgrade authority policy: reviewed multisig + timelock during continued iteration, or an announced freeze after a defined soak. Do not freeze merely for marketing.
4. Estimate exact deploy/extend rent and fees from the final artifact before asking the wallet to sign.
5. Deploy only if v3 provides a user-visible capability that h67 cannot safely provide.
6. Integrate lifecycle automation behind an eligibility flag, starting with SOL and short windows.

**Exit gate:** on-chain receipts are canonical for the enabled cohort, the UI derives from them, and rollback disables new seals without preventing settle/reveal/close for existing ones.

### Phase E — 30–90 days: research product, not feature pile

The larger opportunity is a public laboratory for turning raw blockchain events into timely, explainable product truth.

Candidate experiments, one at a time:

- a public Pyth sponsored-feed consumer benchmark with raw event hashes and settlement impact;
- deterministic replay of UI state from receipts;
- compressed or chunked on-chain settlement archives;
- non-transferable player passport metadata, only after production semantics are stable;
- permissionless agent play adapters for Hermes/OpenClaw-style frameworks, without letting agent labels pollute player killfeeds;
- alternative question families whose data provenance is first-class;
- a separately funded and audited vault only if redeemability is truly required;
- content-addressed frontend and snapshot distribution;
- formal state-machine or property verification of the canonical referee.

Each experiment needs a falsifiable question, a minimal implementation, a published dataset, and a stopping rule. “Uses more Solana” is not a success criterion.

## Stress-test matrix

| Surface | Failure injected | Invariant |
|---|---|---|
| Pyth stream | disconnect/reconnect | no fabricated transition; gap is explicit |
| RPC | stale, rate-limited, divergent providers | no settlement from display fallback |
| Duplicate event | same event through two lanes | exactly one stored source event and one settlement |
| Out-of-order event | newer arrives before older | deterministic source order; no result rewrite |
| Missing crossing | remove the unique crossing | unresolved/void, never substitute a later price |
| Clock spam | valid rapid checkpoints | claimable crossing cannot be evicted |
| Server retry | same mutation 10× | one economic application |
| Concurrent settle | multiple instances | one receipt and one reward delta |
| Browser sleep | tab sleeps through expiry | card updates after wake without manual refresh |
| Supabase outage | fail writes/slow reads | no half-applied reward; visible degraded state |
| Worker outage | primary lane dead | secondary detects and reports; recovery measured |
| XSS payload | every public text field | rendered as text, wallet auth not exposed |
| Snapshot restore | fresh empty database | hashes, counts, gap semantics, and ranks reproduce |
| Upgrade | new program/browser version | old open shots preserve old rules |

## How to attract serious Solana infrastructure attention

The strongest positioning is not “a casino using Solana.” It is:

> Ratchet is a prediction game used as a continuous adversarial test of how Solana oracle events become durable, user-visible truth.

Artifacts that earn developer attention:

1. **A small reproducible bug report or RFC**, not a vague tag. Example: mutable sponsored price snapshots, missed transitions, and first-crossing semantics.
2. **A public benchmark** with methodology registered before the run: capture latency, gaps, provider divergence, settlement impact.
3. **A transaction and raw evidence link** for every technical claim.
4. **A refutation post** when an architecture fails. This is more credible than a perfect graph.
5. **A minimal open-source example** extracted from the game: canonical receipt reducer, Pyth transition verifier, or FeedClock state machine.
6. **A direct contribution** to official examples or documentation once the result is generalizable.

Tag Solana, Pyth, Anchor, Cloudflare, an RPC provider, or pump.fun only when the artifact genuinely exercises their component and gives their developers something concrete to inspect. Do not bundle every brand into every post.

Useful vocabulary for honest developer-facing writing: `deterministic settlement`, `source chronology`, `PriceUpdateV2`, `sponsored push feeds`, `permissionless crank`, `commit-reveal`, `replay-safe reducer`, `idempotency`, `durable projection`, `verifiable build`, `upgrade authority`, `failure injection`, `data provenance`, `liveness`, and `refutation`.

## Budget discipline

The user’s SOL should not be consumed to compensate for uncertainty.

- local tests and devnet first;
- use free sponsored Pyth accounts and free capture tiers while measured capacity is sufficient;
- no paid Hermes dependency for the primary path;
- estimate mainnet rent and fees from the final artifact before signing;
- retain gas and recovery reserve;
- never send, deploy, upgrade, close, transfer authority, or freeze without the user seeing the exact transaction purpose and cost;
- do not redeploy merely to generate attention.

The existing mainnet program already proves deployment competence. The next attention-worthy event is a stronger referee with public evidence, not another address.

## Parked until the core gates pass

- elegant platinum/green casino redesign;
- CoinGecko/CMC/listing work, DEX, Telegram, X setup;
- buy bots and announcement automation;
- vault and redeemable floor;
- player passport production rollout;
- general agent frameworks and Hermes/OpenClaw adapters;
- weekly/monthly economy redesign;
- large codebase refactor;
- new token mechanics.

These are not rejected. They are sequenced behind truth, settlement, and unattended operation.

## Decision ledger from the build history

This prevents future sessions from reopening settled questions without new evidence.

- `ratchetx.xyz`, DNS, TLS, Vercel, DEX metadata, X article, and Telegram setup are done or parked.
- Current focus is game mechanics, Solana technology, oracle truth, and reliability.
- Production is not laptop-dependent. Vercel, Supabase, Cloudflare, Solana, and Pyth are the live dependencies.
- Pyth sponsored push accounts are the free primary path. Hermes is optional fallback/research, not a required paid dependency for current settlement.
- Server settlement is canonical today. Mainnet Seal v2 is optional beta.
- The mainnet program is upgradeable during soak and holds no player funds.
- There is no vault and the floor is not redeemable.
- Every non-void settlement earns 1 basic XP.
- Weekly rank remains; daily podium is dynamic; all-time is record-only.
- Agent framework integrations are later; agent system actions should not appear as player killfeed events.
- UI direction is an elegant, ordered, green/platinum casino, after correctness stabilization.
- Historical gap `#345` remains visible and must never be rewritten as gapless.
- Proof and copy must distinguish source data, server decision, on-chain receipt, and modeled value.

## Definition of readiness for a canonical on-chain referee

All must be true:

- one published truth-plane matrix and no contradictory copy;
- 72-hour unattended capture gate passed;
- canonical source chronology, no synthetic crossing;
- retention proof covers every enabled window;
- every on-chain state has a terminal cleanup path;
- v1/v2/v3 commitment versions verify from one library;
- end-to-end browser lifecycle passes on devnet and a restricted mainnet cohort;
- deployed bytes match a reproducible published artifact;
- IDL and `security.txt` are published;
- upgrade authority policy and exact holder are public;
- external review findings are public;
- old sealed shots retain old rules across upgrades;
- rollback stops only new entry and never blocks exit/cleanup;
- UI updates settled chambers and ranks without manual refresh;
- Proof exposes capture duty, anchor freshness, authority, and current canonical settlement plane;
- no hidden paid API dependency;
- no user funds are spent without an explicit wallet signature.

## Official references re-checked for this audit

- Solana program deployment, authority, immutability, program metadata: https://solana.com/docs/programs/deploying
- Solana program execution and deployment visibility: https://solana.com/docs/core/programs/program-execution
- Canonical IDL and `security.txt` publication: https://idl.solana.com/docs
- Pyth Solana `PriceUpdateV2`, account ownership, freshness, and sponsored price-feed accounts: https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana
- Pyth sponsored push feed limitations and price-pusher recommendation: https://docs.pyth.network/price-feeds/core/push-feeds
- Pyth Hermes role and authentication status: https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes
- Cloudflare Worker and Cron duration limits: https://developers.cloudflare.com/workers/platform/limits/
- Supabase RLS, grants, and `SECURITY DEFINER` guidance: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/database/functions

## Immediate next move

Do **Phase A only**. It is the smallest step that raises truth, tests, and public credibility without touching economics or risking another mainnet deployment. Then run Phase B unchanged for 72 hours. The result of that run decides the next engineering task.

