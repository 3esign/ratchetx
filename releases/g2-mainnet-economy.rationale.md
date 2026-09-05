# g2-mainnet-economy Rationale

- **entry_mode**: 2 (ForwardOnly). Evidence: docs/ROAD_TO_MAINNET.md:234 (Semir's proposed value: forward only).
- **hitPayoutNumerator / hitPayoutDenominator**: 17 / 10. Evidence: docs/ROAD_TO_MAINNET.md:235 (Semir's proposed value: 1.7x).
- **revealWindowSeconds**: 3600. Evidence: docs/ROAD_TO_MAINNET.md:235 (Semir's proposed value: >= 3600 s).
- **cleanupBondLamports**: 50000. Evidence: docs/ROAD_TO_MAINNET.md:235 (Semir's proposed value: >= 50,000).
- **maxOpen**: 5. Evidence: docs/ROAD_TO_MAINNET.md:236 (Semir's proposed value: 5).
- **maxPostTargetLagSeconds**: 30 (SOL/BTC), 120 (ETH/BONK/PUMP/JUP/WIF). Evidence: docs/reviews/fable-2026-09-05/g2-mainnet-economy.proposal.json:80-86 (measured from 25 min samples; 24h run started).
- **bandNumerator**: 0. Evidence: docs/ROAD_TO_MAINNET.md:236 (Semir's proposed value: 0).
- **legacyRoot**: 0000000000000000000000000000000000000000000000000000000000000000. Evidence: docs/ROAD_TO_MAINNET.md:236 (Semir's proposed value: all-zero).
- **migrationId**: ratchetx-g2-mainnet-2026-09-fresh-start. Evidence: docs/ROAD_TO_MAINNET.md:236 (Semir's proposed value: nonzero migration_id).
- **timepinProgram**: C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp. Evidence: docs/ROAD_TO_MAINNET.md:237 (Semir's proposed value: C8ww).
