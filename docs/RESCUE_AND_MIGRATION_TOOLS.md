# Rescue and migration tools

Four tools, written on 2026-09-02/03 when the Supabase egress quota took the game
off the air and the only copy of six months of play was inside the thing that had
stopped answering. They are listed together because they are one path: get the
data out, understand it, give it a new home, and turn it into something the chain
can verify.

None of them writes to the legacy store. None of them needs a credential that
lives in a file.

| Tool | Click | Reads | Writes |
| --- | --- | --- | --- |
| `tools/supabase_rescue.mjs` | `SUPABASE_RESCUE.cmd` | the legacy Postgres, read-only | NDJSON + manifest + report, private |
| `tools/rescue_inventory.mjs` | `RESCUE_INVENTORY.cmd` | the newest rescue file | `rescue_census.txt` in the repo |
| `tools/kv_import.mjs` | `KV_IMPORT.cmd` | the newest rescue file | a Redis-protocol KV |
| `tools/live_snapshot.mjs` | `LEGACY_ROOT_LIVE.cmd` (step 1) | the LIVE store, read-only | a fresh rescue file, private |
| `tools/legacy_root.mjs` | `LEGACY_ROOT_BUILD.cmd`, or `LEGACY_ROOT_LIVE.cmd` (step 2) | the newest rescue file | `merkle_tree.json`, `merkle_balances.json`, `merkle_excluded.json` |

## Environment

**`LOCALAPPDATA`** (Windows) — the private root. All four tools resolve
`%LOCALAPPDATA%\RatchetX\private-snapshots` and keep every file that contains
player data there, never in the repository. On anything else the same role is
played by **`XDG_DATA_HOME`**, defaulting to `~/.local/share`. If neither is set
the tools stop rather than guess a location for private data.

**`KV_REST_API_URL` / `KV_REST_API_TOKEN`** — read by `kv_import.mjs` when
present, so the import can run unattended. `KV_IMPORT.cmd` collects both with
`set /p` and clears the token when node exits. They are the same variables
`lib/kv.js` reads in production.

**`RATCHET_LEGACY_DB_PASSWORD`** — read by `supabase_rescue.mjs` if set, purely so
a rerun does not have to retype it. Normally the password is typed into the
window and exists only in that process.

Nothing else. No tool reads a Supabase service key, and none writes a credential
anywhere.

## What each one refuses

`supabase_rescue` refuses to connect without the pinned Supabase CA
(`backups/pre003-20260830-P7LEkP/supabase-ca.pem`, verified by digest before use)
and asserts `default_transaction_read_only` on the session, so read-only is
Postgres's rule rather than the script's good intentions. It walks all three
connection doors — pooler session mode, pooler transaction mode, direct host —
and reads the verdict aloud, because on a restricted project an authentication
error from one door proves nothing about the credential.

`rescue_inventory` prints families and counts, never a key and never a value.

`kv_import` classifies with no network first and waits for the word IMPORT. It
maps `h:*` to HSET and `z:*` to ZADD because Redis stores those natively and a
straight copy would produce a store that loads without error and answers every
leaderboard query with nothing. A row whose value does not match the shape its
key implies stops the import before anything is sent.

`legacy_root` refuses a row it cannot turn into a leaf, a snapshot that still
holds open stake, and an empty tree — the last because an all-zero root is
exactly what the program reads as "no migration".

## Building the root from now, not from then

The rescue file was taken on 2026-09-03 at 01:40, while the game was off the air.
The site has been live since. A root built from that file is a precise,
verifiable claim about a moment that has passed, which is worse than no claim at
all — it would be wrong in a way that survives auditing.

`LEGACY_ROOT_LIVE.cmd` reads the store the game is actually using and then
builds from that. Two properties are load-bearing and both are tested:

- **It only reads.** The only commands it sends are `SCAN`, `MGET` and `PTTL`.
  Never `KEYS` — this runs against a live store.
- **It decides nothing.** It copies `u:*` rows out and writes them down. Every
  rule about who becomes a leaf stays in `legacy_root.mjs`, where it is tested
  against the program's own hashing. A snapshot tool with opinions would be a
  second source of truth about who owns what.

A TTL is written as an absolute instant rather than a duration, because a
relative TTL stops being true the moment it is saved to a file.

### It will refuse while any shot is open, and that is the point

A stake in flight is in nobody's `cr`. Those players would migrate short by
exactly that much. The refusal now says **when** the last open shot expires, so
the wait is a time rather than a guess: settlement follows expiry, and after it
every stake is back in a credit balance where a leaf can see it.

`--allow-open-stake` exists for somebody who has decided who owns that stake and
why. Nobody has.

### Demo wallets are excluded, not refused

`demo-1ff` is not an address. Demo mode issues these so somebody can try the
game with no wallet, and no keypair anywhere could sign a claim for one.
Refusing the whole root over them means no root can ever be built; dropping them
quietly means a root that decided who counts without saying so. They are
excluded by `isDemo` from `lib/verify.js` — imported, never restated — counted
on screen, and written into `merkle_tree.json` beside the root as well as into
`merkle_excluded.json`. **Read that file before compiling a root**: it is the
list of everyone the claim leaves out.

Anything malformed that is not a demo wallet still refuses the whole root.

## The order

Rescue, then census, then import, then root. The root is last on purpose: it is a
claim about who owned what, and it should be made from a snapshot somebody has
already looked at.
