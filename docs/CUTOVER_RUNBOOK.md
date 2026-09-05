# Cutover runbook

> **SUPERSEDED as a plan on 2026-09-05.** The single tracker is
> [`docs/ROAD_TO_MAINNET.md`](ROAD_TO_MAINNET.md); agents enter through
> [`AGENT_ONBOARD.md`](../AGENT_ONBOARD.md). This file is kept as history — do not plan from it, do
> not claim work out of it, and do not update it. Where it disagrees with the tracker, the tracker
> wins. Six overlapping plans is what produced the integration bottleneck this project is fixing.


**The migration happens once.** Every step below has a check that must pass
before the next one starts, and an abort that is safe to take. If a check fails,
**stop and abort** — every step up to the point of no return is reversible, and
the cost of aborting is one more evening. The cost of continuing past a failed
check is somebody's balance.

Read the whole thing before starting any of it.

**Point of no return: step 8.** Everything before it can be undone by removing
one environment variable. Everything after it is on chain.

---

## Before the day

- [ ] **Decide the unplayed-visitor rule.** `state` shows a fresh wallet 5,000
      credits **without persisting anything**. A visitor who saw that balance and
      never played has no store row, therefore no leaf, therefore nothing to
      claim. Defensible — they never played — but from their side they "had
      5,000 credits", and it must be a decision rather than a discovery. If the
      answer is "they get nothing", say so publicly before the freeze, not after.
      *(Surfaced by `test_cutover_rehearsal.mjs`; asserted in both directions.)*
- [ ] **Choose the migration id.** 32 bytes of hex, chosen once, never reused.
      A random 32 bytes is fine; what matters is that it is recorded and that no
      other migration ever uses it.
- [ ] **Confirm the program id and cluster.** The root binds to both. A root
      built for devnet cannot be claimed on mainnet — that is the protection, and
      it also means a rehearsal root is useless for the real thing. Build twice:
      once for the rehearsal, once for real.
- [ ] **Confirm the artifact is deployed and the economy account exists.** The
      root goes into `economy.args.legacy_root`, which is on-chain data. There is
      nothing to compile and nothing to rebuild — but the account has to be there.
- [ ] **Rehearse on devnet, end to end, including a claim.** A ceremony nobody
      has performed is a ceremony nobody has debugged.

---

## The sequence

### 1. Announce

Say when, and say that open shots will settle normally. People with a 24-hour
position need to know before they take it, not after it is frozen.

**Abort:** free.

### 2. Freeze

Set `RX_MIGRATION_FREEZE=1` in the production environment and deploy.

> The freeze is an environment variable, so **it takes a deploy to turn on**
> (~30s). It is not instant. Do not plan a sequence that assumes it is.

**Check:** a seal attempt returns code `MIGRATION_FREEZE`, and the reason names
the freeze rather than a generic refusal.
**Check:** an existing open shot still settles. Watch one land.

**Abort:** remove the variable, deploy. The machine sells again. Nothing is lost.

### 3. Drain

Wait. Open shots run to their own expiry and settle on their own terms. Nothing
is voided, nobody's correct prediction is converted into a refund.

**Check:** `tools/live_snapshot.mjs` reports `openShots 0`.
**How long:** bounded by the longest horizon that was open when the freeze went
on — the tool prints `latestExpiry`. Not the 1440 minutes the table allows in
the abstract.

> **The drain has a liveness assumption and it is worth stating out loud here,
> because this is the step where it bites.** Settlement is permissionless:
> anybody may settle a shot, which means nobody can be *made* to. Expiry alone
> settles nothing — a transaction has to be sent. If nothing cranks, shots sit
> at `Sealed` past their expiry, the drain never reaches zero, and the cutover
> stalls with the machine frozen and players unable to play.
>
> The program's own answer is that an unsettled shot eventually **voids and
> refunds** rather than paying out, which protects the stake but converts a
> winning position into a refund — a real loss to whoever was right. So the
> drain is not "wait and it resolves itself". Somebody must watch it, and the
> operator running this cutover is that somebody.
>
> **Check during the drain:** open shots are going DOWN, not merely sitting. If
> the count stalls with expiries in the past, crank them before the grace window
> turns wins into refunds.

**Abort:** as step 2. Still free.

### 4. Snapshot

`LEGACY_ROOT_LIVE.cmd`, or `tools/live_snapshot.mjs` directly. It reads and never
writes; the only commands it sends are SCAN, MGET and PTTL. Output goes to the
private folder — it is every player's balance and does not belong in the repo.

**Check:** the census prints `openStake 0`. If it does not, the drain is not
finished; go back to step 3.

**Abort:** free. Delete the file.

### 5. Build the root

```
node tools/legacy_root.mjs <snapshot.ndjson> \
  --cluster mainnet --program <g2 program id> \
  --migration-id <the 32-byte hex from "Before the day"> \
  --cutover-slot <slot at the freeze>
```

It **refuses** without all four. That is the point: each one is a "this root
cannot be replayed there", and a missing one is not a smaller root, it is a root
bound to nothing.

**Check:** it prints `leaves`, `depth`, `root`, and re-verifies every proof with
the program's own fold before writing anything.
**Check:** `merkle_excluded.json` — read it. Every wallet it leaves out and why.
**Check:** credits total in the output equals the store's credits total.

**Abort:** free. The files are local.

### 6. Verify independently

Do not trust the builder's own check. Re-derive:

- [ ] Run the builder **again** on the same snapshot. Same root, or stop.
- [ ] Take a **second, fresh** snapshot and build from that. Same root, or stop
      — the root binds to the canonical balance set, so a second honest reading
      of an unchanged store must agree. If it does not, the store moved, which
      means the freeze is not holding.
- [ ] Fold one player's proof by hand with `g2Leaf`/`g2Node` from
      `tools/legacy_root_rules.mjs` and confirm it reaches the root.

**Abort:** free.

### 7. Publish the root and the exclusions

Before it goes on chain. Anyone should be able to check their own leaf against
the published root and the published binding. `merkle_tree.json` carries the
binding for exactly this reason.

**Abort:** free, and cheaper than explaining afterwards.

### 8. Set the root on chain — POINT OF NO RETURN

Write the root into `economy.args.legacy_root`. This is a transaction, not a
compile. **Everything after this is on chain.**

**Check before signing:** the root in the transaction is the root in the
published file, character for character. Compare, do not remember.

**Use the `economyArgs` block from `merkle_tree.json` verbatim.** The builder
emits `legacy_root`, `legacy_snapshot_hash`, `legacy_cutover_slot`,
`legacy_leaf_count`, `legacy_total_credits`, `legacy_total_xp`, `migration_id`
and `cluster_genesis_hash` from the same pass that built the tree. **Do not add
the totals up by hand.** g2 caps every claim against two of them —

```
credits <= economy.args.legacy_total_credits
xp      <= economy.args.legacy_total_xp
```

— so a total that comes out even one short silently locks out whoever is above
it, and because the account is write-once, permanently.

**Abort: THERE IS NONE. Answered by reading g2, 2026-09-05.**

`register_economy` is the only instruction that writes `economy.args`. It sets
the account when `schema == 0` and, on any later call, requires the args to be
**identical** or fails with `ImmutableAccountMismatch`. There is no update
instruction, no admin key, no authority field, and nothing that can replace a
root once written.

That is the trustless property working exactly as intended, and it means the
verification in steps 5–7 is **not good practice, it is the only protection that
exists**. A wrong root is not corrected; it is superseded by an entirely new
migration with a new id, and every player who already claimed against the wrong
one has been paid.

Read steps 5, 6 and 7 again before signing this one.

### 9. Open claims

Players claim once each. The claim is theirs to make; nobody claims on their
behalf.

**Check:** claim from a fresh wallet that is in the tree. Then check that a
second claim from the same wallet is refused.

### 10. Retire the database's authority

Only when claims have settled. Until then the store is still the record of what
was owed, and it must not be edited.

---

## If something goes wrong

**Before step 8** — remove `RX_MIGRATION_FREEZE`, deploy, and the machine is
exactly as it was. Delete the local files. Nothing happened.

**After step 8** — do not improvise. The root is on chain and players may
already have claimed against it. Any correction is a second migration with its
own id, not an edit of this one, and a partial re-run is how somebody gets paid
twice.

## What must never be done

- Never build a root while `openStake > 0` without deciding, in writing, who
  owns that stake and why. The builder refuses by default; `--allow-open-stake`
  exists for a considered decision, not for impatience.
- Never void live shots to reach a quiet store faster. It confiscates earned
  outcomes from whoever held a chamber at that second, and a half-applied void
  pays somebody twice.
- Never reuse a migration id.
- Never set a mainnet root built with `--cluster devnet`. It will not verify —
  the binding is doing its job — but the failure will look like a bug and cost
  an hour of panic.
