# RatchetX — worker plan to "nothing depends on the founder" (2026-09-02)

Repo: `D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean`. Read
`docs/CORE.md`, `docs/STOCKS_FEEDS.md`, `docs/RELEASE_H108.md` first. Rules that
never bend: never commit a keypair; never `git add .` / `commit -a` (others'
untracked files live in the tree); never change a game number or copy while
doing skin work; every core build gets its sha256 recorded in `docs/CORE.md`.

## State on 2026-09-02 (see docs/HANDOFF.md for the click-per-step map)
- Site h111 ready (push + `DEPLOY.cmd`), Bankr skill 1.5.0 live.
- Core v1 3rd build (`1ba43717…`, 120 s settle window) **deployed on devnet**
  at `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` (slot 491787400).
  Step 1 done: `DEVNET_EXERCISE.cmd` 6/6.
- Step 2 ready: devnet faucet flavour built (`CnKAJ…`, sha `0558b594…`),
  `DEVNET_FAUCET_FULLLIFE.cmd` is self-healing (recovers buffer SOL, tops up,
  deploys only if missing) and proves settle, late-settle refusal, void, close.
- Step 3 ready: `DEVNET_SHOOTER.cmd` (ours) + `DEVNET_RUNNER.cmd` (any box).
- Step 4 ready: `LEGACY_ROOT.cmd` + `.github/workflows/core-build.yml`
  (reproducible build, verified: clean rebuild == `1ba43717…`).
- Equity feeds: **none are pushed on Solana** (gate 0/10, all 256 shards).
  Stocks cannot enter the core as sponsored push feeds. Parked — see step 6.

## Steps, in order. Each has a "done when".

### 1. Devnet exercise (30 min) — proves the referee on a real cluster
Run `DEVNET_EXERCISE.cmd`. Read `devnet_exercise.txt`.
Done when: program live ✓, SOL push account receiver-owned ✓, `checkpoint`
executed ✓, grant/revoke ✓, zero-credit `seal` refused with
`InsufficientCredits` ✓. If the SOL push account is missing on devnet, note it:
the referee path is then only provable on mainnet (checkpoint is
permissionless there too, ~0.00001 SOL).

### 2. Devnet faucet flavour under a SEPARATE program id (1 day)
Needed to exercise seal → settle → reveal → forfeit → void → close on devnet.
Must NOT touch the mainnet source: adding `#[cfg(feature)]` code to the same
crate changed the mainnet bytes (measured). So: copy `onchain/ratchet-core`
to `onchain/ratchet-core-devnet`, new `declare_id!` (new keypair, devnet
only), `RCX_MINT` = a PDA `[b"devnet-rcx"]` of that program, add
`devnet_init_mint` + `devnet_faucet(amount)` (mint_to, PDA signer, ≤1e12/call).
Build with the same recipe, deploy, run the full life with `client/core.mjs`.
Done when: one shot goes seal → checkpoint → settle → reveal HIT/MISS and one
voids, all from a stranger wallet, all signed by nobody we control.

### 3. Open runner on a stranger box (1 day)
`node onchain/ratchet-core/client/crank.mjs --rpc <rpc> --keypair <any funded key>`
on a machine we don't own (a friend's VPS). Leave it 24 h against devnet.
Done when: it settles/voids/forfeits shots without any of our servers up.

### 4. Legacy migration (1 day, founder picks the day)
Snapshot Supabase credits/XP → Merkle tree (leaf = sha256(wallet‖credits_le‖xp_le),
`onchain/ratchet-seal-v2/scripts/merkle_generator.mjs` is the model) → root
into `LEGACY_ROOT` → **core 4th build** (record sha) → server to read-only →
players claim once via `claim_legacy`.
Done when: totals on-chain == snapshot totals; a second claim fails.

### 5. Bankr on core (2 days)
Server adapter: player signs `grant_delegate` once (site), server holds the
delegate key, runner calls `seal_delegated` within allowance/max_stake/expiry.
Bankr contract unchanged (`--auto --say` → one JSON line).
Done when: `ratchetx sol up 5 min 100` from X seals ON-CHAIN under a grant.

### 6. Stocks — decision, not code
Gate proved no equity feed is pushed on Solana. Options: (a) drop; (b) pull
path (Hermes update in the seal tx — cost + a dependency we rejected);
(c) sponsor a push feed ourselves (Pyth push is open; then it depends on us).
Founder decides. Default: drop until Pyth sponsors them.

### 7. 72 h drill, then freeze
Everything of ours off (API, Supabase, sampler, our crank). Strangers finish
shots via the open runner. Then `solana program set-upgrade-authority --final`
on the core, same ceremony as `docs/FREEZE.md` (8.9. for Seal v2).
Done when: the upgrade authority is `None` and `docs/CORE.md` records it.

## Founder-only, any time
- Push + `DEPLOY.cmd` after each site change; update `docs/AGENT_STATE.json`.
- 🔴 Replace the public keypair `CqVG…u7AB` (commit 69850fb on GitHub) — never use it.
- Freeze v2 on 8.9. per `docs/FREEZE.md`.
