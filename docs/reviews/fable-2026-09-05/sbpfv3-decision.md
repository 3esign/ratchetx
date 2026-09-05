# SBPFv3 decision — Fable, 2026-09-05 (go/no-go for the C8 release generation)

Requested by Sol (ROOM 23:06Z): establish from authoritative current evidence (a) mainnet/devnet feature activation, (b) whether the C8 mainnet candidate must be SBPFv3 for longevity, (c) LiteSVM/runtime compatibility, (d) the exact reproducible tuple; return go/no-go plus a counterexample; adjudicate whether unchanged Core must be rebuilt under `--arch v3`. No build, no network transaction was made.

## Verdict: GO — build the entire C8 generation (Timepin C8ww, Core G2, Work Market v2) as SBPFv3

### Evidence (fetched 2026-09-05, sources at the end)
1. **SBPFv3 is live on mainnet-beta.** `enable_sbpf_v3_deployment_and_execution` = `5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC` is listed in LiteSVM's `MAINNET_ACTIVE_FEATURES` (cluster snapshot dated **2026-07-29**) with activation slot **428,976,000**; v1 at 349,488,000 and v2 at 356,400,000. Today's mainnet slot is ~444.3M (our own Pyth fixture snapshot slot 444,338,968), i.e. v3 has been active for ~15M slots. Helius: "the Agave 4.0 release cycle includes a feature gate that enables the deployment and execution of SBPFv3 programs" (SIMD-0178 static syscalls, SIMD-0189 stricter ELF headers, SIMD-0377 eBPF ISA compatibility). Mainnet version floor: **Agave v4.0.2**.
2. **SIMD-0500 blocks *deployment*, not execution.** The feature is named `disable_sbpf_v0_v1_v2_deployment` = `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`. cargo-build-sbf README: *"The deployment of SBPF versions v0, v1 and v2 is going to be blocked once SIMD-500 is activated. It is scheduled for activation in Agave v4.3."* It is not yet on the mainnet pending schedule (12 pending gates listed, none SBPF). Disabling v0 *execution* exists in agave only as test scaffolding (`disable_sbpf_v0_execution` = `TestFeature1111…`, `reenable_sbpf_v0_execution` = `TestFeature2111…`) — no real gate. => Already-deployed v0 programs (Seal v2 on mainnet, next-print-v2 on devnet) keep executing; what dies at 4.3 is any *new deploy or upgrade* of a v0/v1/v2 ELF.
3. **Toolchain facts.** platform-tools README: *"v1.52 shipped without support for `sbpfv3-solana-solana`"*; *"v1.53 and onward ship the correct `sbpfv3-solana-solana` target"*; cargo-build-sbf README: *"Platform tools v1.53 (minimum), v1.56 (recommended) … v1.56 brings important bug fixes"*. cargo-build-sbf versions: 4.0.0 (2026-02-13), 4.1.0 (05-20), 4.2.0 (08-20), **4.3.0 (2026-09-03)**. Pin with `[package.metadata.solana] tools-version = "v1.56"` (also accepted at `[workspace.metadata.solana]`). Agave changelog v2.3.0: `--arch` accepts `v0|v1|v2|v3`; target triple `sbpfv3-solana-solana`.
4. **Our artifacts are v0.** Independently measured: `tools/verify-artifact.mjs` now reads ELF `e_flags`; historical Timepin `8d913a5d…` reports `e_flags=0x0 -> sbpf v0` (agrees with Sol's `llvm-readelf` on both Timepin and Core `4f652aeb…`).
5. **Harness compatibility.** `LiteSVM::new()` = `default().into_basic()` -> `with_mainnet_features()` -> `MAINNET_ACTIVE_FEATURES`. Our pinned `litesvm = "=0.16.0"` (2026-08-24) carries the 2026-07-29 snapshot that already contains the v3 gate, and depends on `agave-feature-set/program-runtime ^4.2.1`. => the existing exact-SBF harness will load and execute SBPFv3 ELFs without any code change. (If it ever did not, the fix is `with_feature_set` — but no change is needed.)

### Why v3 and not "v0 now, decide later"
- **Longevity is the product.** A permanent, immutable program must not depend on winning a race against a feature gate. The P3→P6→P7→P10 sequence (devnet drills, possible redeploys, 72h window, mainnet generation, separately authorized freeze) spans weeks; SIMD-0500 activates in the 4.3 cycle and devnet typically activates before mainnet. A v0 pipeline can die mid-sequence.
- **Zero compatibility cost today.** v3 executes on mainnet (slot 428,976,000) and in our pinned LiteSVM.
- **The old reproducible contract is dead anyway.** Agave 3.1.10 / platform-tools 1.52 / default v0 cannot build v3 at all (1.52 lacks the target). The reproducible tuple must change; change it once, to v3.

### Adjudication: rebuild unchanged Core under `--arch v3`? — YES, in the same generation
Sol's distinction is the right one: *current deployability* (v0 deploys fine today) vs *long-term deploy/upgrade safety* (v0 becomes undeployable at 4.3). Reasons to rebuild Core now:
1. The C8ww Timepin already forces a new Economy/Ruleset generation and a full reproof of Core (coupled-chain proof, docs/reviews/fable-2026-09-05/coupled-chain-proof.md). Core's hash is being re-locked regardless; a v3 rebuild adds one build and no additional proof burden.
2. A mixed generation (Timepin v3 + Core v0) creates an asymmetric reproducible tuple and a Core that cannot be redeployed to devnet after 4.3 activates there.
3. Source identity is preserved: the source is unchanged; only the target ISA changes. Provenance = source hash + toolchain tuple, not the old ELF hash.
Work Market v2 has the same logic: it is deployed after the immutable producers; build it v3 with the same tuple.

### Counterexample (what breaks if we stay on v0)
Let `disable_sbpf_v0_v1_v2_deployment` (B8JJ…) activate on devnet at epoch E_d and on mainnet at E_m during our sequence. Every `solana program deploy` / upgrade of a v0 artifact after E_d fails on devnet (the P6 drill or any redeploy breaks mid-window) and after E_m fails on mainnet (P7 impossible until a v3 rebuild + full reproof + new devnet cycle). With v3 there is no cliff: v3 deploy/execution is already active and is the format 4.3 keeps.

### The reproducible tuple to freeze (Sol's builder architecture)
| Field | Value | Note |
|---|---|---|
| cargo-build-sbf | **4.3.0** (2026-09-03) | native has 4.1; upgrade |
| platform-tools | **v1.56** (recommended by Anza; v1.53 minimum) | native has 1.54: acceptable but below the "important bug fixes" line — prefer 1.56 |
| arch | `--arch v3` | verify ELF `e_flags == 3` |
| tools-version pin | `[package.metadata.solana] tools-version = "v1.56"` in each program Cargo.toml | makes the tuple part of source |
| solana CLI | ≥ 4.0 (native 4.2.1) | record `solana --version` |
| anchor-lang | `=1.0.2` (unchanged) | build via `cargo build-sbf --arch v3` as CORE_G2_BUILD.cmd already does; if `anchor build` is used, confirm it forwards `--arch v3` |
| litesvm / solana-sdk | `=0.16.0` / `=4.0.1` (unchanged) | v3 gate present in its mainnet set |
| artifact gate | `EXPECT_SBPF=3 node tools/verify-artifact.mjs <so> <id> <sha> <size>` | PASS required before any pin/re-lock |
| provenance | `tools/repin-timepin-vectors.mjs` provenance.json + Sol's stdout/exit/target archive | record platform-tools tag + `cargo build-sbf --version` verbatim |

### Open items (not blockers for the build; blockers for the P9 proof tuple)
1. **Verifiable-build image — resolved to a recommendation (2026-09-05).** `solana-foundation/solana-verifiable-build` generates its images from the Agave release installer (`release.anza.xyz/{version}/install`, checksum-pinned, `rust@<digest>` base) and installs platform-tools by running `cargo build-sbf`, which honours the repo's `[package.metadata.solana] tools-version`. So pinning `tools-version = "v1.56"` in each program's Cargo.toml carries into the container. What the README does not document is an `--arch v3` pass-through to `solana-verify build`. Do not depend on it. **Recommendation for P9:** ship our own pinned `Dockerfile` in the provenance bundle (rust base by digest, Agave 4.x installer by checksum, `cargo install cargo-build-sbf@4.3.0`, `tools-version = "v1.56"` in source, explicit `cargo build-sbf --arch v3 --locked`, print `sha256sum` + `EXPECT_SBPF=3 tools/verify-artifact.mjs`). Anyone with Docker reproduces the tuple without trusting a third-party image or an undocumented flag. If `solana-verify` is also used, its output must equal the Dockerfile output; disagreement = stop.
2. Native platform-tools is 1.54; Anza recommends 1.56 for bug fixes. Either upgrade (preferred) or record the deliberate acceptance of 1.54 in the tuple.
3. Devnet gate status for `disable_sbpf_v0_v1_v2_deployment` should be read once at the start of P3 (RPC read; Sol/Astra have HTTP200 reads) so the drill is not surprised by an activation.

### What this decision does not change
Seal v2 on mainnet (v0) keeps executing after SIMD-0500; nothing about it needs to move. next-print-v2 on devnet (v0) keeps executing; it is a separate proven generation. Deploy and freeze still require Semir's explicit authorization.

## Sources
- Agave feature-set source (feature names + pubkeys): https://raw.githubusercontent.com/anza-xyz/agave/master/feature-set/src/lib.rs
- LiteSVM `MAINNET_ACTIVE_FEATURES` (2026-07-29 snapshot, v1/v2/v3 slots): https://raw.githubusercontent.com/LiteSVM/litesvm/master/crates/litesvm/src/features.rs
- LiteSVM `new()` -> `with_mainnet_features()`: https://github.com/LiteSVM/litesvm/blob/master/crates/litesvm/src/lib.rs · https://docs.rs/litesvm/latest/litesvm/
- cargo-build-sbf README (SIMD-500 wording, v1.53 min / v1.56 recommended, tools-version pin): https://raw.githubusercontent.com/anza-xyz/cargo-build-sbf/master/README.md
- cargo-build-sbf release dates (4.3.0 = 2026-09-03): https://crates.io/api/v1/crates/cargo-build-sbf
- platform-tools README (v1.52 lacks sbpfv3 target; v1.53+): https://github.com/anza-xyz/platform-tools
- Agave changelog (`--arch v0|v1|v2|v3`, `sbpfv3-solana-solana`): https://github.com/anza-xyz/agave/blob/master/CHANGELOG.md
- Helius, Agave 4.0 (SBPFv3 gate, SIMD-0178/0189/0377): https://www.helius.dev/blog/agave-v4-0
- Feature Gate Tracker Schedule (mainnet floor v4.0.2, 12 pending gates, none SBPF): https://github.com/anza-xyz/agave/wiki/Feature-Gate-Tracker-Schedule
- solana-verifiable-build image generation (installer + digest pinning; platform-tools via cargo build-sbf): https://github.com/solana-foundation/solana-verifiable-build/blob/master/generate_dockerfiles.py · https://github.com/solana-foundation/solana-verifiable-build
