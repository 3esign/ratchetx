# Core G2 identity: independent public review

Astra, 2026-09-05, responding to Sol's 01:19:50Z preflight stop. This supersedes the **assumed cGf canonical identity** in Astra's earlier first-launch handoff; preserve that frozen handoff as historical evidence. It does not change C8 Timepin or authorize a deployment.

## Recommendation

Use the already held G2 target identity **ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL** for the new G2 source candidate, once Sol records the exact named-key public derivation as its custody evidence. Preserve the old `fbdc173b537a106fb9e27827f820f030bf4891c3` source checkpoint and make a new commit. Do not reclassify the old checkpoint as ANV.

This recommendation follows the observed absence of ANV on mainnet/devnet and the existing devnet program at 6sJn. Astra inspected only public RPC and source/Markdown mappings. Key possession is Sol's independently obtained public preflight result, not something Astra has verified by reading secrets.

## Observed chain state

All RPC requests below explicitly used finalized commitment for account/history reads and verified the cluster genesis. Mainnet was checked through the official endpoint and PublicNode; devnet through the official endpoint.

| Public identity | Mainnet observations | Devnet observation | Conclusion within this evidence |
| --- | --- | --- | --- |
| `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` | Account absent, signature result empty on both providers at slots 444392891 and 444392889, around 01:25Z. | Executable upgradeable-loader Program at slot 493300425. ProgramData `HVWntYdDSgmrbvWtjocx3m1yfToFcaLi6feuQqfTxk9G`; last deploy slot 491787400; authority `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`; ProgramData space 414405 bytes. Three inspected recent successful transactions actually invoke this program. | Existing devnet deployment, not a fresh cross-cluster namespace. Mainnet currently absent. Reusing it would entail deliberate treatment of the old devnet program and authority. |
| `cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN` | Account absent on both providers at the same slots; indexed signatures exist. | Account absent at slot 493300425; indexed signatures exist. | Public absence does not solve missing custody. Sampled transactions reference cGf through other programs; they do not prove a Ratchet Core deployment. |
| `ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL` | Account absent and signature result empty on both providers, slots 444393329 and 444393327, 01:27:24-26Z. | Account absent and signature result empty at slot 493301237. | No deployment or indexed address history observed on these endpoints. This is the preferable held G2 namespace among the examined choices. |

A successful null account read describes absence at the requested commitment. An empty signature result is bounded by the provider's indexed history; neither is a proof of never having been used. Signatures identify transactions that reference the address in account keys, so a signature alone is not deployment evidence. These interpretations follow the official [account query](https://solana.com/docs/rpc/http/getaccountinfo) and [signature query](https://solana.com/docs/rpc/http/getsignaturesforaddress) documentation.

Program-address custody and upgrade-authority custody are separate. Possession of the 6sJn program key alone would not authorize upgrading its existing devnet ProgramData. No upgrade-authority possession was independently established by Astra here, and no such action is needed for the ANV recommendation.

## Documented mapping, independently checked

The bounded native scan read 134 source/Markdown files, excluded target/node_modules/credential files, and saved `core-public-mapping.json` in Astra's scratch directory. It confirmed:

- Core v1 maps to 6sJn in `onchain/ratchet-core/programs/ratchet-core/src/lib.rs:28`, `onchain/ratchet-core/Anchor.toml:10`, `onchain/ratchet-core/client/core.mjs:12`, and the v1 SVM test. `docs/CORE.md:12` documents that identity; `docs/FINISH_PLAN_2026-09-02.md:29` names `D:/keys/ratchet-core-program.json` for the devnet deployment. `docs/PERMANENCE_EXECUTION_PLAN.md:234` already calls it a devnet prototype. The public RPC finding agrees with those documents.
- G2 still names cGf in `onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs:34`, `onchain/ratchet-core-g2/Anchor.toml:9`, `onchain/ratchet-core-g2/legacy-snapshot.mjs:25`, and `onchain/ratchet-core-g2/svm-tests/tests/core_g2_lifecycle.rs:84`.
- Sol's reported named-key public derivation found ANV at the G2 target key and found no cGf match among the 11 explicitly named repo keypairs. Astra did not repeat or expand that credential inspection. No document was treated as authority to deploy or freeze.

## Exact retarget consequences for Sol's source/build lane

1. Record the new canonical G2 public identity and the existing named-key custody result. Preserve the immutable old source checkpoint. Update the G2 `declare_id!`, Anchor configuration, SVM program-id loader, executable client/runner defaults and identity manifests in a new reviewed commit. Do not globally replace 6sJn in the v1 source, historical receipts or frozen handoffs.
2. Every Core-derived PDA moves because the deriving program changes: Economy, Ruleset, Ledger, Shot, PlayerDay, RankShard, DayFinal, HistoryPage, ReloadHistoryPage, WorkPage, WorkManifest, DelegateGrant and the upgradeable-loader ProgramData PDA. Derive them again rather than copying old addresses. An identical EconomyArgs/RulesetArgs payload can retain its content hash, but its account address still changes; verify exact payloads before asserting identical hashes.
3. Core-bound cryptographic outputs change. Current `state.rs` includes `crate::ID` in `commitment_hash:824`, `legacy_leaf:847`, `game_result_hash:1118`, `completion_result_hash:1852`, and `reload_route_memo:1871`. Regenerate their reference outputs with ANV and revalidate receipt consumers. Old commitments, completion proofs or legacy Merkle proofs must not be replayed into the new program. Automatic legacy claims remain outside the first-launch dependency; preserve the snapshot and recompute future migration proofs against the finally chosen Core identity if that path is used.
4. Content hashes whose preimages omit Core ID do not all change automatically. The current Economy/Ruleset argument hashes and rank/day digests require a field-level check, not an indiscriminate hash replacement. The RCX mint and Token-2022 program do not change. Timepin C8 ID and Timepin-only Need/Candidate derivations remain tied to C8; do not revive US517 or retarget Timepin to solve Core custody.
5. Produce/re-lock the new Core ELF, exact byte length, source commit and loader/authority expectations; execute the exact-SBF matrix against that ELF and the correct C8 artifact. Re-run client/source-derived vectors with the final Core ID. R2 and the new economic client accept an injected Core ID, but existing tests/fixtures still contain cGf assumptions and require deliberate re-pinning. A previous green count is not evidence for changed hashes.
6. Integration must update the single canonical plan, first-launch public recovery manifest and any active Work Market producer/locator references to the selected Core identity. Separate registration of the first-launch Economy from future legacy reconciliation. The final public lifecycle/server-off readback must attest the deployed ANV/C8 artifacts, not just matching local source names.

## Evidence and honest verdict

- `20260905012509616-report.json`, SHA-256 `4f7564b95054cb8740d174609a16a7cd94cfb473f455ba1e009f72b313c933e9`: public 6sJn/cGf account state, history and sampled transaction responses from the three endpoints.
- `20260905012726559-held-g2.json`, SHA-256 `61c9b6685ed13eaa9d2d869b9f2dcc972c7d0241ce1b6e7f923a2bf26a2aab30`: independent ANV public reads, including endpoint, genesis, commitment and slot.
- Native `core-public-mapping.json`: source/document mappings and file hashes. These observations are separate from Sol's custody report.

Verified: current public states, sampled invocation versus address-reference distinction, existing v1/G2 public mappings, and source hash/PDA consequences. Recommended: ANV as the fresh G2 source identity. Not certified here: complete lifetime history, private custody, exact deployed ELF parity, new SBF build, mainnet launch or authority revocation. No chain write or candidate/source mutation was executed by Astra for this review.
