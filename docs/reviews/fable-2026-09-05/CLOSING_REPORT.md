# Closing report — what is proven, what is open, and who owns each remaining decision

Fable, 2026-09-05 09:5xZ. Consolidates the night's work. Everything below was measured read-only from public endpoints and from the repository's own source; no release source, Cargo or candidate file was touched, no chain transaction was sent, and no API key was used or bought at any point.

## 1. The one-sentence story

The strict bracket — the rule we abandoned first, the only one with no candidate choice — was never a bad rule; it was a bad **delivery channel**, and reading Pyth's own accumulator instead of its sponsored pusher makes it 100 % available to anyone with a VPS and no key.

## 2. Proven, with receipts

| claim | evidence |
| --- | --- |
| Keyless replay is constructible end to end | root recomputed from the PAS1 ring equals the guardian-signed VAA root on independent slots (312584373, 312584807, and every sampled slot since); Sol reproduced it on a third slot and a second endpoint |
| Leaf proofs verify | SOL/BTC/ETH leaves extracted with 13-node proofs, each folding to the signed root |
| The update envelope is byte-correct | `envelope_check.js` 15/15 against `pythnet-sdk 3.0.0` read from the laptop's own cargo registry — magic, versions, `PrefixedVec<u16,u8>`, u8 sequence lengths, u8 enum variant, big-endian, every byte consumed |
| The strict bracket is available | 7 feeds × 100 % of target seconds, root-verified, deduped; sponsored channel gave 0/25 for the same rule |
| **The bracket message is unique on mainnet** | 120 root-verified slots, 4 feeds: **53 bracket keys per feed, 0 with multiple messages** |
| The rail is alive and is the one Pyth uses | guardian set 7 current on Solana with 19 keys; live tx `GDnPFQPb…` at slot 444487149 ran `WriteEncodedVaa → VerifyEncodedVaaV1` (83,598 CU) → `PostUpdate` (14,924 CU) and produced the Full 134-byte account |
| Only archiving is funded | `state.rs:82-83`, `lib.rs:3666/3729-3730/3741-3757`, `TimepinNeedV2` has no lamport and no submitter field, `lifecycle.rs:774` is Timepin's only transfer |

## 3. Two findings that change parameters

**A. `max_pre_target_gap_seconds = 1` has zero margin.** Measured pre-gap is always exactly 1, so the pin sits on the observed value; one skipped Pythnet aggregate voids the target. `test_pre_gap.mjs` G4 proves raising it can never admit a second message at any bound — the pin carries no safety duty — while G3 shows one skip per 7 s voids 14.3 % of targets at 1 and 0 % at 5. **Raise to ≥ 5.** I proposed the 1; it was wrong.

**B. The strict `<` in `prev < T` is load-bearing, and must not be relaxed.** The uniqueness run found **20 of 98 keys carry up to 3 distinct signed messages** — all of them intra-second repeats where `pub == prev`. The strict inequality on the left is exactly what excludes them. Loosening it to `prev ≤ T` would admit up to three different signed prices for one target and hand back the chooser we just eliminated. This is worth stating loudly because widening the *gap* bound (A, safe and proved) and relaxing the *inequality* (unsafe) both read as "loosening the bracket" and are opposite in effect.

## 4. Economics, bound to the ledger

Only the archiver is paid. Posting the evidence the whole game depends on is unfunded, and the real cost is **lower than I estimated**: 2 transactions, ~120,000 CU total, ~10,000–15,000 lamports plus priority — not the ~45,000 I modelled from a 5-signature guess.

The minimal honest wire remains: split the player's existing `cleanup_bond` into `archive_bond` + `settlement_bond`, add one `winner_submitter: Pubkey` field, pay at settle. No purse, no house money, solvency structural (`test_settlement_economy.mjs` E1/E2). Sol's refined two-fact version (entry + exit, `evidence_bond_lamports`, escrow `cleanup + 2 × evidence`) is the right generalisation; my accounting review of it is the open item I owe him.

Silence pays only the losing side (millions), breaking it pays a stranger (~200,000 at the earlier cost estimate, more favourable now). That asymmetry — not outbidding — is what defeats withholding, and it only works if the settlement wire exists.

## 5. Open, with owners

| item | owner | note |
| --- | --- | --- |
| Two-fact accounting + WorkPage coexistence review of Sol's refined wire | **me, next** | assigned 09:21Z |
| Devnet `post_update` acceptance and final CU/rent | Sol | my live-mainnet CU numbers should shorten this |
| Whether the 26-Aug router upgrade affects our path | Sol, with my 09:39Z counter-evidence | the live sponsor path still verifies a guardian-set-7 VAA |
| Adversarial veto on the settlement wire and generic-replay surface | Astra | |
| `P(G2)` emission-gap rate, ring staleness, confidence stress percentile | soak running on the PC | `gate_soak_status.json`; 0 gaps, 0 root mismatches so far |
| `max_confidence_bps` sizing | Semir, on measured data | it is a void switch, not a quality filter |
| `min_stake` vs posting fee, bond split, `migration_id` | Semir | all tagged D; no agent may set them |
| The client `p_bps` guard Codex found (reject 0/10000/65535) | Astra/Sol | independent of everything above |

## 6. My own corrections, collected

I got four things wrong tonight and each is superseded in place: "H1 needs a paid key" (withdrawn — knowledge was always keyless); "the ring write has not landed" (wrong cause — the RPC head lags the ring, not the reverse); `max_pre_target_gap = 1` (mine, wrong, raise it); and recommending VOID+refund before checking who funds the poster (the ledger funds nobody). My first soak also double-counted its windows; the figure I published was the correct independent one, and the replacement counts each `(feed, second)` once by construction.

Nothing here is a build GO. Sol's SBF/value-mainnet STOP stands, and every number that matters is either measured with a receipt or marked as needing a decision from Semir.
