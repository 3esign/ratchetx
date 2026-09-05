# Live readback: the 2026-09-08 promise is still public

**Measured 2026-09-05T13:57:47Z** from `https://ratchetx.xyz`, through the desktop
app's browser pane (the only web channel this team has: both agent shells are
egress-blocked, and the cloud container's proxy rejects `ratchetx.xyz` the same way
it rejects the Solana RPCs).

**Evidence tier: live production readback.** No key, no transaction, no deploy.

| surface | result |
| --- | --- |
| `GET /llms.txt` | 200, **11,534 bytes** |
| contains `destroyed on 2026-09-08` | **YES** |
| contains `scheduled for revocation on 2026-09-08` | **YES** |
| contains `cancelled on 2026-09-03` | **no** |
| `GET /api/proof` → `v` | `h113-2026-09-03` |
| `GET /api/game?action=state` | **500** (Upstash exhausted, unchanged) |
| `GET /README.md` | 404 (not a deployed surface; `.vercelignore` excludes `*.md`) |

11,534 bytes is byte-for-byte what I measured at 11:43Z, 12:22Z and 12:59Z. **Nothing
has been deployed in the last two and a quarter hours.**

## Why this file exists

`tools/mainnet-go-check.mjs` X1 reads `README.md`, `llms.txt`,
`docs/AGENT_STATE.json` and `docs/FREEZE.md` **on disk** and reports **GO**. Its own
detail string is honest — *"local copy corrected (live site is a separate check)"* —
but the verdict column says GO and the owner column says Semir, and a person
scanning twelve rows reads the column, not the parenthesis.

The local copy has been correct since `d7c9162`, twenty minutes into the day. The
promise is not a repository fact. It is a **public** one, and the public copy still
says:

> its upgrade authority is scheduled for revocation on 2026-09-08

> destroyed on 2026-09-08. After that nobody can change how it settles. Ever.

**The gate cannot check this itself** — the tool runs in a shell with no egress. So
the check has to be a receipt: somebody with a channel reads the live bytes and
writes down what they saw, and the gate reads the receipt.

## Suggested X1

Keep the on-disk test as a precondition, then require a readback receipt no older
than the newest deploy: verdict **PENDING** whenever the newest receipt still
reports the promise live, **GO** only when a receipt reports it corrected. That way
X1 fails for the true reason — *nobody has deployed* — instead of passing for a
reason nobody asked about.

## What actually closes it

`PUBLISH_PROMISE_FIX.cmd`, verified end to end at 12:21Z and unblocked since the
lead's `45eb1d6`. One run. **Monday is the date on the promise.**
