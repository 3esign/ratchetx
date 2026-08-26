# The gap at entry 345

On 26 August 2026 our own verifier reported that the event log does not
verify. It was right. One entry is missing and it is never coming back.

This document is permanent. It is linked from the proof page, and the proof
page repeats the disclosure on every load.

---

## What happened

The log issues indices from an atomic counter and stores one immutable entry
per index. Entry **345** was issued and never stored: the counter advanced,
and the process ended before the entry was written.

```
missing entry 345 — 1726 issued, 1725 stored
```

This happened before **20 August 2026**, in an earlier version of the append
path. The failure mode was already known and already fixed — the fix is
described in the source comments of `lib/log.js`:

> A counter alone fixed index collisions but introduced a third failure: a
> process could die after INCR and before writing its immutable entry. That
> creates a permanent issued-but-missing index. Appends are now serialized by
> an ownership-safe lease, then the entry, counter, head and read models are
> committed in one Redis Lua transaction. There is no point at which an index
> exists without its event.

So the hole is a scar, not a wound. Every entry written since the hardening
commits atomically with its index.

## Why it cannot be repaired

The chain is `h_i = sha256(h_{i-1} + json(event_i))`. To rebuild entry 345 we
would need its event body and the hash before it. We hold neither:

- the per-index link key `g:log:h:345` expired (30-day TTL),
- `g:log:heads` retains only the last 500 indices, and 345 is far outside it,
- entry 346 stores the hash it *produced*, not the hash it consumed, and
  sha256 does not run backwards.

We could write a plausible entry 345. It would hash correctly, the page would
go green, and nobody would ever know.

That is exactly the thing this project claims is impossible, so we are not
going to do it. A log you are willing to forge once is not a log.

## What still verifies

Verification is now performed in **segments** around the disclosed index:

| segment | anchored on | status |
|---|---|---|
| 1 – 344 | genesis | replays hash-by-hash |
| 346 – head | entry 346's own stored hash | replays hash-by-hash |

The second segment's anchor is **declared, not proven** — the hash that would
prove it died with entry 345. Every entry after that anchor is proven against
it. The proof page says so in those words.

Consequences, stated plainly:

- Altering any event in either segment still breaks verification and turns the
  check red. Tamper-evidence is intact everywhere except across the single
  345/346 boundary.
- The snapshot export is **not** a complete restorable log, and the Black Box
  check is no longer green because of it. A machine rebuilt from the export is
  faithful either side of entry 345 and blind at it.
- The gap is one entry out of 1,726 — 0.06% of the log — and it is named,
  dated and published rather than smoothed over.

## The rule this created

`lib/log.js` now carries an explicit `DISCLOSED_GAPS` table. An index in that
table is verified in segments and reported as a disclosed loss. **An index not
in that table still fails the entire log, loudly, exactly as before.**

Disclosure is a deliberate act, recorded in version control, reviewable in the
diff. It is not an automatic downgrade, and it is not a way to make red lines
go away. Adding an index to that table is a public admission with a commit
hash attached to it.

## Why this is published at all

We could have quietly rebuilt the entry. We could have deleted the check. The
verifier that caught this is one we wrote, running against a log we control,
on a page we publish — every incentive pointed at silence.

The check stays. The hole stays named. If the log ever fails again, you will
read about it here first, in the same amount of detail.

We would rather be checked than believed.

---

*Discovered 2026-08-26 · `lib/log.js` · [/api/proof](https://ratchetx.xyz/api/proof) · [/api/snapshot](https://ratchetx.xyz/api/snapshot)*
