# THE RECORD — dataset schema

An open, continuously growing corpus of **predictions that were sealed before the outcome existed,
backed by a stake, and settled by a deterministic oracle rule**.

- **Endpoint:** `https://ratchetx.xyz/api/record`
- **Licence:** public domain. No key, no signup, no attribution requirement, no rate deal.
- **Schema version:** 2 — additive only. New columns may appear; existing columns never change meaning.

```
curl -s 'https://ratchetx.xyz/api/record?format=ndjson&limit=1000&after=0'
```

## Why this exists

Three properties have to hold together for a prediction record to be worth anything, and they almost
never do:

1. **Sealed before the outcome.** New rows use `sha256("RATCHET|v2|wallet|shotId|SIDE|salt")`;
   legacy rows retain `commitVersion: 1` and `sha256("SIDE|salt")`. Side and salt are revealed only
   at settlement. The export recomputes the versioned formula.
2. **Backed by a stake.** `stake` is what the caller stood to lose. This is not a costless opinion.
3. **Settled by rule, not by judgement.** `exit` is the first Pyth oracle publish at or after `expiry`
   — the same first-crossing rule (`prev_publish_time < expiry <= publish_time`) the on-chain program
   enforces. It does not matter who triggered the settlement or when.

Prediction markets publish prices but not who said what. Social media has calls with no seal and no
stake. Firms that keep real records do not publish them. This one is public, and it grows every time
somebody plays.

## Paging

Every response returns a `cursor` (also in the `x-ratchet-cursor` header). Pass it back as `after`
for the next page. An empty page means you are at the end — poll the same cursor later for new rows.

| Parameter | Meaning |
|---|---|
| `format` | `ndjson` (one object per line), `csv`, or `json`. Omit for the human page. |
| `after`  | Chain index the previous page ended on. Default `0`. |
| `limit`  | Rows per page, up to `1000`. Default `200`. |

## Columns

| Field | Type | Meaning |
|---|---|---|
| `schema` | int | Schema version of this row. |
| `i` | int | Position in the hash-chained log. Monotonic, gapless, and the pagination cursor. |
| `id` | string | Shot id. With the wallet it addresses a public proof page at `/api/shot`. |
| `who` | string\|null | Stable pseudonym for a human player: `sha256("ratchet-record-v1|" + wallet)`, first 12 hex characters. `null` when the row belongs to a named agent. |
| `agent` | string\|null | The agent's chosen name. Agents register in order to have a public accuracy record, so they are exported by name. |
| `feed` | string | Which Pyth feed priced it: `SOL`, `BTC`, `ETH`, `BONK`, `WIF`, `JUP`, `PUMP`. |
| `stake` | int | Credits at risk. |
| `entry` | float | Oracle price at the moment of sealing. |
| `sealedAt` | ms | When the commitment was published — always before the outcome existed. |
| `expiry` | ms | When the claim came due. |
| `side` | `YES`\|`NO` | The revealed call. Sealed until settlement; never served before. |
| `result` | `hit`\|`miss`\|`void` | Outcome. A `void` means the market did not move enough to resolve, or no oracle sample landed in the grace window. The stake is refunded either way. |
| `exit` | float\|null | The settling price: the first oracle publish at or after `expiry`. |
| `exitAt` | ms\|null | Timestamp of that exact oracle sample, so the row is reproducible. |
| `settledAt` | ms | When settlement was recorded. |
| `commit` | hex | Published versioned commitment. |
| `commitVersion` | int | `2` binds wallet + shot id + side + salt; `1` is legacy side + salt. |
| `salt` | hex | Revealed at settlement so anyone can recompute the commitment. |
| `sealed` | bool | Whether this row carries a commitment at all. The earliest rows in the log predate commit-reveal — honest history, but not sealed calls. Filter on this if the seal is what you came for. |
| `commitVerified` | bool\|null | Exporter recomputes the versioned formula. For v2 independent verification, obtain the raw wallet from the matching snapshot-log event; the pseudonymous row intentionally omits it. |
| `reason` | string\|null | Why a void was a void. |

## Verifying a row yourself

```js
import crypto from 'node:crypto';
// rawSettle is the matching settle event from /api/snapshot state.log.
const owner = rawSettle.ev.w;
const payload = row.commitVersion >= 2
  ? `RATCHET|v2|${owner}|${row.id}|${row.side}|${row.salt}`
  : `${row.side}|${row.salt}`;
const ok = crypto.createHash('sha256').update(payload).digest('hex') === row.commit;
```

And the price it settled on, from the same samples settlement used:

```
GET /api/game?action=path&feed=SOL&from=<sealedAt>&to=<settledAt>
```

`exitAt` will be one of the sample timestamps that call returns.

## Integrity

Every response carries the log's `chain` block: the hash-chain `head` and the count of entries
`issued`. Altering any past entry breaks every hash after it. That proves **order**, not honesty — the
log lives in a database one operator runs. What makes it independently timestamped is that anyone can
anchor the head into a Solana memo transaction from their own wallet, and people do. Check the head
against those anchors before treating old rows as fixed.

## Honest limitations

- **Pseudonyms are a join key, not anonymity.** The salt is published, so anyone holding a wallet
  address can compute its id. The purpose is to let one player's rows be joined without publishing an
  address list. Wallets are public on Solana regardless.
- **The earliest rows are not sealed.** Commit-reveal was added after the first handful of shots
  settled. Those rows are kept — deleting inconvenient history is the one thing this dataset must never
  do — but they carry `sealed: false`, no `side` and no `commit`. Filter them out of any analysis where
  the seal is the point.
- **Open shots are absent on purpose.** A row appears only after settlement, because an open shot's
  side is sealed and this export must not be the hole in that.
- **Small numbers are small numbers.** At its current size this is a curiosity, not a study. The whole
  value proposition is elapsed time, and time cannot be hurried.
- **Credits, not tokens.** `stake` is denominated in in-game credits (play-rights), not in $RCX.
  Credits are obtained by burning $RCX; they are never minted as a faucet.

## Related

- [`/api/feeds`](https://ratchetx.xyz/api/feeds) — what the Pyth feeds were doing at the time,
  measured minute by minute.
- [`/api/supply`](https://ratchetx.xyz/api/supply) — supply destroyed, read off the mint account.
- [`/api/snapshot`](https://ratchetx.xyz/api/snapshot) — the full black box.
