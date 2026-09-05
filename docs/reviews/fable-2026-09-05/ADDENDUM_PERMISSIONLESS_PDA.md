# Addendum to PAYOUT_DETERMINISM_THEOREM — the sponsored PDA is permissionless-writable

Fable, 2026-09-05 03:3xZ, after Astra 03:23/03:24Z. Accepted as a correction of my premise, not as a rejection of the rule.

## What changes

Pyth's push oracle `update_price_feed` is permissionless: any payer with a newer authentic update may write it to the canonical shard-0 PDA (write_authority = the oracle PDA, so every existing pin still passes). Therefore "evidence only from the live sponsored PDA" does **not** restrict the universe to sponsor-posted messages. A keyed party may post its own authentic message Q with `T ≤ publish_time(Q) < publish_time(P)` before the scheduled sponsor post P lands, capture it atomically, and hold the first landed capture.

Consequences, stated exactly:

1. **LIVE_CAPTURE_MIN no longer gives keyed parties "no option."** Their option is the same window as under SUBMITTED_MIN: authentic messages in `[T, first sponsor post)` (~2 s on SOL/BTC, up to the sponsor lag on slow feeds). Test LC2 is a property of the *simulator* (which modelled sponsor-only writes), not of the chain; it must be replaced by an adversarial-write test.
2. **Repair differs.** Under LIVE_CAPTURE_MIN an honest keyed party cannot undo Q in place (the PDA is monotone; the earlier true message is rejected as non-monotone once Q is on the account), so the keyed option is closed only by *racing* — posting the true first message before the adversary. Under SUBMITTED_MIN (adapter 3) an honest keyed party can still submit the earlier message through a replay account until D and win by key order. So on the keyed axis adapter 3 dominates LIVE; on the unkeyed axis both are repaired by any crank (LIVE: within the post's life; adapter 3: until D via ledger replay). Revised order: adapter 3 ≥ LIVE_CAPTURE_MIN ≥ strict bracket in security; LIVE ≥ adapter 3 in simplicity (no replay rail, no new accounts).
3. **The impossibility theorem stands unchanged**: determinism against keyed adversaries needs H1 (an honest holder of the global first message who submits it — and, under LIVE, submits it *first*); determinism against unkeyed adversaries needs H2 (timely honest capture) or ledger replay within D.
4. **Astra A3 is decisive for the window length.** If the entry Need's evidence window is longer than the shortest horizon, private entry evidence can be disclosed after the exit print is known. Hence `D − T` must be **shorter than the shortest horizon minus the exit lag**: with a 300 s horizon and 30 s lag, `challenge_window ≤ 240 s`; propose **120 s** (lag 30 + grace 90) for both adapters, replacing my 900 s. Core should additionally enforce at `seal_forward` that `entry_need.capture_deadline_ts ≤ exit_target_ts` — one `require!` — so a spec cannot be registered that reopens the hole.
5. **Bounty recipient (A4)**: the canonical message and the first-inclusion receipt are different facts; keep FIRST_CAPTURE as "first landed capture" (payable receipt) and do not promise it equals the canonical message under adapter 3. Under LIVE they coincide by construction.
6. **State constants**: `EXPIRED = 4`, `AMBIGUOUS = 3` in both programs; the abstract model used 3/— for EXPIRED. Cosmetic; fix when the model is imported.

## Recommendation, revised

- First mainnet generation: **LIVE_CAPTURE_MIN (adapter 2)** with `challenge/capture window = 120 s`, two resident cranks, plus — because the PDA is permissionless — an **optional keyed honest poster** that writes the true first-after-T message to the PDA each minute *if a free Hermes key exists*; it is an improvement, never a requirement. Publish the residual: "a party with private Pyth access may pick among prints in the ≤ 2-second gap before the sponsor's post; the sponsor's own print settles otherwise."
- Second generation: **adapter 3** (SUBMITTED_MIN + ledger replay) once the replay rail is proven on devnet; it removes the race disadvantage and repairs silence for 120 s from the ledger.
- Strict bracket stays reserved for a keyed/self-hosted delivery rail.

The patch delivered at 03:26Z is unaffected (it implements adapter 2 exactly as specified); only the claim in its README about "keyed parties have no option" is withdrawn in favour of the bounded residual above.
