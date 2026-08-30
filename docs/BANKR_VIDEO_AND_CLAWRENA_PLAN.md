# Bankr video, Clawrena application, and on-chain next steps

Verified/planned 2026-08-30. No new forecast, registration, token launch or fee
change was executed while preparing this plan. Production baseline: h104.

## 1. What is done

The scoped owner-session pilot is completed, not global permission for all X users.
Bankr reports shot6cce3cd29ed6: actual submit200 and immediate replay200/idempotent,
one100-credit debit, HIT, return170. Public shot/report independently matched HIT,
stake100/return170 and15 stated calls/Brier0.2945. The private wire journal was not
independently inspected. User reports all grants revoked. A new recording needs
a fresh explicit permission, not reuse of old credentials or another demo identity.
Pyth observations are on Solana; current game credits/settlement remain server-canonical.

## 2. Minimal recording procedure

1. Privately open https://ratchetx.xyz/play-session.html with the same admitted
   wallet. Fresh grant: one attempt,100 maximum stake,100 gross credits,30 minutes,
   minimum interval60 seconds. Start promptly: runner requires22 minutes remaining.
2. Replace ONLY the protected Bankr agent environment variable
   `RATCHET_PLAY_SESSION`. Keep token off X, chat, screen recording and logs.
   Keep the public session ID. This does not grant transfers or credit reloads.
3. From the same X account linked to that Bankr environment, send the request
   below. Wallet and session ID are public; the bearer credential is never public.
4. Record the public command, accepted shot and limit, then the terminal result
   and exact proof. Disclose any time cut. A MISS is a valid completed test.
5. If interrupted, resume the SAME private journal in status-only mode. Do not
   send another execute request, change the ID, create a demo or expand limits.
   On stale/refusal/uncertainty, stop and report the code. No automatic retry.
6. Revoke from owner controls after completion. Never display the generated secret.

Pasteable X request (replace only SESSION_ID; YES/.55 is an explicit demonstration
intent, not a claim of analysis or investment advice):

> @bankrbot Run ONE approved RatchetX owner-session test using the installed
> session-smoke.mjs and its owner-session-test.md runbook. Expected owner:
> HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM. Session: SESSION_ID.
> Use the current five-minute directional target: YES, probability0.55,
> stake100 play credits. Use the protected RATCHET_PLAY_SESSION; never reveal it.
> Submit once, immediately verify the identical HTTP replay, then collect
> settlement and return the shot proof, balance delta and Brier result.
> Keep the private journal. No demo fallback, new grant, transfer or reload.
> Stop on refusal; resume an interrupted run only from its existing journal.

Runbook: https://ratchetx.xyz/skills/ratchetx/references/owner-session-test.md
The runtime may need a later status-only resume; an X reply is not a guaranteed
background scheduler. If the installed/protected runtime is unavailable, BLOCKED.

Suggested video narration: “I give an agent one limited permission. I ask it on X
to make a forecast. RatchetX records it, resolves from Pyth price observations and
shows the result. The same request cannot debit me twice. I can revoke permission.”
Finish: “Working owner pilot today; moving the authoritative game to Solana next.”

## 3. ClawPump AnsemHack entry

Official page: https://clawpump.tech/ansemhack . Registration/tokenization deadline
19 September2026; judging20–30 September; winner1 October. Cutoff timezone unstated.
Existing-token path: https://clawpump.tech/dashboard/migrate . Existing pump.fun
tokens supported in published UI; actual RCX mint/fee eligibility remains unverified.
No replacement token is proposed. Select ClawPump × pump.fun builder/tooling focus;
do not claim trader performance from one pilot or an inference integration we lack.

Draft form:
- Project: RatchetX; ticker: RCX; website: https://ratchetx.xyz
- X: @SonyxEth if this is the account used for token verification; keep both identical.
- Pitch: “An agent-native forecasting arena with Pyth price evidence, probability
  scorecards and bounded wallet-approved play. Working Bankr owner pilot; building
  a fully on-chain game kernel with permissionless settlement and agent limits.”
- Contact email: owner must choose/confirm; do not infer it from old account details.
- Token link: verified migrated ClawPump token page, once eligible and approved.

Register the project, publish the generated announcement and follow @clawpumptech.
Verify token using the same registered X identity before the deadline. Registration
alone is not full eligibility. No official partnership/endorsement claim.

IMPORTANT FEE AUTHORITY GATE: published migration UI requests the generated
ClawPump wallet as the SOLE creator-fee recipient (only shareholder), then collects
all creator fees and redistributes owner/treasury shares. UI defaults are75/25,
but configured `agentBps`/`treasuryBps` load dynamically. This is NOT merely a direct
25% allocation. Payout wallet is described as locked at setup. Owner's approval
of25% alone is not approval to route100% through this collector. Before any signature:
verify configured split, payout wallet, exact collector, RCX eligibility, fees and
reversibility/authority. Obtain explicit consent to the whole routing model.
The launch page's35% platform share is a different path. Do not alter Ratchet's
70/30/0 play economy or grant ClawPump token supply/game balances.

Public migration UI inspected from
https://clawpump.tech/_next/static/chunks/0pildtxa~4.5-.js . Recheck live terms before
acting; this is evidence of displayed instructions, not an audit of collector code.

## 4. Efficient development order

1. Record the proven owner flow and prepare entry; no speculative new integrations.
2. Make independent-user setup repeatable with explicit limits, proof and revocation.
   Do not fund other players or claim global Bankr support without testing it.
3. G0: reconcile current balances/obligations, rotate previously exposed operator
   credentials, establish quota headroom. Revoking play grants does not rotate DB keys.
4. G1 FIRST: specify chain-verifiable oracle selection and attack withholding,
   missing updates, same-time revisions and profitable forced VOID without funds.
5. G2/G3: minimal one-market atomic kernel: admission, credits, shot/debit/replay,
   outcome/payout/score, followed by chain-enforced delegated limits. Current HTTP
   bearer is NOT a Solana signer; prove an actual supported signing transport.
6. G4/G5: JS/Rust parity, adversarial tests, measured cost, independent review,
   capped approved pilot, reconciled one-time legacy claims without double spend.
7. G6: disable Ratchet API/DB/keeper; independent clients must still play, settle,
   revoke and verify. UI/MCP/indexers can remain replaceable off-chain clients.

Detailed gates: ONCHAIN_MIGRATION_PLAN.md. Do not promise all-on-chain by the event
deadline or silently change the existing oracle/economic rules to accelerate entry.

## 5. Next product requirement: link once, approve on Ratchet, command on X

Requested2026-08-30. This is NOT implemented by h104: completed pilot is distinct
from seamless pairing, multi-attempt operation and profile management.

h105 deployed adds the landing CTA, one/five-request presets, owner-bound public
copy commands, skill1.3.0 and the per-command `session-play.mjs` controller. Once
deployed and tested in Bankr, record actual X runtime evidence separately. The
owner must still privately replace `RATCHET_PLAY_SESSION` after each new grant;
there is no automatic pairing, cryptographic X identity or profile editing.
Public IDs do not authorize play; Bankr must validate its trusted requester
before accessing the per-user secret. Never mistake a claimed handle for proof.

- Expose Agent Controls from the main game. Show linked agent, wallet, approval
  limits, expiry, attempts remaining, active shot/result and explicit revoke.
- One-time private pairing binds the Ratchet owner and the user's Bankr runtime;
  a public X handle or wallet address alone proves neither identity nor authority.
- Every new session still needs owner approval. A signed grant-ready event may
  notify the linked Bankr webhook, or the next X command may check for new grants.
  Notifications contain only public IDs/event nonces, never the play credential.
- Proposed single-use, short-lived claim must be bound to the paired principal,
  exact owner and signed grant, with replay/revocation/replacement protection.
  Claim authority cannot create grants or itself play. Token delivery must remain
  inside protected runtime/storage without prompt, webhook-log or URL exposure.
  Current hash-only tokens cannot simply be recovered and forwarded; this needs
  a reviewed issuance/claim protocol and proven runtime support.
- Bankr checks authority before each command. Natural language maps to explicit
  actions: stats/read; one100-credit forecast; a separately approved bounded series;
  status-only resume. An API grant cap is not an instruction to auto-run a series.
- Extend the controller beyond the one-attempt smoke runner; durable per-intent
  IDs, exact retries, one-open-shot policy, aggregate caps, stop conditions and
  restart journal. Public replies contain safe results/proofs, not credentials.
- Profile name/bio editing is a separate opt-in scoped API, with validation and
  audit trail; not currently in shot/status capability. Never permit editing past
  outcomes, Brier, earned balances or wallet ownership through a profile command.
- Pairing/revocation grants no background schedule or guaranteed X publication.
  Test two independent users, stolen event IDs, wrong runtime, duplicate delivery,
  expired claims and revocation; no cross-user fallback or broad Bankr master key.

Bankr documents per-wallet env APIs and user webhooks, but those do not establish
a plug-and-play third-party secret handoff or generic Ratchet OAuth support:
https://docs.bankr.bot/agent/advanced/
https://docs.bankr.bot/agent-api/overview/
https://docs.bankr.bot/webhooks/overview/
