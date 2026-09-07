#!/bin/bash
source ~/.cargo/env
export PATH=$PATH:/home/treed/.local/share/solana/install/active_release/bin
export PATH=$PATH:/home/treed/.cargo/bin
cd /mnt/d/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/onchain/ratchet-core
cargo build-sbf --manifest-path programs/ratchet-core/Cargo.toml
