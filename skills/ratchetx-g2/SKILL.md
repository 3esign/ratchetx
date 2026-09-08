---
name: ratchetx
description: >-
  RatchetX G2 Solana devnet prediction arcade, played with a local delegated
  signer under player-approved on-chain limits. Use for RatchetX G2 devnet
  play, status, result, proof and Pyth price questions after setup. Test
  credits only. This is a separate opt-in generation from the legacy
  RatchetX owner-session skill; never silently substitute one for the other.
license: MIT
metadata:
  author: 3esign
  version: "2.5.2"
  runtime-sha256: "bee1835cf7787698bdb902deffef53ad48caf9d981872e9b61340c6d0487ef72"
  installer-sha256: "4d34599e2e73d566ab52ad34d438c4d508bce8e8d92e7fecd95c8ff4ad82f727"
---

# RatchetX G2 devnet

Make a call, seal it before the move, then check the two Pyth prices and
public on-chain receipt. SOL, test credits, real devnet transactions.
This generation has no cash prizes, token trades, swaps or funded RCX claim.

## Install once in the agent's private persistent workspace

Node 20.11 or newer and a persistent filesystem are required. Stage the
companion `scripts/install.mjs` with this skill. Its exact SHA-256 is in the
metadata above; verify that companion before running it. The installer then
verifies the runtime package SHA-256 and every included file before installing.
It adds no npm dependency and does not request or transfer any wallet key.

If Bankr has not materialized the `scripts/install.mjs` resource, fetch
`https://ratchetx.xyz/skills/ratchetx-g2/scripts/install.mjs` into the agent's
private persistent workspace. Require an HTTP 200 response and verify the
saved bytes against the exact `installer-sha256` in this skill's metadata
before execution. A missing response or hash mismatch stops installation;
keep any existing runtime and state unchanged. Never execute an unverified
fallback download. Never run the raw `scripts/g2-session.mjs` companion:
only the installed `run.mjs` contains the complete runtime dependency tree.

```sh
node scripts/install.mjs
node "$HOME/.ratchetx-g2/run.mjs" init
```

If `$HOME/.ratchetx-g2/run.mjs` is missing when a command arrives (a fresh host), run the
installer first, then the command - every time, not only once.

**Default: the agent plays with its own devnet wallet.** `init` with no address
(or `--player self`) generates a key inside this agent runtime and makes it the
player. Nothing has to be signed anywhere else: the first `play` claims 10,000
devnet test credits for that wallet and seals the prediction. A public X command
on a fresh host may skip `init` entirely; `play` sets self-play up on the way.
The agent wallet needs a little devnet SOL for fees and rent; the runner asks the
devnet faucet itself and, if the faucet is rate limited, reports the address to fund.

**Hosts without a persistent filesystem (Bankr's X runtime is one): set one secret.**
Every command there starts on a fresh disk, so a key kept in a file would be a new wallet
each time and a sealed prediction could never be revealed. Fix: the owner adds an env var
`RATCHET_G2_SEED` (any private random string, 32+ characters, e.g. from a password
manager) in Bankr settings → Env Vars, once. Run every command with it in the environment:

```sh
RATCHET_G2_SEED={{RATCHET_G2_SEED}} node "$HOME/.ratchetx-g2/run.mjs" play --say "USER WORDS VERBATIM" --command-id SOURCE_X_POST_ID
RATCHET_G2_SEED={{RATCHET_G2_SEED}} node "$HOME/.ratchetx-g2/run.mjs" status
```

With the seed present the runner is stateless: the agent wallet, the reveal material and the
journal are all re-derived from the seed and read back from the chain, so `init` is not
needed and nothing is written to disk. One prediction is open at a time: `play` while a
shot is live reports it (or reveals it once Pyth prices are recorded) instead of sealing a
second one. Never print or echo the seed; pass it only as an environment variable.

**Optional: play on the human's own wallet.** Only if the authenticated owner of
this private session explicitly asks for their record to live on their wallet:
`init --player THEIR_PUBLIC_SOLANA_ADDRESS`. That is delegation - the reply
carries a setup link the player opens in their wallet to choose limits and sign
the on-chain grant, and that player claims their own 10,000 test credits once at
https://ratchetx.xyz/play. Never infer ownership from an X handle or a post;
entering an address grants nothing, only the player's signature does. Show every
`reply` verbatim. Setup never mints credits or migrates an old balance. Never ask
for anyone's private key.

```sh
node "$HOME/.ratchetx-g2/run.mjs" preflight
```

Preflight is read-only: it checks the actual grant and selected devnet
configuration and reports the delegate's fee balance. It neither creates a
grant nor sends a transaction. Use G2 play only after this succeeds.

The default state directory is `$HOME/.ratchetx-g2`. If a host needs a different
location, configure `RATCHET_G2_HOME` once as an absolute private directory and
keep it unchanged. Never create a directory or journal per post, reinstall to
retry a shot, rotate keys as a fallback, or copy the private state to another
wallet. Upgrades keep the identity and journal; prior version directories stay
available for review. Protect the directory like a wallet: it holds the local
delegate key, committed reveal secrets and transaction recovery records.

## One source command, one JSON reply

Only in the authenticated owner's session, and only when they ask to play:

```sh
node "$HOME/.ratchetx-g2/run.mjs" play --say "USER WORDS VERBATIM" --command-id SOURCE_X_POST_ID
```

Pass user text as one structured process argument; shell-escape it if the host
only offers a shell. Never interpolate raw post text into an executable shell
command. Use the real source post ID provided by the authenticated platform,
unchanged on redelivery. A post ID deduplicates an action; it does not prove
who requested it. If the platform cannot supply authenticated ownership and
that stable ID, stop before play and use read-only status instead.

The runner parses the words and checks the chain. Never choose a different
asset, stake, direction or probability, invent an ID, provide your own summary,
or retry under a new ID. Plain `play` uses the runner's documented defaults.
If the user asks for `help` or `menu`, do not run `play`; instead, reply exactly with: "Play the RatchetX prediction arcade on Solana devnet. Try: @bankrbot play SOL UP"
If the user asks for `board` or `stats`, run the `status` command instead of `play`.
Unsupported assets are refused; they are never substituted. Use one call,
then post the returned **`reply` verbatim and nothing else**, including refusals.
A seal is pending; it is not a win. Pyth price attribution and proof links must
remain attached to the actual result. Never reveal the direction, confidence
or salt before the reveal transaction is allowed by the program.

```sh
node "$HOME/.ratchetx-g2/run.mjs" status
node "$HOME/.ratchetx-g2/run.mjs" reconcile --command-id ORIGINAL_SOURCE_X_POST_ID
node "$HOME/.ratchetx-g2/run.mjs" reveal --command-id ORIGINAL_SOURCE_X_POST_ID
node "$HOME/.ratchetx-g2/run.mjs" finish --command-id ORIGINAL_SOURCE_X_POST_ID
```

Status reads the current saved game. Reconcile resolves an uncertain prior
submission without inventing a new prediction. Reveal is a state-checked completion of the already requested saved game; it can sign and submit
only when the on-chain reveal window is open. The host may complete an authorized play with `finish`; it watches only that saved source ID
for up to 45 minutes, reconciling the prior transaction and revealing once
the program permits it. It prints one final JSON reply. It never creates a
new shot. If interrupted or timed out, resume `finish` with the same source
ID and private state. Keep the local agent available through that window. A successful installation or MCP read alone does not
provide a background reveal worker or demonstrate that Bankr executed a shot.
After a process crash, first run `recover-lock`. It removes only the exact
wallet scope’s machine lock after proving its recorded process has exited;
an active or unverifiable process is refused. It never changes saved commands
or signer data. Then reconcile the original source ID. Never delete the state
directory or create a replacement journal.

Do not enable public play routing on a host that cannot reliably return to
reveal within that window.

The exact aliases `@bankrbot play`, `@bankrbot rcx play`, `rcx play`, and `$RCX play` map directly to this RatchetX G2 play command.

## Honest boundaries

The runner signs locally using its own delegate key. It does **not** depend on
Bankr providing native arbitrary Solana transaction signing, which has not been
established for this integration. This skill supplies a runtime for a host's
persistent `execute_cli`; it is not evidence of a deployed Bankr connection or
a successfully posted X command. It never uses `RATCHET_PLAY_SESSION` or the old
`/api/game?action=play-session` endpoint. The old working skill stays intact.

Game state and grant limits are checked on Solana devnet. Agent availability,
local secret retention, the selected RPC, the keeper and upgrade authorities
remain trust or availability limits. Do not call the full system unconditionally
permissionless or fully decentralized. No Supabase or Upstash is used by this
G2 runner; this says nothing about migration of legacy balances or history.

Play: https://ratchetx.xyz/play
Proofs: https://ratchetx.xyz/proof
Agent setup: https://ratchetx.xyz/agent-setup
Read-only/unsigned remote MCP: https://ratchetx.xyz/api/g2-mcp
Pyth: https://www.pyth.network/
Source: https://github.com/3esign/ratchetx
RCX token (separate mainnet token, not a G2 test-credit prize):
https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump
