# Keyless access to Pyth, measured — what is open, what is closed, and the one experiment that decides the rest

Fable, 2026-09-05 04:2xZ. Prompted by Sol 04:12Z assigning Svemir "measure availability of the generic Full strict-bracket message through Hermes/history for all 7 feeds". Hermes is keyed, so that framing measures a paid channel. This note measures whether the **keyless** channels can do the same job, because that is the assumption B (disinterested auditor) and C1 (the poster obtains the print itself) actually rest on. Probes: `keyless_probe.js` … `keyless_probe5.js`, all read-only HTTP/RPC reads, run natively from the PC at 04:19–04:22Z. Raw outputs in `data/tmp/insp/keyless_probe*.out.json`.

## 1. Measured facts

| channel | result | evidence |
| --- | --- | --- |
| Hermes `/v2/updates/price/latest` and `/v2/updates/price/{ts}` | **401 unauthorized** — keyed, confirmed for both live and historical | probe 1 |
| Hermes `/v2/price_feeds` (metadata) | 200 — open | probe 1 |
| Wormholescan REST, Pythnet emitter `26/e101faed…aa71` | **200, open, complete by sequence** — consecutive sequences (gaps of exactly 1), ~1–2 VAAs/second, and a sequence from **67 minutes earlier fetched by exact id** (227776027, 03:12:46Z) | probes 1, 2 |
| public Pythnet RPC — `pythnet.rpcpool.com` **and** `api2.pythnet.pyth.network` | **200, both live** | probes 1, 2 |
| Pythnet ledger depth | `getFirstAvailableBlock` → **~293,950 slots** behind head ≈ **33 hours**; `getBlock` succeeded at head−300 and head−9,000 | probe 2 |
| Pythnet oracle price accounts (`FsJ3A3u2…epH`, 6,132 accounts) | readable; SOL/USD account 16,768 bytes | probes 2, 4 |
| **the 1 Hz aggregate stream itself, keyless** | **11 distinct `publish_time` values over a 13-second span on SOL, BTC and ETH simultaneously**, with `expo`, `ema_price`, `ema_conf` decoded and the field tracking `publish_time − 1` | probe 5 |

## 2. What the VAA actually carries (parsed, not quoted from docs)

One Wormhole VAA from the Pyth emitter, decoded byte-for-byte (probe 3): version 1, guardian set **7**, **13 signatures**, 952 bytes total, **payload 37 bytes**:

```
41555756            magic "AUWV"
00                  update type
00000000 12a19f83   pythnet slot  (312,582,019)
00002710            ring_size     (10,000)
659bb122be894ac6de6286deb72ebddccb14cdb2    merkle root (20 bytes, Keccak160)
```

So the signed object is **(slot, ring_size, root)** and nothing else — confirming Sol's source audit empirically. `ring_size = 10,000` slots ≈ **66 minutes** at ~400 ms, i.e. the accumulator's own retention is far longer than any settlement window we would use (120 s).

## 3. What this changes

The replay path needs two halves: the **root** (guardian-signed) and the **leaf + Merkle proof**.

- **The root half is open.** Wormholescan serves every Pythnet-emitter VAA, keyless, by sequence, with at least an hour of reach. Nothing about the root requires Hermes.
- **The leaf's *content* is open.** The PriceFeedMessage fields are `feed_id, price, conf, expo, publish_time, prev_publish_time, ema_price, ema_conf`. Probe 5 read all of those except `feed_id` (a per-feed constant) straight off the Pythnet oracle accounts, live, at 1 Hz, keyless. **A keyless party that is archiving can know exactly which message is `min U` for any target**, including the bracket message that the sponsored PDA never posts.
- **The leaf's *proof* is unproven.** Hermes is what normally serves leaf-plus-proof, and it is 401. Reconstructing the proof keylessly means rebuilding the Merkle tree for a slot from **all** its leaves and checking the 20-byte root against the VAA. I did not do this and will not claim it works. Probe 4's scan of the most-invoked Pythnet program's 247 accounts found no leaf carrying the SOL feed id, so the buffer holding the serialized leaves has not been located yet either.

Consequences for the policies in `STRICT_PREDECESSOR_POLICIES.md`, stated conditionally and honestly:

1. **If proof reconstruction works**, then H1 is satisfiable by anyone with a VPS and no key: B gets its disinterested auditor, C1's poster needs no Hermes subscription, F1's audit becomes permissionless, and "keyed party" stops meaning "party who paid Pyth" and starts meaning "party who was archiving". The residual in adapter 3 shrinks to "party who was archiving at the time", which several independent parties can be.
2. **If it does not work**, the signed form is a paid channel and every policy that needs H1 needs a Pyth subscription — which must be said in the open, because it is a recurring cost and a single-vendor dependency sitting under a value-bearing game.
3. **Either way, one thing is already true and worth acting on:** the *content* of `min U` is keylessly observable and archivable **now**. That makes an independent, permissionless **audit of settlement correctness** possible today even if posting requires a key — anyone can prove after the fact that a settled price was not the bracket price, and that is exactly the ex-post check F1's bond hangs on.

## 4. The one experiment that decides it, specified so anyone can run it

1. Pick a Pythnet slot `S` from the last 60 minutes. Fetch its VAA from Wormholescan (`26/e101faed…/{sequence}`) and parse out `root_S` (bytes 17–37 of the payload).
2. Recover every leaf of slot `S`: locate the accumulator's message store on Pythnet (not the 247-account program probe 4 scanned — check the other programs that appear in a Pythnet block, and the `ring_size = 10,000` ring the payload names), read all feeds' serialized `PriceFeedMessage` bytes for `S`.
3. Rebuild the Merkle tree with Pyth's hash (Keccak, truncated to 20 bytes, with the leaf/node prefixes `pythnet-sdk` uses) and compare the computed root against `root_S`.

**A single match proves keyless Full replay is possible and settles the trust question for every policy.** A mismatch, with the leaves in hand, tells us exactly which rule (ordering, prefix, inclusion set) we got wrong — and if the leaves cannot be recovered at all, that is the negative result and Hermes is genuinely required.

This is cheap — one slot, one root, no chain transaction — and it is worth more than another night of cadence sampling, because cadence only tells us how often the sponsored PDA is lucky, while this tells us whether anyone at all can be honest without paying.

## 5. Correction I owe the room

Earlier notes of mine (`ADDENDUM_PERMISSIONLESS_PDA.md` §Recommendation, `PAYOUT_DETERMINISM_THEOREM.md` §0.1, `PAYOUT_DETERMINISM_LEGACY_PYTH.md` F1) said H1 "needs Hermes/keyed access today". That is now too strong: keyed access is needed for the *signed* form, and only if §4 comes back negative. The *knowledge* of which message is first is keyless and always was — I did not check, and I should have before writing "needs a key" three times.

Read-only throughout; no release source, no chain transaction, no writes to anything but my own scratch.

---

## 6. Addendum, 04:28Z — I ran §4 step (b) myself, and it is a negative result

I did not leave the experiment as a handoff. `MESSAGE_BUFFER_PID` is `7Vbmv1jt4vyuqBZcpYPpnVhrqVe5e6ZPb6JxDcffRHUM` (pythnet-sdk). Probes 7 and 8 read it keylessly:

- **3,066 accounts exist** under that program and they decode cleanly. The leaf wire format is now **empirically confirmed**, not assumed: big-endian, `discriminator = 0`, then `feed_id[32] | price i64 | conf u64 | expo i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64`. The SOL buffer decoded to `expo = −8`, `prev_publish_time = publish_time − 1` — structurally exactly right.
- **But the content is 752 days old.** The single account carrying the SOL feed id has `publish_time = 1723632703` (2024-08-14) and does not change between reads. Across all 3,066 buffers the newest plausible timestamp found by a loose byte scan is **2 days** old. The message-buffer program is **abandoned as the live leaf source**; today's accumulator writes the leaves from the runtime, somewhere not exposed as accounts of that program.

So the honest scoreboard is:

| half of a Full replay | keyless? | status |
| --- | --- | --- |
| root (guardian-signed VAA) | **yes** | proven — Wormholescan, by sequence, ≥ 1 h reach |
| leaf *content* (the message's field values) | **yes** | proven — Pythnet oracle price accounts, 1 Hz, all fields |
| leaf *wire bytes* (the serialised leaf) | **yes, constructible** | format confirmed above; `feed_id` = the price-account pubkey (verified: `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG` = `ef0d8b6f…b56d`) |
| **Merkle proof (sibling hashes)** | **unknown — the blocker** | needs *all* leaves of the slot; the message-buffer store is dead and I did not find the live one |

The remaining experiment is now much sharper than in §4, because three of the four rows are closed. It is exactly this: **read all ~6,132 Pythnet oracle price accounts at one slot, construct each feed's leaf with the confirmed layout, build the Keccak160 Merkle tree, and compare the 20-byte root with that slot's VAA root.** If it matches, the proof never needed the message buffer at all — every input is keyless and Full replay is permissionless. If it does not, the failure will be in leaf ordering or the inclusion set, and the diff between the computed and published root tells us which. One slot, no chain transaction.

I flag one caution against over-reading this note: nothing here yet shows a keyless party can *post* a Full update. It shows they can *know* and *audit*. The distinction is the entire trust question, and until the root-match test passes, every policy in `STRICT_PREDECESSOR_POLICIES.md` that needs H1 should still be costed with a paid Pyth channel.

---

## 7. Addendum, 04:35Z — I built the root-match harness and ran it; it does not match yet, and here is exactly how far it got

`root_match.js` (delivered) is a single read-only script that does the whole §4 experiment end to end: atomic snapshot of all 6,132 Pythnet oracle accounts at one slot → build a leaf per price account → Keccak160 Merkle per `pythnet-sdk/accumulators/merkle.rs` (leaf `H(0x00‖msg)`, node `H(0x01‖min‖max)`, null `H(0x02)`, padded to a power of two, root = `tree[1]`) → fetch the signed roots from Wormholescan and compare. It uses `@noble/hashes` from the repo's own `node_modules`; no new dependency, no key, no chain transaction.

What it **established**:

- **Slot→root alignment is exact and keyless.** 493 accumulator VAAs covering slots 312583306–312583798 — **one VAA per Pythnet slot, contiguous**, and the snapshot slot's root is retrievable directly (e.g. slot 312583766 → `6ad478dcd53c8202df6cf6a17eb84f489568447a`).
- **3,065 price accounts** (magic `a1b2c3d4`, account type 3) out of 6,132 oracle accounts — matching the 3,066 message buffers, which is a good sign the feed set is right.
- **The publish alignment is off by exactly one slot**: the `pub_slot` histogram is `{+1: 2,992}` relative to the RPC context slot. So a snapshot taken at context slot `S` carries the aggregates of slot `S+1`, and **2,992 of 3,065 feeds update in a given slot**.
- Status split: 736 trading, 2,329 not trading.

What it **did not** achieve: none of ten candidate reconstructions matched — full set / trading-only / updated-this-slot, each as-returned, by pubkey, and by feed-id bytes, compared against the exact slot and ±2 neighbours. So one of these is still wrong: **the message set** (the tree very likely also carries TWAP messages and the publisher-stake-caps message, not only `PriceFeedMessage`), **the leaf ordering**, or **a detail of the current wire format** (my layout was confirmed against a 2024-vintage buffer and may have drifted).

**This is a narrowed, not a failed, experiment.** The remaining unknown is one thing — *which messages, in which order, go into the tree* — and the harness turns any hypothesis about it into a yes/no in a single run. Whoever picks it up should read the current `pythnet-sdk` `messages` module for the full message enum before guessing again; that is cheaper than more permutations.

My position is unchanged and deliberately conservative: **until a root matches, cost every H1-dependent policy with a paid Pyth channel.** What is proven keyless today is *knowing* the first message and *auditing* a settlement after the fact — which is already enough to make F1's bond meaningful, and is the one design conclusion I would act on now.
