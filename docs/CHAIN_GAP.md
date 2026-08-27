# The day our own verifier said the log did not verify

On 26 August 2026 the proof page went red:

```
broken at index 345 — missing entry 345 — 1726 issued, 1725 stored
```

Then, when we improved the verifier, it went redder:

```
broken at index 1 — hash mismatch
```

This document is what we found. It is permanent, it is linked from the proof
page, and the proof page repeats its conclusion on every load.

**The finding, in one line:** the log was never altered. We hashed the
*serialization* instead of the *value*, and the database re-sorted the
serialization. One entry is genuinely lost. Everything else reproduces.

---

## 1. What actually happened

The chain is `h_i = sha256(h_{i-1} + json(entry))`, and `json` was
`JSON.stringify`, which emits keys in **insertion order**.

Postgres `jsonb` does not store JSON text. It parses, and returns keys in *its*
canonical order — shortest key first, then bytewise. When the KV backend moved
to Supabase, every stored entry came back with its keys rearranged. The values
were untouched. The bytes were not.

So the hash stopped reproducing, everywhere at once.

You can see the fingerprint in the data. The outer entry is written as
`{i, t, ev}` with `h` appended, and comes back as:

```
h, i, t, ev
```

which is exactly `jsonb`'s ordering of those four keys. The same is true one
level down, and one level below that.

**Proof rather than argument.** Entry 1 is a seal written on 19 August. Taking
the key order from that day's `append()` call site — `k, w, id, feed, side,
stake, exp, entry` — and re-hashing reproduces the stored hash exactly:

```
recomputed  4079f90251ba5a800a4fb2e803176b92337693979497731efb33d213b0ff96dd
stored      4079f90251ba5a800a4fb2e803176b92337693979497731efb33d213b0ff96dd
```

Nothing was altered. We simply could no longer rebuild the input, because the
storage layer had normalised it out from under the hash.

## 2. What we measured

The log holds 2,045 entries. Every one of them was re-checked by recovering the
key order it was written in — from templates harvested out of this repository's
own git history (50 distinct `append()` orders across 168 commits), and, for
event shapes carrying nested payout lists, by searching nested orders too.

| | |
|---|---|
| entries held | 2,045 |
| reproduce their own hash | **2,044** |
| lost before they were ever stored | **1** (index 345) |
| links that cannot be proven | **1** (345 → 346) |

Index 346 is not a discrepancy. Its previous hash *is* entry 345's hash, which
is gone, so no ordering and no search can verify that one link. That is
arithmetic, and it is counted separately from a failure.

**A changed value cannot be rescued by any ordering.** The recovery is
exhaustive, so if a stored amount had ever been edited, no permutation would
reproduce its hash and it would still be sitting in the unrecovered column.
There is a test that does exactly this — it changes a payout inside a nested
list and confirms no ordering rescues it.

## 3. The one entry that is really gone

Entry **345** was issued and never stored: the counter advanced, then the
process ended before the entry was written. This happened before 20 August
2026, in an earlier append path, and the failure mode was already known and
fixed — appends are now serialized by a lease and the entry, counter, head and
read models commit in one transaction.

It cannot be rebuilt. The per-index link key expired, `g:log:heads` retains only
the last 500 indices, and sha256 does not run backwards.

We could write a plausible entry 345. It would hash correctly, the page would
go green, and nobody would ever know. That is precisely the forgery this log
exists to make impossible, so the hole stays.

## 4. The fix

**Canonical hashing.** New entries are hashed over deterministically sorted
bytes and carry `c:1` in the body, so every entry declares the rule it was made
under. The chain no longer depends on how any database, driver or JSON
implementation hands an object back. This is the fix every hash chain over
structured data needs, and we needed it a week ago.

**Recovery, not rewriting.** The old entries are read by replaying the order
they were written in. No stored hash and no stored entry is modified — a shape
that cannot be recovered is reported, never quietly passed. The template table
is derived by `tools/harvest-orders.mjs` from git history, so anyone with the
repo can re-derive it rather than taking our word for it.

**Check it yourself:**

```bash
node tools/chain-diag.mjs                       # reads the public snapshot
node tools/chain-diag.mjs ./snapshot.json       # or a copy you saved
```

Or walk the log in pages, which does not require downloading the whole state
and is how the gap is visible without trusting any summary of it:

```bash
curl -s 'https://ratchetx.xyz/api/log?i=345'          # nothing stored there
curl -s 'https://ratchetx.xyz/api/log?after=340&limit=10' | grep -o '"i":3[45][0-9]'
```

The second call returns indices 341-344 and 346-350. 345 is simply not there,
and `missingInRange` says so in the same response.

## 5. What this cost, honestly

For several days the proof page told anyone who looked that the event log did
not verify. That was true, and it was our own check that said so — but the
reason was a serialization bug, not tampering, and we did not know which until
we measured it.

We could have removed the check, quietly rebuilt the entry, or shipped a
verifier that skipped what it could not explain. The check stays, the hole stays
named, and the number on this page is 2,044 of 2,045 rather than a rounder one.

We would rather be checked than believed.

---

*Found 2026-08-26 · resolved 2026-08-27 · `lib/canon.js`, `lib/legacy_chain.js`,
`tools/chain-diag.mjs`, `tools/harvest-orders.mjs` ·
[/api/proof](https://ratchetx.xyz/api/proof) · [/api/snapshot](https://ratchetx.xyz/api/snapshot)*
