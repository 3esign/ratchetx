# The freeze — Ratchet Seal v2 becomes immutable on 2026-09-08

Registered 2026-08-25, before the fact, in the same spirit as everything else in this
repository: say it first, in writing, then be checkable.

## The claim

On **2026-09-08** we revoke the upgrade authority of **Ratchet Seal v2**
(`23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX`) on mainnet-beta. Not "move it to a
multisig", not "custody it harder" — revoke. From that day the deployed bytes are final,
for us exactly as for anyone else, forever.

## Why now

The README has said from the start that the upgrade authority is "retained offline only
for the declared soak period." A soak period with no end date is just control with better
PR. This gives it one: fourteen days after the week-one writeup, the promise gets a
calendar entry that can be checked against the chain.

Why this program can afford immutability: it holds no player funds; it is an optional
receipt path, not the canonical referee; the deployed binary is byte-verified against the
repository artifact; and the site can always stop arming it (`RatchetX_SEAL_PROGRAM_ID` is
an environment switch). The one thing we can never do again after 2026-09-08 is change
what the deployed program does — which is the point.

## Check it yourself, before and after, without a key

The upgrade authority is a public fact on a public ledger, so verifying it
should not require holding a key. `solana program show` disagrees — it refuses
to run without a configured signer — which is a poor state of affairs for the
one claim this whole ceremony rests on.

So there is a tool that asks the chain directly:

```bash
node tools/authority-check.mjs
node tools/authority-check.mjs <PROGRAM_ID> <ANY_RPC_URL>
```

It derives the ProgramData account, reads it, and decodes the authority field.
Reads only — it signs nothing and sends nothing, and it takes any RPC you
prefer, including none of ours.

**Before 2026-09-08** it names a key. **After**, it should print that the
program is immutable. Same command, both sides of the ceremony, run by anyone.

If it still names a key after that date, the promise on this page was not kept,
and you will not need us to tell you.

## What this does and does not mean

- **Does:** the on-chain sealing rules — wallet-bound v2 commitments, first verified
  checkpoint crossing expiry, disjoint settle/void deadlines — can never be silently
  changed. Verify the program once and the verification stays true forever.
- **Does not:** make settlement "fully on-chain." The canonical referee is still our
  server, labeled on every API response, until v3 earns that role on devnet first.
  Freezing v2 does not move that line; it hardens the receipt path players already use.
- **v3 is a different story.** Seal v3 ships under a new program id with its own
  registered deploy ceremony and fresh keys. A frozen v2 stays exactly what it is today.

## The pre-freeze checklist — sorted before the key burns

Fourteen days exist to be used. Each item is checkable; an item still open on
2026-09-08 is a reason to hold the ceremony, not to hope. Status as of 2026-08-25:

- [x] **No permissionless-closure MEV in v2.** The class of bug fixed in the v3 draft
  (`close_abandoned_shot` gated on a `settled_ts` that MissedCrossing voids forgot to
  set) does not exist here: v2 has no permissionless close at all — `close_shot`
  requires the player's own signature and rent returns only to the player. Verified
  against source 2026-08-25. Consequence to accept: a shot whose player never returns
  can never be closed by anyone, so its rent (~0.002 SOL per account) is stranded
  forever. Count the open Shot PDAs before the ceremony and write the number here: ____.
- [x] **Oracle input strictness.** settle/checkpoint accept only accounts owned by the
  Pyth receiver program, with `VerificationLevel::Full` required — `gte(Full)` is
  already exactly as strict as the v3 tightening (`== Full`) for this enum. Verified
  against source 2026-08-25.
- [x] **Comment-vs-code note.** The source comment "Anyone may clean up" overstates:
  closure requires the player's signature. Deployed behavior is the *stricter* one.
  Recorded here so nobody relies on the comment; the source stays untouched so the
  byte-verification claim remains trivially reproducible.
- [ ] **Every instruction exercised on mainnet.** seal, checkpoint, settle, reveal,
  void_shot, close_shot — each invoked at least once against `23k3…ZEEX` on
  mainnet-beta, tx signature linked here. Any instruction still unexercised on
  2026-09-08 is a named, accepted risk or a reason to wait. (Method: the program's
  transaction list on an explorer, plus server records.)
  Status 2026-08-25, read from the site's own public records: **seal** is exercised —
  sealed shots with transaction signatures appear in the public log (optional-seal
  mirror live, feeds: SOL) — and the SOL FeedClock account exists on mainnet, so
  **checkpoint** has run at least once. **settle, reveal, void_shot and close_shot
  appear never to have been exercised on mainnet** — the end-to-end automation was
  never armed. Those four are the real pre-freeze work: drive one sealed shot through
  the full on-chain lifecycle, or accept each here as a named risk.
- [ ] **Final byte-verification.** Rebuild with the pinned toolchain, compare SHA-256
  against the deployed program data one last time, record both hashes here. That pair
  is the claim that stays true forever.
- [ ] **Kill-switch drill.** Unset `RatchetX_SEAL_PROGRAM_ID` once in a preview deploy
  and confirm the site cleanly stops arming sealing. It is the only lever that survives
  the freeze; prove it moves before relying on it.
- [x] **v3 independence.** Confirmed 2026-08-25 against the v3 RFC and program
  source: v3 references v2 only as motivation — no CPI into v2, no shared accounts,
  no migration instruction; it ships as a new program id with fresh PDAs. Freezing
  v2 blocks nothing v3 needs.
- [ ] **Ceremony logistics — done by 2026-09-05, not on the day.** Solana CLI installed
  locally; the offline authority keypair located; `solana program show` dry-run passes;
  the on-chain authority address matches the held key; the fee payer holds a little SOL.

Out of scope, on purpose: the permanent log-#345 red pair is an off-chain log matter —
freezing the program neither fixes nor worsens it.

## The escape hatch, stated in advance

If, before 2026-09-08, end-to-end integration surfaces a bug in the *program itself*
(not in the site around it), we will not quietly upgrade and freeze later. We will
publish the bug, ship the fixed program under a **new** id, point the site's
`RatchetX_SEAL_PROGRAM_ID` at it, and restart the clock for the new id — in this file,
with the old date left visible above the new one. A freeze that can be silently
rescheduled is not a commitment.

## How you verify it happened

After 2026-09-08, either of these, no trust in this repository required:

- `solana program show 23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX --url mainnet-beta`
  → `Authority: none`
- The program's page on any Solana explorer → Upgradeable: **No** / Upgrade Authority:
  **none**

Once the transaction lands, its signature gets linked here.

## The ceremony (operator notes)

0. Confirm the current upgrade authority address on the program's explorer page and that
   the matching keypair is the one held offline. The authority key never touches a web
   IDE, a browser tool, or this repository — from any path.
1. Dry run: `solana program show 23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX --url mainnet-beta`
   and read the `Authority` line back.
2. Revoke, signed by the current authority keypair:
   `solana program set-upgrade-authority 23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX --final --url mainnet-beta`
   `--final` is irreversible. There is no undo, which is the product.
3. Re-run step 1 → `Authority: none`. Link the transaction signature in this file,
   update the two README lines that announce the date, and publish the post.

If the ceremony machine has no Solana CLI, install the official release binary locally
first. Do not route around a missing CLI by pasting the authority key anywhere.
