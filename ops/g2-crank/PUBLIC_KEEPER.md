# Public devnet keeper

The public keeper advances existing RatchetX G2 shots with any operator's own
Solana fee payer. It can run on an independent machine or host; no Svemir account,
player key, reveal salt, Bankr API, Supabase or Upstash is used by this entrypoint.
Use Node **20.18.0 or newer**; Node 22 is recommended. The repository's existing
locked dependencies are required; this entrypoint adds none. It is on `main` as of
be14cee - the sentence that used to send readers to `codex/g2-public-keeper` was
true when it was written and stale from the moment the branch merged:

```text
git clone --single-branch --branch main https://github.com/3esign/ratchetx.git
cd ratchetx
npm ci --omit=dev
```

Use the committed lockfile. This is a source distribution, not a claim that an
operator service or a new website deployment is running.

## Read-only first

From the repository root, choose an operator **public key** and explicit RPC:

```text
node ops/g2-crank/live.mjs --rpc <DEVNET_RPC_URL> --operator <OPERATOR_PUBLIC_KEY>
```

Dry-run is the default. It reads and validates chain state and prints the next
maintenance action, if any. It does not load a keypair, sign, simulate, send or
write a journal. Add `--watch` to repeat read-only sweeps. A funded operator is
needed only for sending.

## Sending maintenance

```text
node ops/g2-crank/live.mjs --rpc <DEVNET_RPC_URL> --operator <OPERATOR_PUBLIC_KEY> --send --keypair <OPERATOR_KEYPAIR_PATH> --journal <NEW_PUBLIC_KEEPER_JOURNAL_PATH> --watch
```

The named keypair must match the selected public key. Use a dedicated operator
and a persistent **local** journal directory you control; create its parent
directory first. No keypair is searched for or inferred. Do not put a keypair in
the repository or a public/shared folder. The journal contains public maintenance
transactions and operator/game identities, never a player secret.

Every run validates devnet genesis, the two pinned program addresses and deployed
program accounts, the configured economy/ruleset/evidence hashes and their actual
onchain account relationships. Pyth source ownership and generation are still
checked. Selecting a different operator does not change those pins.

Available actions are 10 public instructions: Timepin `capture_first`, `capture_conflict`, `finalize`, `expire`; Core `activate_entry`, `settle_final`, `void_pending_entry`, `void_active_shot`, `finalize_resolved_void`, `forfeit`. Onchain rules determine eligibility, result and
destinations. Core rent refunds remain the shot's frozen destination; any cleanup
bond paid to the actor goes to the selected operator. This command does not seal
shots, choose a prediction, reveal, issue credits, or distribute RCX.

## What it costs and what it pays

Measured on devnet 2026-09-10, one complete shot, one operator, no other players
on those target times (receipt: `docs/receipts/devnet-worker-economics-2026-09-10.md`):

| Transaction | Operator delta |
|---|---|
| `capture_first` (entry target) | **-1 259 760** |
| `capture_first` (exit target) | **-1 259 760** |
| `finalize` x2 | -5 000 each |
| `activate_entry` | **+45 000** |
| `settle_final` | **+45 000** |
| **Net** | **-2 439 520 lamports** |

Core pays one bond unit (50 000 lamports here) for each permissionless step, so
`activate_entry` and `settle_final` earn 45 000 net each. Timepin does not: the
`CandidateV2` observation account is `init_if_needed, payer = actor`, costs
1 254 760 lamports of rent, and there is no instruction that closes it. Core reads
that account at `activate_entry` and `settle_final`, and Timepin has no working
reference count (`open_refs` is declared and never incremented; the program says so
in its own comments), so nothing can safely reclaim the rent today.

**A single operator serving a single player therefore loses money.** State this
plainly rather than discovering it after funding a wallet.

The cost is per TARGET TIME, not per shot: a Need and its candidate are shared by
every shot on the same target, so the second player on a target costs the operator
only the two 5 000-lamport signatures and earns the same 90 000. Break-even is
roughly 2 x 1 265 000 / 90 000, about **28 shots per target time** - each shot
consumes two targets. Below that an operator subsidises the arcade; above it the
operator profits.

Until real volume exists, running this is a contribution, not a business.

## Choosing an RPC

`--rpc` is required and never guessed, and the endpoint you choose is the single
most likely thing to cost you a game. Measured 2026-09-10, a lagging node behind a
load-balanced endpoint blinded a keeper for five minutes and a capturable target
expired. The retry path now absorbs that, but only for about a minute.

Two keyless devnet endpoints were probed with the calls a keeper actually makes -
`getProgramAccounts` with memcmp filters, `getMultipleAccounts` with
`minContextSlot`, `getSignaturesForAddress`, `getTransaction`,
`getLatestBlockhash`, `getBlockTime` - at the cadence a keeper actually uses
(account reads 2.5s apart, Shot scans 5s apart):

| Endpoint | Result |
|---|---|
| `https://api.devnet.solana.com` | all calls pass, 0 failures at keeper cadence |
| `https://devnet.rpcpool.com` | all calls pass, 0 failures at keeper cadence |

Both honour `minContextSlot`, which the Shot scan depends on. Neither survives a
burst: twenty `getProgramAccounts` back to back trips a rate limit that then
rejects paced calls for a while afterwards, so do not tighten the sweep interval.

Five other public endpoints were refused outright and are listed so nobody
re-tests them: `solana-devnet-rpc.publicnode.com` (404),
`solana-devnet.drpc.org` (devnet is a paid plan), `endpoints.omniatech.io` (521),
`rpc.ankr.com/solana_devnet` (API key required), `api.devnet.rpcpool.com` (IP
blocked), `solana-devnet.g.alchemy.com/v2/demo` (429).

**If you are the second or third keeper, pick a DIFFERENT endpoint from the one
already running.** Two keepers on one endpoint are two machines behind one point
of failure, which looks like redundancy and is not.

## Migration and interruption

The old command now needs `--operator`. Its schema-1 bootstrap journal is rejected
intentionally. Use a separate schema-2 public keeper journal; it binds purpose,
operator, genesis, both programs and all three game hashes. Do not rename or
silently upgrade the old journal. First reconcile any old pending signature and
ensure the old process has stopped before migrating that operator. Updating
source files does not update a process that is already running.

A single writer lock is acquired **before** the journal is loaded. After an
unclean exit, inspect the recorded PID and confirm that process has stopped before
removing its stale `.lock` file. Preserve the journal itself and restart using the
same operator, path and pins. There is no automatic stale-lock takeover or
multi-host failover guarantee.

Simulation sends an unsigned transaction. Only after it succeeds are the exact
signed bytes, signature, blockhash and validity height saved with file fsync and
atomic rename, before any broadcast. Restart validates the saved signature,
operator, maintenance instruction, subject and pinned accounts before reuse.
An uncertain response leaves that transaction pending; retries send the same
bytes without obtaining another blockhash or signing another operation. Dry-run
never rebroadcasts even when reading a pending journal.

Confirmed success is an RPC observation, not finality. A confirmed error remains
pending until it finalizes; only then is it recorded as failed. If a signature is
unobserved after the RPC's finalized block height passes its validity window, it
is recorded as **expired-unobserved**, not failed. The next sweep reads current
onchain accounts before planning anything further. Missing transaction history
does not prove that an earlier transaction never landed.

Use a filesystem with atomic rename. The file is flushed before rename; POSIX
also flushes the directory. Node cannot guarantee directory fsync on Windows.
This is not a claim of recovery from every power-loss, disk or RPC failure.

## Current bounds

This entrypoint retains its devnet safeguards: at most 50 concurrent shots, a
0.05 SOL balance floor, a 0.25 SOL net-balance decrease guard relative to the
journal's first run, and fewer than 300 records **prepared in the last hour**.
Refunds and added funds affect the net-balance guard; it is not an accounting cap
on total lifetime fees.

That third bound used to count every record the journal had ever written. A
runaway guard shaped as a lifetime counter stops a healthy keeper for the same
reason it stops a broken one - staying up - and it stops it by throwing, which a
restart loop re-enters immediately, so the process crash-loops while open games
void. Measured 2026-09-10, this devnet operator stood at 62 of 300 at roughly six
records per game: about forty games from that wall. The bound is now a rate over a
one-hour window (`withinFeeBudget` in `ops/g2-crank/live.mjs`, covered by
`test/test_g2_public_keeper.mjs`). An undated record counts as recent, so a journal
that lost its timestamps fails closed rather than losing the bound.

Permissionless means another operator can submit these same validated public
actions. It does not guarantee that someone stays online, captures every eligible
Pyth update, or that a public RPC remains available. Players still need to reveal
their committed prediction on time; that private reveal dependency is unchanged.
No independent operator has been claimed live merely because this patch passes
its local tests.

## Focused offline checks

```text
node --test test/test_g2_public_keeper.mjs
```

The fixtures use synthetic signers held only in memory and stub RPC connections.
They cover operator substitution in all maintained actions, chain/journal
mismatches, exact signed-byte recovery, persistence failures, and honest handling
of unobserved expiration. They are not a new devnet transaction or operator
availability demonstration.
