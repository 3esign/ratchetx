# G2 build and verification handoff

B1 checks the built pair; it does not certify SVM behavior, live Pyth data, devnet transactions or release permission.

## Verify the shared Windows pair from Windows or Linux

From the repository root:

```sh
node tools/check-g2-artifacts.mjs --cache-root _to_delete/public-build-handoff
```

The explicit local directory must contain both exact files in this layout:

- 534e3fd33c3350a2ce086f0f2d46dfb85db07813f76c6da569e750f624a1f3c1/rcx_timepin_v2.so (375944 bytes)
- a8f3fb4daefaeea13c951c967e23b92ed14d8cc904402aad7d38e5b8c446094d/ratchet_core_g2.so (1014408 bytes)

These public binaries are available in the shared filesystem; they are intentionally excluded from Git. A fresh checkout must obtain the reviewed binary pair through that handoff or a build artifact download. Never obtain or copy keypair files for B1 verification.

The checker preserves native paths in the original receipt and reports resolved local paths separately. It records the current verificationHost. Historical missing buildHost remains null/unrecorded; future build receipts record it. An artifact-only PASS can accompany receiptStatus FAIL from later SVM execution. runtimeChecked remains false. Both byte hashes, IDs, flags, source/lock snapshot and strict content-addressed paths remain required.

## Reproduce a Linux candidate in two clean containers

The new g2-reproduce workflow runs on the dedicated codex/g2-reproducibility branch. It builds a tooling-only image from the digest-pinned official Rust base and checksum-pinned builder, platform-tools and Node distributions. The Docker build context is only ops/g2-build. The lock file records primary sources and exact versions.

To run on a Docker host, create a new output directory through the runner:

```sh
docker build --platform linux/amd64 --iidfile /tmp/g2-image.id ops/g2-build
node tools/g2-reproduce.mjs --image "$(cat /tmp/g2-image.id)" --output /tmp/g2-reproduction-new
```

The runner resolves an immutable image ID, makes two separate source snapshots, and starts two distinct containers with the same /build path. Each starts without a program target cache. Only stamped program/harness inputs and the build tools enter the snapshots. Raw output and generated throwaway keypairs stay in private container /tmp; only public .so files and execution evidence are exported.

MATCH requires both actual program SHA256/size tuples, measured platform compiler hashes and source snapshots to agree. Same-size different bytes fail. Each run retains its own build-only receipt and logs. The combined receipt records the exact image ID, container IDs, commands and recipe hashes. The image ID identifies this execution; distribution of that custom image for outside reproduction is a separate release task.

This workflow does not change the committed Windows-pinned Timepin vectors or the existing g2-build acceptance workflow. A matching Linux pair is a candidate. It still needs reviewed vector generation, exact-artifact SVM acceptance and devnet evidence before release. Comparison tests use synthetic bytes and do not stand in for actual Docker execution.
