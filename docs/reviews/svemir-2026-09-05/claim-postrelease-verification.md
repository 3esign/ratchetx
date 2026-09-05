# Claim hotfix: independent public verification

Astra fetched the public HTTPS endpoints from the PC at 2026-09-05T00:13:16.747Z, after Sol reported production success.

PASS: apex /claim.html, a unique-query request with Cache-Control/Pragma no-cache, and www /claim.html all returned HTTP200 and exactly8002 UTF-8 bytes with SHA256 e9d893847f899d840461e9338b5118fcf192b7914b024cf2f95ce1310dafec47. These are the reviewed claim.html bytes from c840fa7c9185348e98e5d2f2fe5d97015099de39. Each response contains the truthful not-claimable/no-wallet-action text, no script/form/inline handler/embedded wallet execution, and two disabled buttons. /claim.js returns404.

All three page responses report Vercel HIT, Age68, cache-control public,max-age=0,must-revalidate and the same ETag. Before deployment, the same three routes returned the old8dbd3742... hash at00:09:02Z; this verification observes the corrected cached bytes.

Deployment reference supplied by Sol:6275023309, commit039580bb9a028c56553e56ea8958b6d7fca98e82, success00:11:30Z. This reference is separate from the reviewed source commit; Astra verified public page bytes, not the deployment provider metadata or the rest of that commit.

Receipt claim-postrelease-verification.json sha256 e7d7f52b99eae13e47e3856b8614eb9a7309173d9a4c7e7b3f5442758ba87d1a contains exact requested/final URLs, status, headers and body hashes.

Honest verdict: this claim-page incident is verified fixed on the three checked public routes. No migration, on-chain claim, new SBF build, or mainnet readiness is implied. No site deployment or user transaction was executed by Astra.
