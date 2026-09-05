# The road to live — mainnet, site, Bankr

**Opened 2026-09-05 by Opus Lead.** This is the ordered sequence, not a wish list.
`docs/ROAD_TO_MAINNET.md` holds the history and the reasoning; this holds the steps.

**One rule governs the whole file:** a phase is finished when a **gate row** or a
**named artifact** says so. Not when somebody reports it. Six false greens were found
on 2026-09-05 by people reading each other's work, and three of them were the lead's.

Run the gate, never read it: `node tools/mainnet-go-check.mjs`. It answers NO by default.

---

## Where we are

**Gate: 4 of 21 blocking.** Green: C1 C2 R1 R2 R3 M1 M2 M3 P1 P2 S1 S2 S3 I1 I2 B3 X1.
Open: **B1 B2 L1 L2**.

Core 29/29, Timepin 28/28, both receipts hash-bound to the source that produced them.
Program identity settled by measurement, not memory: the keypair file at
`onchain/ratchet-core-g2/target/deploy/ratchet_core_g2-keypair.json` derives to
`ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL` (`c62a9d7`, public keys only).

**P1 is signed.** The owner's words are in the manifest verbatim. It authorises the
economy; it does **not** authorise the first mainnet transaction, which is a separate
sentence he has not yet said.

---

## Phase 1 — the build · owner CodexAstra · exit: **B1 and B2 green**

Everything else waits on this and nothing else does.

| # | task | done when |
|---|---|---|
| 1.1 | `cargo build-sbf --arch v3 --tools-version v1.56 -- --locked`, both crates | two `.so` newer than every source file |
| 1.2 | `verify-artifact` at `EXPECT_SBPF=3`, `FORBID_PROGRAM_IDS=US517…` | PASS for both, `US517` zero occurrences |
| 1.3 | State the toolchain version **in the receipt** | receipt names 4.3.0 / v1.56, not 4.1.0 / v1.54 |
| 1.4 | Regenerate golden vectors **from** the artifact | `repin-timepin-vectors --check` exit 0 → **B2** |

**Known open risk, already measured:** cross-platform ELF differences. A build that is
not reproducible on a second machine is a build nobody can audit. Decide before mainnet
whether the canonical artifact is one machine's output or a reproducible one, and write
which in the receipt.

---

## Phase 2 — devnet, the first real transaction · owner lead + CodexAstra · exit: **L1 and L2 green**

| # | task | done when |
|---|---|---|
| 2.1 | Deploy both artifacts to **devnet** | two program accounts, executable, readback through two RPCs |
| 2.2 | Register the evidence spec and the economy on devnet | `register_evidence_spec` + `register_economy` signatures |
| 2.3 | Implement `readState` in `ops/g2-crank/crank.mjs` | it throws today, on purpose; account layouts confirmed against the deployed program |
| 2.4 | Seal one shot from the client | a devnet signature → **L1** |
| 2.5 | Run the crank until that shot settles | `capture_first` → `finalize` → `settle_final` signatures → **L2** |
| 2.6 | The negative paths, deliberately | a missed capture that voids and refunds; a shot settled across midnight; a forfeit at the deadline |
| 2.7 | Run the exact-SBF suite against the real pair | 16 of 16 |

**Do not skip 2.6.** Every defect found today was in a path nobody had exercised:
settlement on zeros, a shot stranded across midnight, a day closed mid-day, a later
oracle print cancelling a round.

---

## Phase 3 — the site · owner site lead · exit: **a stranger completes a shot in a browser**

**The site is DOWN right now.** `ratchetx.xyz/api/game?action=state` returns
`{"ok":false,"reason":"kv 400: ERR max requests limit exceeded. Limit: 500000, Usage: 500000"}`.
Upstash's request allowance is exhausted, so the legacy game state is unreachable.

| # | task | done when |
|---|---|---|
| 3.1 | Restore `/api/game` | 200 with real state, and a quota headroom number written down |
| 3.2 | The public proof is current | payload age under one hour, not 26 |
| 3.3 | Point the page at **G2**, not the legacy server | `index.html:921` no longer `const API='/api/game'` for shot flow |
| 3.4 | Wallet signs the seal in the browser | a devnet signature from a fresh browser profile |
| 3.5 | The page tells the truth about what is live | no text describing the legacy machine as the game |

**3.1 is a dependency, not a nicety:** while the quota is exhausted the site cannot serve
anybody, so nothing downstream of it can be demonstrated.

---

## Phase 4 — Bankr and the agent surface · owner GeminiForge · exit: **a shot taken through the agent path, with a receipt**

Today the honest position is written in the docs already: an agent shot counts as
**Bankr** only with an operator-provided Bankr receipt; a `ratchet_demo_shot` MCP call is
labelled **MCP client**, because transport does not prove identity.

| # | task | done when |
|---|---|---|
| 4.1 | MCP path takes a real G2 shot on devnet | signature, labelled MCP client |
| 4.2 | Bankr command conflict closed out | the closeout doc names the resolution, not the conflict |
| 4.3 | One Bankr-originated shot with a receipt | the receipt exists and is quoted |

---

## Phase 5 — mainnet · owner Semir · exit: **the first transaction, in his own words**

| # | task | done when |
|---|---|---|
| 5.1 | Gate green: **21 of 21** | `node tools/mainnet-go-check.mjs` exits 0 |
| 5.2 | Deploy both artifacts to mainnet | readback through two RPCs, identities match the manifest |
| 5.3 | Register spec, economy and rulesets | hashes match the manifest byte for byte |
| 5.4 | First real shot | sealed and settled on mainnet |
| 5.5 | Publish the record | program ids, economy hash, authority status |

**No agent performs 5.2 through 5.4.** The crank refuses mainnet in code — it checks the
genesis hash before it builds anything and there is no flag that disables it. The first
mainnet transaction needs Semir, explicitly, in his own words, from a tool that is not
the crank.

---

## The five rules this project paid for today

1. **Silence is never a pass.** A file that could not be read, a comparison that never
   happened, a grep that timed out — all count against. The gate's P2 row compared zero
   pairs across seven feeds and printed GO all day.
2. **Test the property, not the presence of the fix.** Three rows died to this: a fix was
   present and the property it existed for was never checked.
3. **Read the crate, not one file.** Three tools answered questions about a crate from
   `lib.rs` alone. One produced a false P0 that sent the ABI down a branch which would
   have settled every shot on zeros.
4. **A checksum satisfiable two ways is not a check.** A byte layout summed to exactly
   the program's constant with every field shifted one over.
5. **Prove it red before believing it green.** Every test landed today was mutated first
   and watched to fail.
