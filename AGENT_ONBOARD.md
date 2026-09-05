# Agent onboarding — RatchetX road to mainnet

**Lead / integrator:** Opus (posts as `Opus` in the room). Semir owns the product decisions.
**Where you work:** `D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean`, branch `codex/core-source-bracket`.
**Channel:** `ROOM.md` in that folder, written only through `tools/room.mjs`.

## 1. Read these two, in this order, before writing anything
1. `docs/ROAD_TO_MAINNET.md` — the single tracker. State, the settlement decision (MIN-CAPTURE), the
   phase gates, and the five decisions reserved for Semir.
2. `node tools/room.mjs tail 40` — what happened in the last hours.

Do not plan from `MAINNET_PLAN.md`, `AGENTS_CHANNEL.md`, `COWORK_HANDOFF.md`,
`docs/FINISH_PLAN_2026-09-02.md` or `CUTOVER_RUNBOOK.md`. They are history.

## 2. How to speak
```
node tools/room.mjs post  <YourName> <one line, plain text>
node tools/room.mjs claim <YourName> <the item you are taking>
node tools/room.mjs since <ISO-timestamp>     # poll for what you missed
node tools/room.mjs tail  [n]
```
One line per message, UTF-8, append-only. No other file is a channel.

**Your first message is a HELLO and must state what you actually have**, because work is split by tools,
not by ambition:
```
HELLO <name>. TOOLS: cargo/build-sbf yes|no, solana CLI yes|no, network/RPC yes|no,
node yes|no, can edit files yes|no, browser yes|no. TAKING: <item from ROAD_TO_MAINNET.md §3>.
```
Nobody assigns you work you cannot execute. If your tool list is empty of what an item needs, say so
and claim a different one.

## 3. How to listen
- **Nothing unowned** replaces "nobody idle". Idle is fine. A fourth review of the same file is not.
- **Claim before you touch.** `room.mjs claim` first. If someone already claimed it, take the next item.
- **One owner of the Cargo target at a time.** Only the agent holding the Rust claim edits Rust or runs
  `cargo` / `build-sbf`. Two polite hand-offs of the same target is how this team stalled once already.
- **Every claim names files and the test that will prove it.** A DONE without an integrated commit hash
  is a draft.
- **State your evidence tier in every report**, always one of: `host` < `exact-SBF (LiteSVM)` <
  `devnet with real Pyth accounts` < `mainnet`. A green compile or model run is never a GO.
- **Scratch that is not integrated within 24 h is discarded, not preserved.** Evidence lives in git,
  not in scratch folders. **This applies to scratch only.** Corrected 2026-09-05 after Opus C measured
  that 119 paths under `onchain/` — both programs, the model, the vector generator and every vector —
  are untracked: read literally, the original wording pointed at load-bearing code. Untracked
  load-bearing code is a commit to make, never something to discard.
- **Do not open a new plan document.** Findings go in the room; state goes in `ROAD_TO_MAINNET.md`,
  and only the lead edits that file.
- **Disagree in the room, with the receipt.** A counter-example beats a conclusion. Three findings were
  overturned this way in one night and that is the system working, not friction.

## 4. Hard stops — no exceptions, no "just to test"
- **No mainnet transaction, no deploy, no upgrade, no freeze ceremony.** Ever, from an agent.
- **No build** (`cargo build-sbf`, vector re-pin, ELF lock) until the MIN-CAPTURE rule has landed —
  otherwise all three are redone.
- **Never pay for an API key**, never add one to the settlement path. The whole design surfs free
  infrastructure; a key in the canonical path is a project-level failure, not a shortcut.
- **Never touch `D:\keys`**, never print a private key, never commit a keypair file.
- The five decisions in §4 of the tracker are Semir's. Propose numbers, never set them.

## 5. Claims that are now forbidden (they were measured and refuted)
- "Pyth-first" / "globally first print" — no keyless source proves it.
- "exact-SBF proves acceptance" for a test that builds the price account with `set_account`
  (HDw2/rec2 never execute in it).
- Any verdict from `tools/p6-canary/*` until Astra's fixed pack is in the tree (7 false-green paths).
- "The freeze is scheduled" — it is not, and the public copy was corrected on 2026-09-05.

If you believe one of these is wrong, bring the receipt to the room. That is the only way they reopen.
