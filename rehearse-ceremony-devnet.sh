#!/usr/bin/env bash
# ===================================================================
#  ZERO-AUTHORITY CEREMONY - DEVNET DRESS REHEARSAL (WSL / Linux / macOS)
#
#  The same rehearsal as REHEARSE_CEREMONY_DEVNET.cmd, for the shell the
#  tooling actually runs in. solana-verify does not compile on Windows at
#  all -- its main.rs imports signal_hook::iterator, which the crate gates
#  behind cfg(not(windows)) -- and Solana's own installer targets
#  "Windows (WSL), Linux and Mac". So on Windows this is the script that
#  runs, inside WSL, against the same repo on the same disk.
#
#  Two things this enforces rather than merely documents:
#    1. It refuses to run anywhere but devnet. The check is the cluster
#       GENESIS HASH, not the RPC url, so a mislabelled endpoint cannot
#       smuggle the revoke onto mainnet.
#    2. It will NOT revoke unless verification has already succeeded.
#       That order is irreversible on mainnet: the verified-build PDA can
#       only be written by the upgrade authority, so revoking first loses
#       self-service verification forever. An unverified immutable program
#       is the worst of both worlds.
# ===================================================================
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")" || exit 1

REPORT=devnet_ceremony.txt
PF=devnet_ceremony_preflight.txt
RPC=https://api.devnet.solana.com
PROGRAM=CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx
REPO=https://github.com/3esign/ratchetx
LIBNAME=ratchet_core
MOUNTPATH=onchain/ratchet-core-devnet

say(){ printf '%s\n' "$*"; }
stop(){ printf '\n%s\n' "$*"; exit 1; }

# The wallet is usually already on the Windows side of a WSL box; there is no
# reason to make a second one, and a second one would not be the authority.
PAYER="${RATCHET_CEREMONY_KEYPAIR:-}"
if [ -z "$PAYER" ]; then
  if [ -f "$HOME/.config/solana/id.json" ]; then
    PAYER="$HOME/.config/solana/id.json"
  else
    mapfile -t found < <(ls -1 /mnt/c/Users/*/.config/solana/id.json 2>/dev/null)
    if [ "${#found[@]}" -eq 1 ]; then PAYER="${found[0]}"
    elif [ "${#found[@]}" -gt 1 ]; then
      stop "Found more than one Windows keypair. Pick one explicitly:
  RATCHET_CEREMONY_KEYPAIR=/mnt/c/Users/<you>/.config/solana/id.json $0"
    fi
  fi
fi
[ -n "$PAYER" ] && [ -f "$PAYER" ] || stop "No Solana keypair found. Set RATCHET_CEREMONY_KEYPAIR to its path, or run: solana-keygen new"

# ---- tools, each with the reason it is required -----------------------------
command -v node >/dev/null 2>&1 || stop "node not found. The preflight that decides devnet-or-not is a node script."
command -v solana >/dev/null 2>&1 || stop "Solana CLI not found. Install it:
  sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""
command -v solana-verify >/dev/null 2>&1 || stop "STOPPED before revoking: solana-verify is not installed.
  cargo install solana-verify --locked
Rehearsing the revoke without the verify would teach the wrong order."
command -v docker >/dev/null 2>&1 || stop "STOPPED before revoking: docker not found. verify-from-repo rebuilds the
program in a pinned image here and compares the hash to the deployed one.
  Install Docker Desktop, then enable Settings > Resources > WSL Integration."
# A docker on PATH is not a docker that works: in WSL the CLI is present long
# before the daemon is reachable, and that failure would otherwise surface
# halfway through the verify.
docker info >/dev/null 2>&1 || stop "STOPPED before revoking: docker is installed but its daemon is not reachable.
Start Docker Desktop, and enable Settings > Resources > WSL Integration for
this distro, then re-run."

{ say "RatchetX - zero-authority ceremony, DEVNET rehearsal"; date; say ""; } > "$REPORT"
say "Keypair: $PAYER" | tee -a "$REPORT"

say ""
say "[1/6] Preflight - cluster, program, and whether the authority is still live..."
solana config set --url "$RPC" >> "$REPORT" 2>&1
node onchain/ratchet-core-devnet/ceremony-preflight.mjs --rpc "$RPC" --program "$PROGRAM" --keypair "$PAYER" > "$PF" 2>&1
cat "$PF"; cat "$PF" >> "$REPORT"

grep -q "RXVERDICT NOTDEVNET"   "$PF" && stop "STOPPED: that cluster is not devnet. Nothing was changed."
grep -q "RXVERDICT NOTDEPLOYED" "$PF" && stop "STOPPED: program not deployed on devnet. Deploy it first."
grep -q "RXVERDICT IMMUTABLE"   "$PF" && stop "STOPPED: this program's authority is already revoked - nothing left to rehearse.
Deploy a fresh throwaway devnet program to rehearse again."
grep -q "RXVERDICT SHORT"       "$PF" && stop "STOPPED: payer is short. Run:  solana airdrop 2"
grep -q "RXVERDICT READY"       "$PF" || stop "STOPPED: could not read the RPC. Nothing was decided; just re-run."

say ""
say "[2/6] Authority BEFORE the ceremony:"
solana program show "$PROGRAM" | tee -a "$REPORT"

say ""
say "[3/6] VERIFY - this must succeed BEFORE anything is revoked."
UPLOADER="$(solana address)" || stop "Could not read the configured wallet address."
say "Uploader (upgrade authority): $UPLOADER" | tee -a "$REPORT"
say "--- verify-from-repo ---" >> "$REPORT"
solana-verify verify-from-repo --program-id "$PROGRAM" "$REPO" \
  --library-name "$LIBNAME" --mount-path "$MOUNTPATH" >> "$REPORT" 2>&1 \
  || stop "STOPPED: verification did not register - so NOTHING was revoked.
That is the correct outcome. Fix verification first, then re-run. See $REPORT."
say "Build data written to the PDA. Submitting the remote job..."
say "--- remote submit-job ---" >> "$REPORT"
solana-verify remote submit-job --program-id "$PROGRAM" --uploader "$UPLOADER" >> "$REPORT" 2>&1 \
  || stop "STOPPED: the remote job was not accepted - so NOTHING was revoked.
See $REPORT."
say "Verification registered." | tee -a "$REPORT"

say ""
say "[4/6] REVOKE - irreversible for this devnet program."
say "    After this, these rules can never be changed again - not even by you."
say "    This is the rehearsal of the one mainnet step that has no undo."
printf 'Type  REVOKE  to continue (anything else aborts): '
read -r GO
[ "$GO" = "REVOKE" ] || stop "Aborted before revoking. Nothing was changed."
say "--- set-upgrade-authority --final ---" >> "$REPORT"
solana program set-upgrade-authority "$PROGRAM" --final >> "$REPORT" 2>&1 \
  || stop "Revoke command failed. See $REPORT."

say ""
say "[5/6] Confirming on chain that the authority is gone..."
node onchain/ratchet-core-devnet/ceremony-preflight.mjs --rpc "$RPC" --program "$PROGRAM" > "$PF" 2>&1
cat "$PF"; cat "$PF" >> "$REPORT"
grep -q "RXVERDICT IMMUTABLE" "$PF" \
  || stop "WARNING: the authority still reads as present after revoking. Inspect $REPORT."
say "CONFIRMED: upgrade authority is NONE. The program is immutable." | tee -a "$REPORT"

say ""
say "[6/6] Proving a stranger can still use an immutable program"
say "    (a fresh keypair that has never touched our infrastructure)"
if [ -f onchain/ratchet-core-devnet/full-life.mjs ]; then
  node onchain/ratchet-core-devnet/full-life.mjs --rpc "$RPC" --program "$PROGRAM" 2>&1 | tee -a "$REPORT"
else
  say "full-life.mjs not found - run the stranger proof yourself and append it to $REPORT."
fi

say ""
say "---------------------------------------------"
say "Rehearsal complete. Report: $REPORT"
say "You have now done the irreversible step once, where it was free."
say "---------------------------------------------"
