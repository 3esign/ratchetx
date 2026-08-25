# Freeze-date post (for the timeline)

Announces the registered date. Post any time after docs/FREEZE.md is on main — the post
links it. On 2026-09-08, after the ceremony, follow up with the verification post (bottom).

---

## Single post

We said the upgrade authority on our mainnet program was "retained during soak." A soak
period with no end date is just control with better PR. So, a date:

On **2026-09-08**, Ratchet Seal v2 (`23k3…ZEEX`) becomes immutable. We revoke the upgrade
authority — not multisig it, revoke it. After that day nobody, including us, can change
the deployed bytes.

The claim is registered in the repo before the fact — with a pre-freeze checklist we
work through in the open, the escape-hatch rule stated in advance, and instructions for
reading the answer off the chain yourself on the day:
github.com/3esign/ratchetx/blob/main/docs/FREEZE.md

Precision matters: the canonical referee is still our server, labeled on every response —
that line moves when v3 earns it on devnet, not when we tweet it. What freezes is the
receipt path players already use: sealed before expiry, provable forever.

---

## Thread version (if you'd rather thread it)

**1/** Our mainnet program's upgrade authority has been "retained during soak" since day
one. Soak periods that never end are just control with better PR. So here's a date:
**2026-09-08**, Ratchet Seal v2 becomes immutable. 🧵

**2/** Revoke, not multisig. After 09-08 nobody — including us — can change the deployed
bytes of `23k3…ZEEX`. The claim is registered in the repo before the fact, with the
escape hatch stated in advance and a verify-it-yourself section:
github.com/3esign/ratchetx/blob/main/docs/FREEZE.md

**3/** Said precisely: this does NOT make settlement "fully on-chain" — the canonical
referee is still our server, labeled on every API response, until v3 earns that role on
devnet. What freezes forever is the receipt path you already use: sealed before expiry,
wallet-bound, byte-verified against the repo.

---

## Day-of verification post (2026-09-08, after the ceremony)

Done, as registered fourteen days ago: Ratchet Seal v2 is immutable.

`solana program show 23k3…ZEEX` → **Authority: none**. Read it off the chain, not off
this post: [EXPLORER LINK] · tx: [TX LINK]

The bytes players verify today are the bytes forever. v3 next — devnet first, new id,
same rules of engagement: registered before the fact.
