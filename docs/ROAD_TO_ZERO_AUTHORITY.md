# Road to zero authority — the permissionless ceremony plan (2026-09-02)

> **Historical plan; its completion table is not current evidence.** The
> 2026-09-03 audit found that Core v1 substituted the previous protocol
> checkpoint for Pyth's signed predecessor, its bounded ring can evict the true
> crossing, confidence/ruleset data are incomplete, and the client used classic
> SPL Token although RCX is Token-2022. Freeze is deferred by owner direction.
> Use `PERMANENCE_EXECUTION_PLAN.md` as the active plan.

Everything between here and a machine that runs without us. The token half is
already finished. The program half is **two actions in one ceremony**, and they
must happen in the right order because one of them cannot be undone.

## 0. Where we stand — verified, not assumed

| layer | property | state |
| --- | --- | --- |
| token | mint authority revoked — supply can never inflate | done |
| token | freeze authority revoked — no seizure, no blacklist | done |
| program | no admin, config, pause or governance account | done |
| program | anyone may crank (`cranker` is an unconstrained signer) | done |
| program | cranker cannot choose the outcome (deterministic first crossing) | done |
| program | a stake cannot be trapped (void refunds; rent returns to player) | done |
| client | settling is stranger-runnable (RPC + keypair, chain discovery, no IDL) | done |
| client | playing is stranger-runnable (seal & reveal in the open client) | done |
| equity | five feed ids verified against live Pyth (24/7 Index variant) | done |
| program | deployed with a registered verified build | ceremony |
| program | upgrade authority revoked — immutable in fact | ceremony |

Supply: 936,699,884 of 1,000,000,000; 63,300,116 destroyed (6.33%), of which
3,716,964 are player burns.

## 1. Decisions only Semir can make

**A. Equity in the freeze, or crypto-only?** The feed table is compiled in
forever; adding stocks later means a second freeze and a second deploy. The
equity candidate is proven (host 8/8, LiteSVM 10/10, `15000b8c…`) against the
crypto-only `1ba43717…`. Both are ready; one gets frozen.

**B. The equity market-hours rule.** The five ids are the Equity.Index **24/7**
feeds, so the mark is continuous and there is no oracle-level market close.
Either allow round-the-clock play labelled "Pyth 24/7 index" (never "NASDAQ"),
disclosing that outside US hours the mark is synthetic and can diverge from the
next open — or refuse equity seals outside a declared window in server and UI.
Runtime only; does not block the freeze.

**C. Salt custody — the gap nobody had flagged.** The commit salt is generated
randomly and must survive from seal to reveal. Nothing stores it (good — not a
founder dependence), but that means **a lost salt is a forfeited shot**, since an
unrevealed settled shot forfeits after the reveal deadline. A browser cutover
makes this live: one cleared cache or another device and the shot is gone.

> Recommendation: derive the salt **deterministically from a wallet signature**
> instead of randomness — e.g. the first 32 hex of `sha256(sig)` over a canonical
> message. Ed25519 signing is deterministic, so the same wallet reproduces the
> same salt on any device, forever. Nothing stored, nothing lost, no server
> involved. It removes the dependency rather than relocating it. Verify the
> behaviour per wallet before relying on it.

## 2. Preparation — all reversible, none of it touches mainnet

- Salt derivation: implement and test decision C, including recovery on a second device.
- Pinned readers cutover: server `lib/core_rules.js` and client `core.mjs` feed
  tables must match the frozen vectors exactly, or settlement disagrees with itself.
- Equity runtime wiring, if adopted: crank posts the pull price from keyless
  Hermes near expiry; board generator and UI go to twelve feeds with 24/7 labelling.
- Stranger documentation: a README letting an outsider play and settle with no
  relationship to us. Independence nobody can follow is not independence.
- Dress-rehearsal script: the whole ceremony as a self-healing one-click on devnet.

## 3. The frozen build

1. Deterministic build (`solana-verify build`, Docker) reproducing the recorded hash.
2. Rerun both batteries — host units and the LiteSVM adversarial set.
3. Reprint golden vectors; record the hash in `docs/CORE.md`; `.so` under `artifacts/`.
4. Diff vectors against the pinned readers before anything is deployed.

## 4. Dress rehearsal — do the whole thing on devnet first

Devnet deploys are free and disposable, so every surprise happens where it costs
nothing. Rehearse the entire sequence including revocation.

- Build → deploy → `verify-from-repo` → revoke, in that exact order.
- Confirm verification registers **while the authority is still live**.
- Drive a full shot life with a fresh keypair that has never touched our
  infrastructure: seal, crank, settle, reveal.
- Read the chain after revocation and confirm the authority is gone.

## 5. The mainnet ceremony — ordered, and the last step is final

> **Order is not a preference.** A verified build lives in a PDA that only the
> program's upgrade authority may write. Revoke first and self-service
> verification becomes impossible, leaving only manual third-party whitelisting —
> adding a dependency at the exact moment we remove them all.

1. Deterministic build — reproduces the hash from §3. If it does not match, stop.
2. Deploy. The program keypair never leaves the machine.
3. Verify and register — `verify-from-repo` signed by the still-live upgrade
   authority, binding program address ↔ repo ↔ commit.
4. Confirm the badge — the verification PDA exists and an explorer shows the
   program verified against the public commit.
5. **Revoke the upgrade authority.** Irreversible. After this the rules can never
   change, including by us, including to fix a bug.
6. Confirm on chain that the authority reads as none.

## 6. Abort criteria — any one of these halts the ceremony

- The build does not reproduce the recorded hash.
- Any test fails, or the golden vectors differ from the pinned readers.
- Verification does not register — **do not revoke.** An unverified immutable
  program is the worst of both worlds.
- The devnet rehearsal produced anything unexplained.
- Tired, rushed or unsure. Step 5 has no undo and no deadline outranks that.

## 7. Proof a stranger can check

- Verified badge: deployed bytes are this commit of the public repo.
- Upgrade authority: none — the rules cannot change.
- Mint and freeze: none — supply cannot inflate, balances cannot be frozen.
- "Settle it yourself": a skeptic settles a real shot with their own RPC and
  keypair, holding nothing of ours.

## 8. Honest inventory — what happens when the founder disappears

**Stops:** the website and its API, Supabase and the durable off-chain record,
the curated board and target generator, the Observatory and leaderboards, our crank.

**Keeps working:** the program and all chain state; sealing and revealing via the
open client; settling, voiding and closing by anyone; refunds past the 120s
deadline; RCX itself — fixed supply, unfreezable.

Players lose the venue, not the machine. Without the curated board they pick a
feed and an expiry directly; there are no leaderboards and no front end. But
every stake resolves or refunds, and nobody needs our permission for any of it.
That is the honest shape of forever, and it is worth stating plainly rather than
overselling.
