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
| `tools/legacy_root.mjs` | `LEGACY_ROOT_BUILD.cmd` | the newest rescue file | `merkle_tree.json`, `merkle_balances.json` |

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

## The order

Rescue, then census, then import, then root. The root is last on purpose: it is a
claim about who owned what, and it should be made from a snapshot somebody has
already looked at.
