# RatchetX — the founder's clicks to "nothing depends on the founder"

Every remaining step is a script. Each writes a report file in the repo root
that Claude (or anyone) reads; re-running any of them is safe. Order matters
only where it says so. Rules that never bend: no keypair in the repo, no
`git add .`, no game number changes during skin work, every core build's
sha256 goes into `docs/CORE.md`.

| # | click | proves | report |
|---|---|---|---|
| 1 | `DEVNET_EXERCISE.cmd` — **done** (6/6) | program live, sponsored referee, checkpoint, grant/revoke, credit gate | `devnet_exercise.txt` |
| 2 | `DEVNET_FAUCET_FULLLIFE.cmd` (~8 min) | seal → crossing capture → settle → reveal; late settle refused; deadline void; close | `devnet_fulllife.txt` |
| 3 | `DEVNET_SHOOTER.cmd` here **and** `DEVNET_RUNNER.cmd` on a machine we don't own, 24 h | strangers finish shots; nothing of ours needs to be up | `devnet_shooter.txt`, `devnet_runner.txt` |
| 4 | `LEGACY_ROOT.cmd` on the migration day (site read-only first) → push → CI builds the 4th build | Merkle root compiled in, proofs verified, totals printed | `legacy_root.txt`, `merkle_tree.json` |
| 5 | (code, not a click — see below) Bankr seals on-chain via `seal_delegated` | X posts land as on-chain shots | — |
| 6 | founder decision: stocks | no equity feed is pushed on Solana; drop / pull / self-sponsor | `docs/STOCKS_FEEDS.md` |
| 7 | 72 h drill → `solana program set-upgrade-authority --final` | upgrade authority `None` | `docs/CORE.md` |

## What changed today that removes a dependency

**The build no longer needs anyone's machine.** `.github/workflows/core-build.yml`
rebuilds the core from source with the frozen recipe (agave 3.1.10 →
platform-tools v1.52), reprints the golden vectors and diffs them against the
committed file, fails if the fresh bytes differ from the newest committed
`artifacts/*.so`, runs the LiteSVM battery against the fresh bytes, and dumps the
deployed program from devnet (or mainnet-beta on "Run workflow") to say whether
what is on chain is what is in git. Verified before shipping: a clean rebuild of
the committed source reproduced `1ba43717…` byte for byte.

**The 4th build is a push, not a session.** `LEGACY_ROOT.cmd` runs the existing
dump → reconcile → merkle chain, re-verifies every proof with the program's exact
rule, writes the constant into `lib.rs`, and prints the commit line. CI builds
it. The artifact check goes red on purpose until the new `.so` is added under
`onchain/ratchet-core/artifacts/` (download it from the run) and its sha256 is
recorded — then green again.

**A stranger can run the game.** `DEVNET_RUNNER.cmd` needs node and the repo;
it makes its own throwaway devnet key (gitignored) and asks the faucet. Give a
friend the GitHub URL and that file name. `DEVNET_SHOOTER.cmd` on our side keeps
shots coming (one every 6 min for 24 h, faucet credits, reveals its own) and
never settles anything — so whatever gets settled, a stranger settled.

## Step 5 in one paragraph (for whoever codes it)

The program already has the grant (`grant_delegate` / `revoke_delegate`,
exercised on devnet); the site needs a one-time signing flow for it: the player
signs `grant_delegate(delegate, allowance, max_stake, expiry ≤ 30 d)` once from
the play-session page. The server holds the delegate key
and, for a Bankr intent that passes the existing permit/intent checks, sends
`seal_delegated(nonce, commit, feed_index, minutes, stake)` from
`client/core.mjs` (`sealDelegatedIx`). Commit preimage is
`RATCHET|v3|<wallet>|<nonce>|<YES|NO>|<p_bps>|<salt>`; the salt stays with the
server until reveal, exactly as today. The Bankr contract (`--auto --say` → one
JSON line) does not change. Done when `ratchetx sol up 5 min 100` from X seals
on-chain under a grant and the runner settles it.

## Step 7, the freeze, verbatim

Everything of ours off (API, Supabase, sampler, our crank) for 72 h while the
open runner on the stranger box finishes shots. Then, from the machine holding
the upgrade authority:

    solana program set-upgrade-authority 6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv --final

`solana program show 6sJn9…` must print `Authority: none`. Record it in
`docs/CORE.md` with the slot and the artifact sha256 that is live.
