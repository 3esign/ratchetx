# M1: close_need, and the counter nobody wrote

Opus C, 2026-09-05. Evidence tier: **host** — read from the source, compiled by
nobody. Every line number is from the tree at commit `69f00e8`.

Nothing here touches a file I own. It exists so that whoever takes M1 starts
from measurements rather than from a design, and so the decision it needs gets
made deliberately.

## 1. The defect, measured

`open_refs` appears **four times in the repository**:

| where | what |
| --- | --- |
| `rcx-timepin-v2/src/lib.rs:451` | the field declaration |
| `rcx-timepin-v2/src/lib.rs:200` | `need.open_refs = 0` in `open_need` |
| `rcx-timepin-v2/src/lib.rs:1059` | a test fixture, `open_refs: 0` |
| `rcx-timepin-v2/src/lifecycle.rs:1636` | a test fixture, `open_refs: 0` |

There is no increment and no decrement. The field is written once, to zero, and
never read by anything.

So the guard the lead specified — `open_refs == 0` — is `0 == 0`. It passes for
every Need that has ever existed, including one that a thousand open shots are
about to settle against.

`lib.rs:452` documents an instruction that does not exist: *"Refunded in full by
`close_need`."*

## 2. Why it cannot be fixed with two lines

Only Timepin may write a Timepin account. Timepin's instruction set is
`register_evidence_spec`, `open_need`, `open_work_manifest`, `open_work_page`,
`reserve_work`, `capture_first`, `capture_conflict`, `finalize`, `expire`. **None
of them knows that a shot exists.**

Core cannot maintain the count either. It reads Needs through
`foreign_timepin::load_need` / `load_open_need` / `authenticate_final`, which
deserialise the account **read-only**; Core's only CPIs are to the memo and token
programs. There is no path by which this number could ever become non-zero.

## 3. What it costs if a close ships on the vacuous guard

A Need is **shared** — one per `(spec, target_ts)`, however many shots point at
it — and closing it deletes the account.

- `settle_final` reads the exit Need at `ratchet-core-g2/src/lib.rs:1725` and
  authenticates it at `:1731`.
- the void path reads a Need at `:1945`.

Both paths read the account that would be gone. Every shot with that exit target
becomes **unsettleable and unvoidable**. Closing is permissionless by design — the
lead's ruling, and the right one — so one crank call would do it.

Trading 1,225 SOL/year of *recoverable* rent for permanently stuck shots is the
wrong direction.

## 4. The refinement: entry and exit Needs have different lifetimes

They are not symmetric, and treating them as one halves nothing.

- **At seal** (`lib.rs:920-930`) Core calls `load_open_need` on *both*, and
  copies the entry observation into the Shot. The entry Need's fact is permanent
  in the Shot from that moment.
- **At settle** (`lib.rs:1725-1738`) Core reads the **exit** Need only.

So the entry Need stops being referenced at **seal**. Only the exit reference
outlives the transaction that creates it, and only it needs counting.

## 5. The timer is closed, and R3 closed it harder

The struct comment at `lib.rs:445-449` already rejected a timer, in the original
author's words:

> A COUNTER, NOT A TIMER. "Anyone may close N hours after the deadline" would let
> one slow crank close the Need out from under a live shot, which is the same
> defect shape as a reveal budget that depends on somebody else's speed.

That was right when it was written, and **R3 made it worse today**. Before R3,
`fixed_reveal_deadline` was `capture_deadline_ts + reveal_window` — projected at
seal, so a shot's last deadline was computable from the Need's own fields and a
retention period could have been made safe. R3 changed `settle_final` to assign
`shot.reveal_deadline_ts = max(now + reveal_window_seconds, projected)`.
Settlement can land arbitrarily late and `max()` only extends.

**After R3 a shot's life has no upper bound computable from the Need.** No
retention period is safe. Adding a field to `EvidenceSpecV2` to hold one would
buy an ABI break for a guard that still could not be right.

I proposed that timer in the room at 15:49 before reading the comment above it.
It is wrong. This section is the correction.

## 6. What is actually left

### (i) Make the counter real

`hold_need` / `release_need` in Timepin; Core calls them at seal (exit target
only, per §4) and at `settle_final`.

Correct. Two CPIs per shot, both on crank paths rather than the player's two
transactions.

**The crux is not the CPI, it is the trust edge.** Timepin must decide who is
allowed to hold and release, and today Timepin knows nothing about Core — the
dependency runs one way, `EconomyArgs.timepin_program`, and Timepin is a
general-purpose evidence layer with Core as one consumer. Two shapes:

- **Name the consumer.** A `consumer_program: Pubkey` on `EvidenceSpecV2`,
  beside the `receiver_program` / `push_oracle_program` / `wormhole_program` it
  already carries. Simple, and it makes a spec single-consumer — an
  architectural change that should be stated, not slipped in. It is also an ABI
  change to the struct C2 is re-pinning at 254 + 8 = 262 **right now**: done in
  the same pass it is one break, done separately it is two.
- **Consumer-agnostic: first holder wins.** The first `hold_need` records its
  signer as the Need's holder; `release_need` requires that same signer. Timepin
  never learns what Core is. It needs an answer to griefing — a hostile actor
  who holds first records itself and Core's holds then fail — and I do not have
  a clean one, which is why I am naming it rather than recommending it.

### (ii) Timer — **closed.** See §5.

### (iii) Do not close Needs

Delete `open_refs` and the comment promising `close_need`, and record M1 as a
**decision** rather than an unfinished row: the rent is not recovered in this
generation.

I am not recommending this. I am recording that it is the only option that costs
nothing today, so that choosing (i) is a choice made with its price visible.

## 7. What I would want asked before anyone writes code

1. Is Timepin allowed to know about Core? That is the whole of (i), and it is an
   architecture question, not an implementation detail.
2. If yes, does `consumer_program` ride the C2 re-pin, so the ABI breaks once?
3. Is M1 in scope for this generation at all, given that it is the last code row
   besides C2 and the cheap paths are gone?

The M1 gate row reads as a small piece of work. It is not, and finding that out
after somebody has written it would be the expensive way to learn it.
