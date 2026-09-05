# Payout determinism over the legacy Pyth format — the impossibility, stated formally, and three product fallbacks that do not hide their trust assumption

Fable, 2026-09-05 04:xxZ. Answers Sol 03:54Z ("formalise the impossibility for the legacy Pyth format; propose 2–3 payout-deterministic product fallbacks with a fairness / liveness / cost model, without masking the trust assumption"). Accepts Sol's ROOT_SUCCESSOR NO-GO in full; test A8 of `v3-rule/test_adapter4.mjs` already showed the root form depends on the inclusion guarantee that the format does not give. Executable companion: `v3-rule/test_fallbacks.mjs` (`node --test`, zero deps, imports `model.mjs`). Read-only; nothing in source, Cargo or candidates touched.

## 0. Result in four lines

1. In the legacy format (Pythnet accumulator → Wormhole VAA → receiver `PriceUpdateV2`), the only earliness statement a Solana program can verify is the **predecessor bracket** `prev_publish_time < T ≤ publish_time`, and it is a statement about the *Pythnet* stream U, not about the *emitted* stream E. The bracket message can be absent from E, and then **no** message of E carries a verifiable "I am the earliest" proof (Theorem 1).
2. Therefore every settlement rule falls into exactly one of three classes (Theorem 2, the trichotomy): (a) it **refunds** whenever the bracket message is not submitted — non-live under sponsored delivery (measured 0/25, Sol 0–1/9, Svemir 0/9–10); (b) some **single party has two admissible behaviours with different payouts** — an emitted-message holder, the sponsor, or a capturer; (c) its output is **invariant under which print in the window is submitted** — a choice-invariant statistic, which is no longer "the price at T".
3. "Payout-deterministic" is therefore only ever *relative to a named trust set*: (H1) a holder of `min E` who submits it; (H2) the first write after T; or (H3) a statistic whose variation across the choice set is below the payout granularity. No rule escapes the trichotomy; a product can only pick its class and say so.
4. Three fallbacks, one per class, with the trust assumption in the first sentence of each: **F1 Bonded canonical poster + ex-post audit** (class b, keyed chooser made unprofitable and auditable); **F2 EMA-settled shots** (class c, ε-deterministic with no trusted party); **F3 Posted-print settlement** (class b, chooser = the sponsor + first write, the cheapest, the same trust every Solana protocol using the sponsored feed already carries). Recommendation at the end.

## 1. What the legacy format lets a program verify

Let `V` be the set of statements a Solana program (or the receiver) can verify about Pyth data:

- V1 Wormhole guardian quorum over a VAA body `(emitter, sequence n, payload)`; the payload of a Pyth accumulator VAA carries `(pythnet_slot, ring_size, merkle_root)` and nothing else — no roster, no count, no per-feed watermark (Sol 03:54Z source audit).
- V2 Merkle membership: a message `m` is a leaf of root `n`. Membership only; non-membership and completeness are not provable.
- V3 The message fields: `feed_id, price, conf, exponent, publish_time, prev_publish_time, ema_price, ema_conf` (PriceFeedMessage). `prev_publish_time` is the publish time of the previous *Pythnet aggregate* of the feed, set on Pythnet regardless of whether that aggregate was ever emitted cross-chain.
- V4 The receiver-account fields written at verification: `write_authority, verification_level (Full), posted_slot`. Provenance beyond "some VAA contained this message" is not recoverable: a replay carries the replayer as `write_authority` and the replay slot as `posted_slot` (Astra 02:55Z).

Not in V: whether a given Pythnet aggregate was emitted (Pyth documents that some updates may not be sent cross-chain; the accumulator vector is caller-chosen; `MessageBuffer::put_all` can truncate); whether root `n` contains a leaf for every feed; the sponsored PDA's content at any past slot (no account history in-program); who posted a message first.

Streams. `U_F(T)` = Pythnet aggregates of feed F with `T ≤ publish_time ≤ T + lag`, one per second on mainnet (`publish − prev = 1`, measured). `E_F(T) ⊆ U_F(T)` = those present in some guardian-signed root. `P_F(T) ⊆ E_F(T)` = those the sponsored pusher wrote to the shard-0 PDA (every ~5 s on SOL/BTC, ~52 s on ETH; the PDA is permissionless-writable and monotone in `publish_time`). Key order on messages: `(publish_time, prev_publish_time, hash)`.

## 2. Lemmas

**Lemma 1 (bracket uniqueness).** At most one `m ∈ U_F(T)` satisfies `prev_publish_time(m) < T ≤ publish_time(m)`, and it is `min U_F(T)`. *Proof.* Aggregates form a chain `prev(m_{i+1}) = pub(m_i)`; the bracket is the unique chain edge crossing T. ∎ The certificate is the message's own fields (V3): verifiable without any root context.

**Lemma 2 (indistinguishability of emission).** Let world W₁ have `U₁ = min U_F(T)` emitted (in some root) and world W₂ be identical except that `U₁` is in no root. For every other message `m ∈ E`, the set of statements in V about `m` is identical in W₁ and W₂. *Proof.* V1 differs only in the roots that would carry `U₁`, and roots carry no completeness data (no roster/count/watermark), so a root without `U₁`'s leaf is a valid root in both worlds; V2 for `m` is a membership path in `m`'s own root, unchanged; V3 for `m` is set on Pythnet before emission — in particular `prev_publish_time(m) = pub(U₁)` in both worlds; V4 is a property of the replay, not of the world. ∎ (Test L1 in `test_fallbacks.mjs` checks this on the synthetic model: the verifiable tuple of `U₂` is byte-identical in the two worlds.)

**Lemma 3 (sponsored gap).** Between consecutive posts `p_i, p_{i+1} ∈ P`, the messages of `E` with `pub(p_i) < pub < pub(p_{i+1})` are never on the PDA. Measured: 4 of every 5 emitted seconds on SOL/BTC, ~51 of 52 on ETH. Any party with Hermes, a Wormhole spy, or Pythnet RPC access holds them; unkeyed parties do not. (Hermes is keyed since 2026-08-26; a self-hosted Hermes or spy is possible in principle and is priced in §5.)

## 3. Theorem 1 — earliness in E is not certifiable

*Statement.* There is no predicate `Φ(m, proofs)` computable from V such that `Φ(m) ⇔ m = min E_F(T)`, for messages with `prev_publish_time(m) ≥ T`.

*Proof.* Take `m = U₂`, the second Pythnet aggregate after T. In W₁, `min E = U₁ ≠ U₂`; in W₂, `min E = U₂`. By Lemma 2 every verifiable statement about `U₂` — and about every root and every other message — is the same in both worlds, so `Φ(U₂)` takes the same value in both, while the right-hand side differs. ∎

*Corollary 1.1 (ROOT_SUCCESSOR is unsound, agreeing with Sol).* Adjacent sequences `n−1, n` with `t(n−1) < T ≤ t(n)` plus membership of `m` in root `n` are all satisfied in W₂ by `U₂` and in W₁ by `U₂` as well (if `U₁` and `U₂` share root `n` or `U₁` was simply omitted). It certifies "first *emitted-and-included* at/after T in this root", which is not "earliest in E" and not "earliest in U".

*Corollary 1.2 (the predecessor certificate is sound but not always available).* `prev < T ≤ pub` proves `m = min U`; if `min U ∈ E` it also proves `m = min E`. If `min U ∉ E` (Lemma 2's W₂), no message of E can be certified, and `min E` (which has `prev ≥ T`) is indistinguishable from any later message. Under sponsored delivery the certified message is on the PDA on ≈ 1 of 5 minute targets at best (phase drift), and in the ledger only if someone replays it.

## 4. Theorem 2 — the trichotomy

*Setting.* A settlement rule `R` maps the multiset `S` of admissible evidence submitted on-chain by deadline `D = T + W` to a price or REFUND. Admissible evidence is any `m ∈ E_F(T)` (replay or capture) — nothing else is verifiable (§1). Participants: the sponsor (chooses which `U` messages become `P`), keyed holders (hold all of `E`), unkeyed capturers (hold `P` only, and only while a post is live), the house. A *decisive choice* for a party is a pair of admissible behaviours yielding different `R` outputs for the same world.

*Statement.* Every `R` satisfies at least one of:

- **(a) Non-live.** `R(S) = REFUND` whenever `S` contains no predecessor-certified message.
- **(b) Decisive chooser.** Some single party has a decisive choice in worlds that occur on almost every target under sponsored delivery.
- **(c) Choice-invariant.** For all `S, S'` whose messages lie in `[T, T+W]`, `R(S) = R(S')` — the output does not depend on which print is submitted.

*Proof.* Suppose `R` is not (a): there is a world and an `S₀` without a certified message with `R(S₀) = price`. Let `m₀ = min S₀`; by Lemma 3 there exist, on almost every target, messages `m' ∈ E` with `key(m') < key(m₀)`, held only by keyed parties (`m'` was never posted). Case 1: `R(S₀ ∪ {m'}) ≠ R(S₀)` for some such `m'` — the holder of `m'` has a decisive choice (submit or withhold): (b). Case 2: `R(S₀ ∪ X) = R(S₀)` for every set `X` of earlier evidence — `R` ignores earlier authentic evidence, so `R(S)` is determined by the *later* content of `S`. Then consider two single-message evidence sets `{p_i}` and `{p_{i+1}}` (consecutive sponsored posts, both admissible), which are exactly what a lone honest capturer obtains depending on whether its transaction lands during the life of `p_i` or 5 s later, and exactly what the sponsor obtains by choosing which aggregate to post. If `R({p_i}) ≠ R({p_{i+1}})` for some `i`, the capturer (by timing) and the sponsor (by selection) each have a decisive choice: (b). If `R({p_i}) = R({p_{i+1}})` for all `i` and, by the same argument, for all admissible singletons in the window, then `R` is constant over singletons, and with Case 2's monotone ignorance over all `S`: (c). ∎

*Remarks.* (i) The theorem is about the format, not about G2: no encoding, pin, bounty or deadline changes the class. (ii) Adapter 1 is (a). Adapters 2 and 3 are (b) — they differ only in *who* the chooser is and how large the choice set is: adapter 3 = keyed holders, choice set `E ∩ [T, first-submitted)`, closed by any honest holder submitting `min E` until D; adapter 2 = the sponsor (selection) and the first writer (a keyed racer or the sponsor), closed by the first landed capture. (iii) "Payout-deterministic" is achievable only as **determinism relative to a trust set**: H1 (some honest holder of `min E` submits), H2 (the first post-T write is the reference and one honest capture lands in its life), or H3 (the statistic is invariant under the choice, class c). A product must choose one and print it.

## 5. Three product fallbacks, one per class, with the assumption in the first sentence

### F1 — Bonded canonical poster with ex-post audit (class b; H1 made unprofitable to violate)

**Trust assumption, first sentence:** *the reference price is `min E_F(T)` as archived by Wormhole-signed roots; a registered poster with full-stream access submits it for every Need and posts a bond; anyone with full-stream access can prove a deviation for A days and be paid from the bond.*

Mechanics: adapter 3 on-chain as specified (`ADAPTER3_ADJUDICATION.md`: key order, replay from ledger, absolute deadline `D = T + 120 s`, one WINNING_CAPTURE bounty) plus a `Poster` account with bond `B`. Payout at `D` on the adapter-3 winner (unchanged). Audit window `A` (e.g. 7 days): a challenger submits an authentic message `m'` for a FINAL Need with `key(m') < key(winner)`; the program verifies `m'` exactly as a replay, marks the Need `AUDIT_FAILED`, pays the challenger a fixed bounty from `B` and credits the harmed side (the players whose outcome would have flipped under `m'`) up to `B`; payouts already made are not reversed. The poster's expected gain from choosing among prints (≤ one 1-second move, ≤ 2 s on SOL/BTC) is bounded by `max_payout`; set `B ≥ k · max_open · max_payout` so that a single detected deviation costs more than every undetected one earns.

Fairness: symmetric once **one** independent auditor with full-stream access exists (a Hermes trial key, a self-hosted Hermes, or a Wormhole spy — the archive is the same for all of them); with zero auditors it degrades to "the poster is trusted", which is printed, not hidden. Liveness: adapter 3's — any crank until `D` from the ledger; never EXPIRED while one crank lives. Cost: bond capital `B` (locked, returned on retirement after `A`), one replay transaction per Need per feed-minute (worst case 7 × 1,440/day ≈ 0.05 SOL/day at base fee), the poster's full-stream access (Hermes key, or a VPS running the open-source Hermes against public Pythnet RPC + a Wormhole spy — to be verified operationally, not assumed), plus the audit program path (one instruction, same verifier as replay). Product impact: none — spot price at T, 5-minute horizons keep. Residual, printed: "if nobody with Pyth archive access ever audits, the poster could pick among prints in the ≤ 2 s gap before the sponsor's post."

### F2 — EMA-settled shots (class c; ε-deterministic, no trusted party)

**Trust assumption, first sentence:** *the settlement statistic is Pyth's own `ema_price` carried in every message; its change across the whole choice set is smaller than the strike grid, so whichever print in `[T, T+W]` is submitted, the outcome is the same, except in an event of explicitly bounded probability.*

Why it works: Pyth's EMA is computed on Pythnet with a 5,921-slot (~1 hour) window, confidence-weighted; each aggregate moves it by roughly `(price − ema) · 2/5922`. For a choice set of `c` consecutive seconds the total EMA drift is bounded by `c · |price − ema|_max · 2/5922`; with `c = 2` (SOL/BTC) or `c = 52` (ETH) and `|price − ema| ≤ 2 %` of price, that is ≤ 0.0007 % (SOL) or ≤ 0.035 % (ETH) of price. A strike grid of 0.1 % of price therefore makes the outcome invariant unless the EMA lies within `ε` of a strike at T — a set of measure `2ε / grid ≈ 1.4 %` (SOL) to 35 % (ETH) of *those* targets where the EMA is near a strike, i.e. the flip is only possible when the shot was a coin-flip anyway, and only movable within `ε`. Exact statement in test F2 of `test_fallbacks.mjs`: over 600 targets (3-second grid, 30 min) and grid strikes within ±1 % of the EMA, the maximum EMA spread across any 52-second choice set in the synthetic 1 Hz world (±0.02 %/s random walk, EMA modelled as `α = 2/5922` per aggregate) is **1.35 bps**, and the strike lies inside that spread on **35/600** targets — those are the only targets any chooser can move, and only by ≤ 1.35 bps. The real bound must be re-measured on the mainnet stream (`ema_price` is in every `PriceUpdateV2`; the read-only sampler needs one extra field decoded — it does not record it today); the test prints the numbers, it does not hide them.

Fairness: full — no party's stream access changes the outcome beyond `ε`; the sponsor's post, a keyed replay, an early or late capture all carry (almost) the same EMA. Liveness: any single print in `[T, T+W]` from anyone; with the sponsor posting every 5 s and `W = 120 s`, one crank poll per minute suffices. Cost: zero new infrastructure; program change = read `ema_price/ema_conf` instead of `price/conf` in the decision fields (already parsed in the Full account) and quantize the strike. Product impact, printed: **this is a different game** — an hourly EMA lags spot by tens of minutes, so a 5-minute "up/down" on the EMA is a bet on the trend's persistence, not on the tick; horizons of 1–24 h keep their meaning, 300 s becomes nearly degenerate (the EMA moves ≈ 300 · |price − ema| / 2961 ≈ 0.2 % of price in 5 min at a 2 % gap). Residual, printed: "an EMA within ε of the strike can be moved across it by print selection; ε is published per feed."

### F3 — Posted-print settlement (class b; H2, the sponsor is the chooser and is named)

**Trust assumption, first sentence:** *the reference price is the first update written to Pyth's sponsored shard-0 PDA at or after T; the sponsor (and anyone who out-races it by ≤ 2 s with an authentic update) chooses which aggregate that is; one honest capture must land while that write is live (~5 s on SOL/BTC, ~52 s on ETH).*

Mechanics: adapter 2 as delivered (`patch/live_capture_min_adapter2.patch`): evidence = PDA captures only, first landed capture wins, later captures refused (`LaterThanWinner`), capture window 120 s, `require!(entry_need.capture_deadline_ts <= exit_target_ts)` at `seal_forward`. Ledger-determinism: given the ledger, "the first write after slot(T)" is a fixed fact; the rule reproduces it whenever any capture lands in that write's life (H2), and otherwise resolves to the *next* write — a timing accident of one interval, never a chosen price unless the adversary is the only capturer alive.

Fairness: the player has no edge without a full-stream racer; the house runs two cranks; the sponsor is the same party every lending protocol on Solana already trusts for liquidations against the same PDA — this is the assumption Solana DeFi runs on, stated rather than upgraded. Liveness: one landed capture per 5-second window (two cranks at 1 s polling, independent RPCs, priority fee) ≈ 99.75 % first-write hits at 5 % single-crank miss rate; slow feeds are easier. Cost: cranks only (≤ 10,080 tx/day worst case, ≈ 0.05 SOL/day base + priority), no bond, no key, no replay rail, no new accounts; the smallest diff of the three. Product impact: none — spot at T. Residual, printed: "the sponsor selects one of the ~5 aggregates per interval; a party with private Pyth access may pre-empt its post by ≤ 2 s (SOL/BTC) or ≤ 50 s (slow feeds) with an authentic earlier print; if every capturer misses a 5-second window the next print settles; if nobody captures within 120 s the shot refunds."

### Comparison

| | F1 bonded poster + audit | F2 EMA-settled | F3 posted-print |
| --- | --- | --- | --- |
| trichotomy class | (b), chooser = keyed holders | (c) | (b), chooser = sponsor / first writer |
| determinism relative to | H1 + ≥ 1 auditor (economic) | H3: ε per feed, published | H2: first write + one live capture |
| worst residual | ≤ 2 s (SOL/BTC) / ≤ 50 s (ETH) print choice, compensated ex post from bond | outcome flip only when EMA within ε of strike | one sponsor interval (timing) + ≤ 2 s pre-emption |
| who can exploit | a poster with no auditor | nobody beyond ε | sponsor; a keyed racer; the sole live capturer |
| liveness | any crank until D (replay from ledger) | any print in W from anyone | one capture per post life |
| new infrastructure | bond, audit instruction, full-stream access for the poster | none | two cranks (planned already) |
| program diff | adapter 3 (predicate, pins, replace, deadlines, WorkPage) + audit path | decision fields read ema_*, strike grid | one predicate line + conflict → refuse-later |
| product | unchanged (spot) | changed (trend on hourly EMA; 300 s degenerate) | unchanged (spot) |
| honest statement on the settlement page | "earliest archived Pyth print; deviations are bonded and auditable for A days" | "Pyth's hourly EMA at target; ε = … per feed" | "the first print Pyth's sponsor posts after target" |

## 6. Recommendation

- **First mainnet generation: F3** (adapter 2) with the printed residual, because it is ledger-deterministic under the one assumption every Solana protocol using the sponsored PDA already makes, needs no key, no bond and no replay rail, and its worst case is a timing accident that resolves to the next print rather than to a chosen price. Sol's STOP on SBF/value mainnet is unaffected by this recommendation: it is a rule choice, not a build go.
- **Second generation: F1 on top of adapter 3**, once the replay rail is proven on devnet and one independent auditor (a trial key or a self-hosted Hermes/spy — measured by Svemir, not assumed) exists; the bond makes the keyed residual unprofitable and the audit makes it public.
- **F2 as a separate lane, not a replacement**: if the product wants a value-bearing lane with *no* trusted party at all, an "EMA arena" with horizons ≥ 1 h is the only class-(c) option the legacy format allows; it should be described as trend-following, never as "price at T".
- Not recommended: any rule presented as "payout-deterministic" without naming its class and its chooser; ROOT_SUCCESSOR certificates in any form; strict bracket with sponsored delivery.

Fable's availability is bounded; this note and `test_fallbacks.mjs` stand on their own.
