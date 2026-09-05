//! Exact-SBF lifecycle tests for Ratchet Core G2.
//!
//! Instructions and accounts are encoded manually. The harness deliberately
//! does not import the Core crate or an Anchor client, so public ABI drift is
//! visible at the transaction boundary. The full lifecycle crosses the loaded
//! Timepin v2 SBF producer before Core authenticates its resulting accounts.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use litesvm::LiteSVM;
use serde_json::Value;
use sha2::{Digest, Sha256};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_token_2022_interface::{
    extension::{
        memo_transfer::{memo_required, MemoTransfer},
        BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType, StateWithExtensions,
        StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState, Mint},
};
use std::{ffi::OsStr, path::PathBuf, str::FromStr};

const SCHEMA: u16 = 2;
const NOW: i64 = 1_800_000_000;

// THE SPEC THIS HARNESS REGISTERS, IN ONE PLACE. Added 2026-09-05 by the lead.
// Every number below used to be an unnamed literal repeated across the file, and
// that is why the same broken game was written down in four places and survived
// long enough to stop the whole suite at test one. SPEC_LAG was 120 against a
// grid of 60: one print settles two consecutive targets, which rcx-timepin-v2
// refuses outright at lib.rs:603 (BadPostTargetLag, 6009). The rule is
// lag < grid; grid - 1 is the largest lag that satisfies it, so it is DERIVED
// here rather than typed, and it cannot drift from the grid again.
const SPEC_ADAPTER: u8 = 1; // strict bracket - the pre-gap below is load-bearing
const SPEC_GRID: u32 = 60;
const SPEC_LEAD: u32 = 30;
const SPEC_AHEAD: u32 = 3_600;
const SPEC_PRE_GAP: u32 = 120;
const SPEC_LAG: u32 = SPEC_GRID - 1;
const SPEC_GRACE: u32 = 60;
const REVEAL_WINDOW: u32 = 120;
// Timepin sets these when it opens a Need: source_deadline = target + lag, and
// capture_deadline = source_deadline + grace. Derived, so the fixtures below and
// the clocks the tests set move together with the lag.
const SOURCE_DEADLINE_OFFSET: i64 = SPEC_LAG as i64;
const CAPTURE_DEADLINE_OFFSET: i64 = SOURCE_DEADLINE_OFFSET + SPEC_GRACE as i64;
// The exact length of a TimepinNeedV2 account as rcx-timepin-v2 writes it today.
// One name, so the branch-B change is one line here instead of five.
const NEED_LEN: usize = 168;
const RCX_UNIT: u64 = 1_000_000;
const RCX_SUPPLY: u64 = 936_699_884_132_132;
const LEGACY_CREDITS: u64 = 100;
const LEGACY_XP: u64 = 7;
const FEED: [u8; 32] = [3; 32];
const SNAPSHOT_HASH: [u8; 32] = [77; 32];
const CLUSTER_GENESIS_HASH: [u8; 32] = [5; 32];
const MIGRATION_ID: [u8; 32] = [4; 32];
const ECONOMY_LEN: usize = 415;
const RULESET_LEN: usize = 206;
const LEDGER_LEN: usize = 285;
const SHOT_LEN: usize = 780;
// 118, not 87, and never + 1. After M3 a HistoryPage is allocated once at
// HistoryPage::LEN + 8 = 110 + 8 and is never resized: it carries a
// pending_count, a terminal_mask and a rolling results_root instead of the rows,
// and the rows live in the emitted ShotArchived events. The four assertions that
// added 1 (and SHOT_RESULT_LEN on top) were describing the account that used to
// grow. RELOAD_HISTORY_BASE_LEN below is a DIFFERENT account that M3 did not
// touch and correctly stays 87.
const HISTORY_BASE_LEN: usize = 118;
const SHOT_RESULT_LEN: usize = 165;
const WORK_BASE_LEN: usize = 87;
const WORK_RECORD_LEN: usize = 106;
const DAY_FINAL_LEN: usize = 299;
const RELOAD_HISTORY_BASE_LEN: usize = 87;
const RELOAD_RECORD_LEN: usize = 51;
const RECEIVER_PROGRAMDATA_LEN: usize = 416 * 1_024;
const WORMHOLE_PROGRAMDATA_LEN: usize = 656 * 1_024;
const RECEIVER_GENERATION_SLOT: u64 = 900;
const WORMHOLE_GENERATION_SLOT: u64 = 901;
const CORE_WRONG_EXPECTED_HASH: u32 = 6000;
const CORE_WRONG_TIMEPIN_PROGRAM: u32 = 6002;
const CORE_TIMEPIN_PROGRAM_NOT_EXECUTABLE: u32 = 6003;
const CORE_BAD_TIMEPIN_DEADLINE: u32 = 6036;
const CORE_WRONG_SHOT: u32 = 6050;
const CORE_WRONG_NEED: u32 = 6059;
const CORE_WRONG_STATE: u32 = 6063;
const TIMEPIN_WRONG_OWNER: u32 = 6001;
const TIMEPIN_WRONG_CANDIDATE_PDA: u32 = 6010;
const TIMEPIN_NEED_NOT_OPEN: u32 = 6014;
const TIMEPIN_NEED_NOT_FINAL: u32 = 6015;
const TIMEPIN_NEED_NOT_VOID_TERMINAL: u32 = 6016;

const ECONOMY_HASH_DOMAIN: &[u8] = b"rcx-core:economy:g2\0";
const RULESET_HASH_DOMAIN: &[u8] = b"rcx-core:ruleset:g2\0";
const RULESET_POLICY_LEAF_DOMAIN: &[u8] = b"rcx-core:ruleset-policy:g2\0";
const COMMITMENT_DOMAIN: &[u8] = b"rcx-core:commitment:g2\0";
const LEGACY_LEAF_DOMAIN: &[u8] = b"rcx-core:legacy-leaf:g2\0";
const RANK_SHARD_FOR_DOMAIN: &[u8] = b"rcx-core:rank-shard-for:g2\0";
const GAME_RESULT_HASH_DOMAIN: &[u8] = b"rcx-core:game-result:g2\0";
const DAY_FINAL_HASH_DOMAIN: &[u8] = b"rcx-core:day-final:g2\0";
const RELOAD_MEMO_DOMAIN: &[u8] = b"rcx-core:reload-route:g2\0";
const TIMEPIN_POLICY_DOMAIN: &[u8] = b"rcx-timepin:evidence-policy:v2\0";
const TIMEPIN_SPEC_DOMAIN: &[u8] = b"rcx-timepin:evidence-spec:v2-generation\0";
const TIMEPIN_MESSAGE_DOMAIN: &[u8] = b"rcx-timepin:pyth-price-message:v2\0";
const TIMEPIN_SET_DOMAIN: &[u8] = b"rcx-timepin:evidence-set:v2\0";
const TIMEPIN_EXPIRED_DOMAIN: &[u8] = b"rcx-timepin:expired:v2\0";

fn core_program() -> Pubkey {
    Pubkey::from_str("cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN").unwrap()
}

fn timepin_program() -> Pubkey {
    Pubkey::from_str("C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp").unwrap()
}

fn historical_timepin_program() -> Pubkey {
    Pubkey::from_str("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx").unwrap()
}

fn receiver_program() -> Pubkey {
    Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap()
}

fn push_program() -> Pubkey {
    Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap()
}

fn wormhole_program() -> Pubkey {
    Pubkey::from_str("YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf").unwrap()
}

fn rcx_mint() -> Pubkey {
    Pubkey::from_str("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump").unwrap()
}

fn token_2022() -> Pubkey {
    Pubkey::from_str("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb").unwrap()
}

fn memo_program() -> Pubkey {
    Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap()
}

fn wrong_memo_program() -> Pubkey {
    Pubkey::from_str("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo").unwrap()
}

fn associated_token_program() -> Pubkey {
    Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap()
}

fn system_program() -> Pubkey {
    Pubkey::from_str("11111111111111111111111111111111").unwrap()
}

fn loader_v3() -> Pubkey {
    Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap()
}

fn read_hash_pinned_sbf(
    env_name: &str,
    exact_filename: &str,
    required_program: &Pubkey,
    forbidden_program: Option<&Pubkey>,
) -> Vec<u8> {
    let configured = std::env::var_os(env_name)
        .unwrap_or_else(|| panic!("{env_name} must name a hash-pinned SBF artifact"));
    let configured_path = PathBuf::from(configured);
    let canonical_path = std::fs::canonicalize(&configured_path)
        .unwrap_or_else(|error| panic!("canonicalize {env_name}: {error}"));

    for path in [&configured_path, &canonical_path] {
        assert!(
            !path.components().any(|component| component
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("target")),
            "{env_name} may not use a mutable target path: {}",
            path.display()
        );
    }
    assert_eq!(
        canonical_path.file_name(),
        Some(OsStr::new(exact_filename)),
        "{env_name} must resolve to {exact_filename}"
    );

    let parent = canonical_path
        .parent()
        .unwrap_or_else(|| panic!("{env_name} artifact has no hash directory"));
    let grandparent = parent
        .parent()
        .unwrap_or_else(|| panic!("{env_name} artifact has no cache directory"));
    assert_eq!(
        grandparent.file_name(),
        Some(OsStr::new("ratchetx-onchain-sbf")),
        "{env_name} must resolve below the ratchetx-onchain-sbf cache"
    );

    let sbf = std::fs::read(&canonical_path)
        .unwrap_or_else(|error| panic!("read hash-pinned {env_name} SBF: {error}"));
    assert!(
        sbf.starts_with(b"\x7fELF"),
        "{env_name} artifact is not ELF"
    );
    assert!(
        sbf.len() >= 52,
        "{env_name} artifact must have a complete ELF64 header"
    );
    assert_eq!(sbf[4], 2, "{env_name} artifact must be ELF64");
    assert_eq!(sbf[5], 1, "{env_name} artifact must be little-endian");
    assert_eq!(
        u32::from_le_bytes(sbf[48..52].try_into().unwrap()),
        3,
        "{env_name} artifact must have SBPFv3 ELF e_flags"
    );
    let sha256 = lowercase_hex(&hash_parts(&[sbf.as_slice()]));
    assert_eq!(
        parent.file_name().and_then(OsStr::to_str),
        Some(sha256.as_str()),
        "{env_name} parent directory must equal its lowercase SHA-256"
    );

    let required_bytes = required_program.to_bytes();
    let required_occurrences = sbf
        .windows(required_bytes.len())
        .filter(|window| *window == required_bytes.as_slice())
        .count();
    assert!(
        required_occurrences >= 1,
        "{env_name} does not embed required program id {required_program}"
    );
    if let Some(forbidden_program) = forbidden_program {
        let forbidden_bytes = forbidden_program.to_bytes();
        let forbidden_occurrences = sbf
            .windows(forbidden_bytes.len())
            .filter(|window| *window == forbidden_bytes.as_slice())
            .count();
        assert_eq!(
            forbidden_occurrences, 0,
            "{env_name} embeds forbidden program id {forbidden_program}"
        );
    }

    sbf
}

fn discriminator(kind: &str, name: &str) -> [u8; 8] {
    Sha256::digest(format!("{kind}:{name}").as_bytes())[..8]
        .try_into()
        .unwrap()
}

fn hash_parts(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap())
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn read_i64(data: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn read_hash(data: &[u8], offset: usize) -> [u8; 32] {
    data[offset..offset + 32].try_into().unwrap()
}

fn schema_seed() -> [u8; 2] {
    SCHEMA.to_le_bytes()
}

fn economy_pda(hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"economy", &schema_seed(), hash], &core_program()).0
}

fn ruleset_pda(hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"ruleset", &schema_seed(), hash], &core_program()).0
}

fn ledger_pda(economy_hash: &[u8; 32], player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"ledger", economy_hash, player.as_ref()], &core_program()).0
}

fn delegate_grant_pda(
    economy_hash: &[u8; 32],
    ruleset_hash: &[u8; 32],
    player: &Pubkey,
    delegate: &Pubkey,
    grant_id: &[u8; 16],
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"delegate_grant",
            &schema_seed(),
            economy_hash,
            ruleset_hash,
            player.as_ref(),
            delegate.as_ref(),
            grant_id,
        ],
        &core_program(),
    )
    .0
}

fn day_final_pda(economy_hash: &[u8; 32], day: i64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"day_final", economy_hash, &day.to_le_bytes()],
        &core_program(),
    )
}

fn reload_history_page_pda(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"reload_history_page",
            economy_hash,
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &core_program(),
    )
}

fn canonical_rcx_ata(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_2022().as_ref(), rcx_mint().as_ref()],
        &associated_token_program(),
    )
    .0
}

fn shot_pda(economy_hash: &[u8; 32], player: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"shot", economy_hash, player.as_ref(), &nonce.to_le_bytes()],
        &core_program(),
    )
    .0
}

fn history_page_pda(economy_hash: &[u8; 32], player: &Pubkey, page_index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"history_page",
            economy_hash,
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &core_program(),
    )
    .0
}

fn work_page_pda(economy_hash: &[u8; 32], player: &Pubkey, page_index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"work_page",
            economy_hash,
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &core_program(),
    )
    .0
}

fn player_day_pda(economy_hash: &[u8; 32], day: i64, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"player_day",
            economy_hash,
            &day.to_le_bytes(),
            player.as_ref(),
        ],
        &core_program(),
    )
    .0
}

fn rank_shard_for(player: &Pubkey) -> u8 {
    hash_parts(&[RANK_SHARD_FOR_DOMAIN, player.as_ref()])[0] % 16
}

fn rank_shard_pda(economy_hash: &[u8; 32], day: i64, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"rank_shard",
            economy_hash,
            &day.to_le_bytes(),
            &[rank_shard_for(player)],
        ],
        &core_program(),
    )
    .0
}

fn spec_pda(spec_hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[b"evidence_spec", &SCHEMA.to_le_bytes(), spec_hash],
        &timepin_program(),
    )
    .0
}

fn need_pda(spec_hash: &[u8; 32], target: i64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"need",
            &SCHEMA.to_le_bytes(),
            spec_hash,
            &target.to_le_bytes(),
        ],
        &timepin_program(),
    )
}

fn candidate_pda(need: &Pubkey, message_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"candidate", need.as_ref(), message_hash],
        &timepin_program(),
    )
}

fn programdata_pda(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &loader_v3()).0
}

fn receiver_config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &receiver_program()).0
}

fn price_source_pda() -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), &FEED], &push_program()).0
}

fn timepin_work_page_pda(need: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"work_page", need.as_ref()], &timepin_program()).0
}

fn receiver_config_data() -> Vec<u8> {
    let mut data = discriminator("account", "Config").to_vec();
    data.extend_from_slice(Pubkey::new_from_array([11; 32]).as_ref());
    data.push(0);
    data.extend_from_slice(wormhole_program().as_ref());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    data.push(1);
    data.resize(370, 0);
    assert_eq!(data.len(), 370);
    data
}

fn score_day(exit_target: i64) -> i64 {
    // capture_deadline = target + lag + grace, then the economy's reveal window.
    // Derived rather than frozen: the day a shot scores in moves with the lag.
    (exit_target + CAPTURE_DEADLINE_OFFSET + REVEAL_WINDOW as i64).div_euclid(86_400)
}

fn utc_day(timestamp: i64) -> i64 {
    timestamp.div_euclid(86_400)
}

fn rcx_mint_fixture() -> (Value, Vec<u8>) {
    let json: Value =
        serde_json::from_str(include_str!("../fixtures/rcx-mainnet-mint-2026-09-04.json")).unwrap();
    let data = BASE64.decode(json["dataBase64"].as_str().unwrap()).unwrap();
    (json, data)
}

fn day_final_hash(
    economy_hash: &[u8; 32],
    day: i64,
    accepted: u64,
    terminal: u64,
    top: &[(Pubkey, u64); 3],
    shards_hash: &[u8; 32],
) -> [u8; 32] {
    let mut canonical = Vec::with_capacity(2 + 32 + 8 + 8 + 8 + 3 * 40 + 32);
    canonical.extend_from_slice(&SCHEMA.to_le_bytes());
    canonical.extend_from_slice(economy_hash);
    canonical.extend_from_slice(&day.to_le_bytes());
    canonical.extend_from_slice(&accepted.to_le_bytes());
    canonical.extend_from_slice(&terminal.to_le_bytes());
    for (wallet, xp) in top {
        canonical.extend_from_slice(wallet.as_ref());
        canonical.extend_from_slice(&xp.to_le_bytes());
    }
    canonical.extend_from_slice(shards_hash);
    hash_parts(&[DAY_FINAL_HASH_DOMAIN, &canonical])
}

#[allow(clippy::too_many_arguments)]
fn reload_route_memo(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    day: i64,
    day_final_hash: &[u8; 32],
    seat_index: u8,
    destination: &Pubkey,
    amount: u64,
) -> [u8; 32] {
    hash_parts(&[
        RELOAD_MEMO_DOMAIN,
        core_program().as_ref(),
        economy_hash,
        player.as_ref(),
        &nonce.to_le_bytes(),
        &day.to_le_bytes(),
        day_final_hash,
        &[seat_index],
        destination.as_ref(),
        &amount.to_le_bytes(),
    ])
}

fn lowercase_hex(digest: &[u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn commitment(
    economy_hash: &[u8; 32],
    ruleset_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    side: u8,
    p_bps: u16,
    salt: &[u8; 32],
) -> [u8; 32] {
    hash_parts(&[
        COMMITMENT_DOMAIN,
        core_program().as_ref(),
        economy_hash,
        ruleset_hash,
        player.as_ref(),
        &nonce.to_le_bytes(),
        &[side],
        &p_bps.to_le_bytes(),
        salt,
    ])
}

fn legacy_leaf(player: &Pubkey, cutover_slot: u64) -> [u8; 32] {
    hash_parts(&[
        LEGACY_LEAF_DOMAIN,
        core_program().as_ref(),
        &SCHEMA.to_le_bytes(),
        &CLUSTER_GENESIS_HASH,
        &MIGRATION_ID,
        &SNAPSHOT_HASH,
        &cutover_slot.to_le_bytes(),
        player.as_ref(),
        &LEGACY_CREDITS.to_le_bytes(),
        &LEGACY_XP.to_le_bytes(),
    ])
}

fn encode_vec32(values: &[[u8; 32]]) -> Vec<u8> {
    let mut out = (values.len() as u32).to_le_bytes().to_vec();
    for value in values {
        out.extend_from_slice(value);
    }
    out
}

fn evidence_policy_canonical() -> Vec<u8> {
    let mut out = Vec::with_capacity(134);
    out.extend_from_slice(&SCHEMA.to_le_bytes());
    out.push(SPEC_ADAPTER);
    out.extend_from_slice(receiver_program().as_ref());
    out.extend_from_slice(push_program().as_ref());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&FEED);
    out.push(1);
    out.extend_from_slice(&SPEC_GRID.to_le_bytes());
    out.extend_from_slice(&SPEC_LEAD.to_le_bytes());
    out.extend_from_slice(&SPEC_AHEAD.to_le_bytes());
    out.extend_from_slice(&SPEC_PRE_GAP.to_le_bytes());
    out.extend_from_slice(&SPEC_LAG.to_le_bytes());
    out.extend_from_slice(&SPEC_GRACE.to_le_bytes());
    out.extend_from_slice(&5u16.to_le_bytes());
    out.extend_from_slice(&(-12i8).to_le_bytes());
    out.extend_from_slice(&2i8.to_le_bytes());
    out.extend_from_slice(&1_000u32.to_le_bytes());
    assert_eq!(out.len(), 134);
    out
}

#[derive(Clone, Debug)]
struct RulesArgs {
    economy_hash: [u8; 32],
    spec_hash: [u8; 32],
    policy_hash: [u8; 32],
    entry_mode: u8,
    max_entry_age_seconds: u32,
}

impl RulesArgs {
    fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(163);
        out.extend_from_slice(&SCHEMA.to_le_bytes());
        out.extend_from_slice(&self.economy_hash);
        out.extend_from_slice(&self.spec_hash);
        out.extend_from_slice(&self.policy_hash);
        out.extend_from_slice(&FEED);
        out.push(self.entry_mode);
        out.extend_from_slice(&300u32.to_le_bytes());
        out.extend_from_slice(&60u32.to_le_bytes());
        out.extend_from_slice(&30u32.to_le_bytes());
        out.extend_from_slice(&self.max_entry_age_seconds.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&10u64.to_le_bytes());
        assert_eq!(out.len(), 163);
        out
    }

    fn hash(&self) -> [u8; 32] {
        hash_parts(&[RULESET_HASH_DOMAIN, &self.encode()])
    }

    fn policy_leaf(&self) -> [u8; 32] {
        let bytes = self.encode();
        hash_parts(&[RULESET_POLICY_LEAF_DOMAIN, &bytes[..2], &bytes[66..]])
    }
}

struct Kernel {
    economy_hash: [u8; 32],
    economy: Pubkey,
    economy_args: Vec<u8>,
    spec_hash: [u8; 32],
    spec: Pubkey,
    rules: RulesArgs,
    ruleset_hash: [u8; 32],
    ruleset: Pubkey,
}

struct World {
    svm: LiteSVM,
}

impl World {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let core_sbf = read_hash_pinned_sbf(
            "RATCHET_CORE_G2_SO",
            "ratchet_core_g2.so",
            &core_program(),
            None,
        );
        svm.add_program(core_program(), &core_sbf)
            .expect("load exact Core G2 SBF");
        let timepin_sbf = read_hash_pinned_sbf(
            "RCX_TIMEPIN_V2_SO",
            "rcx_timepin_v2.so",
            &timepin_program(),
            Some(&historical_timepin_program()),
        );
        for program in [timepin_program(), receiver_program(), wormhole_program()] {
            svm.add_program(program, &timepin_sbf)
                .expect("install Loader-v3 program fixture");
        }
        // Receiver/Push use their official ids. Wormhole is the synthetic id
        // selected by the synthetic Config; Receiver and Wormhole still use
        // distinct canonical Loader-v3 links. Both ProgramData byte arrays are
        // synthetic real-scale fixtures seeded with the pinned Timepin ELF.
        Self::resize_programdata(
            &mut svm,
            receiver_program(),
            RECEIVER_PROGRAMDATA_LEN,
            RECEIVER_GENERATION_SLOT,
            &timepin_sbf,
        );
        Self::resize_programdata(
            &mut svm,
            wormhole_program(),
            WORMHOLE_PROGRAMDATA_LEN,
            WORMHOLE_GENERATION_SLOT,
            &timepin_sbf,
        );
        svm.set_account(
            receiver_config_pda(),
            Account {
                lamports: 10_000_000,
                data: receiver_config_data(),
                owner: receiver_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        for program in [token_2022(), memo_program(), wrong_memo_program()] {
            let account = svm
                .get_account(&program)
                .expect("LiteSVM bundled processor account");
            assert!(account.executable, "{program} must be executable");
        }
        let mut world = Self { svm };
        world.set_clock(NOW);
        world
    }

    fn resize_programdata(
        svm: &mut LiteSVM,
        program: Pubkey,
        exact_len: usize,
        slot: u64,
        sbf: &[u8],
    ) {
        let program_account = svm.get_account(&program).expect("Program account");
        let programdata = programdata_pda(&program);
        assert!(program_account.executable);
        assert_eq!(program_account.owner, loader_v3());
        assert_eq!(&program_account.data[..4], &2u32.to_le_bytes());
        assert_eq!(&program_account.data[4..36], programdata.as_ref());

        let mut account = svm.get_account(&programdata).expect("ProgramData account");
        assert_eq!(account.owner, loader_v3());
        assert!(!account.executable);
        assert_eq!(&account.data[..4], &3u32.to_le_bytes());
        assert_eq!(account.data[12], 0);
        assert_eq!(&account.data[45..45 + sbf.len()], sbf);
        assert!(exact_len >= account.data.len());
        account.data[4..12].copy_from_slice(&slot.to_le_bytes());
        account.data.resize(exact_len, 0xA5);
        account.lamports = 20_000_000_000;
        svm.set_account(programdata, account).unwrap();
    }

    fn set_clock(&mut self, unix_timestamp: i64) {
        self.svm.set_sysvar(&Clock {
            slot: (unix_timestamp as u64) * 2,
            epoch_start_timestamp: NOW - 1_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp,
        });
    }

    fn wallet(&mut self) -> Keypair {
        let wallet = Keypair::new();
        self.svm.airdrop(&wallet.pubkey(), 20_000_000_000).unwrap();
        wallet
    }

    fn set_account(&mut self, key: Pubkey, owner: Pubkey, lamports: u64, data: Vec<u8>) {
        self.svm
            .set_account(
                key,
                Account {
                    lamports,
                    data,
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn put_empty_system_account(&mut self, key: Pubkey, lamports: u64) {
        self.set_account(key, system_program(), lamports, vec![]);
    }

    fn put_timepin_account(&mut self, key: Pubkey, data: Vec<u8>) {
        self.set_account(key, timepin_program(), 10_000_000, data);
    }

    fn snapshot_accounts(&self, keys: &[Pubkey]) -> Vec<(Pubkey, Option<Account>)> {
        keys.iter()
            .map(|key| (*key, self.svm.get_account(key)))
            .collect()
    }

    fn assert_accounts_unchanged(&self, before: &[(Pubkey, Option<Account>)], context: &str) {
        for (key, expected) in before {
            let actual = self.svm.get_account(key);
            assert_eq!(
                actual.is_some(),
                expected.is_some(),
                "{context}: account existence changed for {key}"
            );
            if let (Some(actual), Some(expected)) = (actual, expected) {
                assert_eq!(
                    actual.owner, expected.owner,
                    "{context}: owner changed for {key}"
                );
                assert_eq!(
                    actual.lamports, expected.lamports,
                    "{context}: lamports changed for {key}"
                );
                assert_eq!(
                    actual.executable, expected.executable,
                    "{context}: executable flag changed for {key}"
                );
                assert_eq!(
                    actual.rent_epoch, expected.rent_epoch,
                    "{context}: rent epoch changed for {key}"
                );
                assert_eq!(
                    actual.data, expected.data,
                    "{context}: data changed for {key}"
                );
            }
        }
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.send_with_logs(ix, signers).map(|_| ())
    }

    fn send_with_logs(
        &mut self,
        ix: Instruction,
        signers: &[&Keypair],
    ) -> Result<Vec<String>, String> {
        let payer = signers[0];
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|metadata| metadata.logs)
            .map_err(|error| format!("{}\n{:?}", error.meta.logs.join("\n"), error.err))
    }

    fn instruction(&self, name: &str, args: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
        let mut data = discriminator("global", name).to_vec();
        data.extend_from_slice(&args);
        Instruction {
            program_id: core_program(),
            accounts,
            data,
        }
    }

    fn timepin_instruction(
        &self,
        name: &str,
        args: Vec<u8>,
        accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut data = discriminator("global", name).to_vec();
        data.extend_from_slice(&args);
        Instruction {
            program_id: timepin_program(),
            accounts,
            data,
        }
    }

    fn register_timepin_spec(&mut self, actor: &Keypair) -> ([u8; 32], [u8; 32], Pubkey) {
        let policy = evidence_policy_canonical();
        let policy_hash = hash_parts(&[TIMEPIN_POLICY_DOMAIN, &policy]);
        let config = receiver_config_data();
        let receiver_config_hash = hash_parts(&[&config]);
        let mut canonical = Vec::with_capacity(214);
        canonical.extend_from_slice(&policy);
        canonical.extend_from_slice(&RECEIVER_GENERATION_SLOT.to_le_bytes());
        canonical.extend_from_slice(&receiver_config_hash);
        canonical.extend_from_slice(wormhole_program().as_ref());
        canonical.extend_from_slice(&WORMHOLE_GENERATION_SLOT.to_le_bytes());
        assert_eq!(canonical.len(), 214);
        let hash = hash_parts(&[TIMEPIN_SPEC_DOMAIN, &canonical]);
        let key = spec_pda(&hash);
        let registered_slot = self.svm.get_sysvar::<Clock>().slot;
        let mut args = hash.to_vec();
        args.extend_from_slice(&canonical);
        assert_eq!(args.len(), 246);
        self.send(
            self.timepin_instruction(
                "register_evidence_spec",
                args,
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new(key, false),
                    AccountMeta::new_readonly(receiver_program(), false),
                    AccountMeta::new_readonly(programdata_pda(&receiver_program()), false),
                    AccountMeta::new_readonly(receiver_config_pda(), false),
                    AccountMeta::new_readonly(wormhole_program(), false),
                    AccountMeta::new_readonly(programdata_pda(&wormhole_program()), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
        .unwrap();
        let stored = self.svm.get_account(&key).expect("Timepin-produced spec");
        assert_eq!(stored.owner, timepin_program());
        assert_eq!(stored.data.len(), 262);
        assert_eq!(
            &stored.data[..8],
            &discriminator("account", "EvidenceSpecV2")
        );
        assert_eq!(&stored.data[8..142], &policy);
        assert_eq!(read_hash(&stored.data, 142), policy_hash);
        assert_eq!(read_u64(&stored.data, 174), RECEIVER_GENERATION_SLOT);
        assert_eq!(read_hash(&stored.data, 182), receiver_config_hash);
        assert_eq!(&stored.data[214..246], wormhole_program().as_ref());
        assert_eq!(read_u64(&stored.data, 246), WORMHOLE_GENERATION_SLOT);
        assert_eq!(read_u64(&stored.data, 254), registered_slot);
        (hash, policy_hash, key)
    }

    fn bootstrap(&mut self, registrar: &Keypair, legacy_player: &Pubkey) -> Kernel {
        self.bootstrap_for_mode(registrar, legacy_player, 2, 0)
    }

    fn bootstrap_observed(&mut self, registrar: &Keypair, legacy_player: &Pubkey) -> Kernel {
        self.bootstrap_for_mode(registrar, legacy_player, 1, 300)
    }

    fn bootstrap_for_mode(
        &mut self,
        registrar: &Keypair,
        legacy_player: &Pubkey,
        entry_mode: u8,
        max_entry_age_seconds: u32,
    ) -> Kernel {
        let (spec_hash, policy_hash, spec) = self.register_timepin_spec(registrar);
        let policy_template = RulesArgs {
            economy_hash: [0; 32],
            spec_hash,
            policy_hash,
            entry_mode,
            max_entry_age_seconds,
        };
        let policy_root = policy_template.policy_leaf();
        let cutover_slot = self.svm.get_sysvar::<Clock>().slot - 1;
        let legacy_root = legacy_leaf(legacy_player, cutover_slot);

        let mut economy_args = Vec::with_capacity(372);
        economy_args.extend_from_slice(&SCHEMA.to_le_bytes());
        economy_args.extend_from_slice(timepin_program().as_ref());
        economy_args.extend_from_slice(&SCHEMA.to_le_bytes());
        economy_args.extend_from_slice(&CLUSTER_GENESIS_HASH);
        economy_args.extend_from_slice(&MIGRATION_ID);
        economy_args.extend_from_slice(&legacy_root);
        economy_args.extend_from_slice(&SNAPSHOT_HASH);
        economy_args.extend_from_slice(&cutover_slot.to_le_bytes());
        economy_args.extend_from_slice(&1u32.to_le_bytes());
        economy_args.extend_from_slice(&LEGACY_CREDITS.to_le_bytes());
        economy_args.extend_from_slice(&LEGACY_XP.to_le_bytes());
        economy_args.extend_from_slice(&policy_root);
        economy_args.extend_from_slice(&1u16.to_le_bytes());
        economy_args.extend_from_slice(rcx_mint().as_ref());
        economy_args.extend_from_slice(token_2022().as_ref());
        economy_args.push(6);
        economy_args.extend_from_slice(&1_000_000u64.to_le_bytes());
        economy_args.extend_from_slice(&700u16.to_le_bytes());
        economy_args.extend_from_slice(&300u16.to_le_bytes());
        for share in [500u16, 300, 200] {
            economy_args.extend_from_slice(&share.to_le_bytes());
        }
        economy_args.push(16);
        economy_args.extend_from_slice(&86_400u32.to_le_bytes());
        economy_args.extend_from_slice(&2u64.to_le_bytes());
        economy_args.extend_from_slice(&1u64.to_le_bytes());
        economy_args.extend_from_slice(&3u64.to_le_bytes());
        economy_args.extend_from_slice(&1u64.to_le_bytes());
        economy_args.extend_from_slice(&1_000u64.to_le_bytes());
        economy_args.extend_from_slice(&8u16.to_le_bytes());
        economy_args.extend_from_slice(&5_000u64.to_le_bytes());
        economy_args.extend_from_slice(&REVEAL_WINDOW.to_le_bytes());
        economy_args.extend_from_slice(&3_600u32.to_le_bytes());
        assert_eq!(economy_args.len(), 372);

        let economy_hash = hash_parts(&[ECONOMY_HASH_DOMAIN, &economy_args]);
        let economy = economy_pda(&economy_hash);
        self.register_economy(registrar, economy_hash, economy, &economy_args)
            .unwrap();

        let rules = RulesArgs {
            economy_hash,
            spec_hash,
            policy_hash,
            entry_mode,
            max_entry_age_seconds,
        };
        let ruleset_hash = rules.hash();
        let ruleset = ruleset_pda(&ruleset_hash);
        self.register_ruleset(registrar, economy, spec, ruleset_hash, ruleset, &rules)
            .unwrap();

        Kernel {
            economy_hash,
            economy,
            economy_args,
            spec_hash,
            spec,
            rules,
            ruleset_hash,
            ruleset,
        }
    }

    fn register_economy(
        &mut self,
        actor: &Keypair,
        economy_hash: [u8; 32],
        economy: Pubkey,
        economy_args: &[u8],
    ) -> Result<(), String> {
        self.register_economy_with_program(
            actor,
            economy_hash,
            economy,
            economy_args,
            timepin_program(),
        )
    }

    fn register_economy_with_program(
        &mut self,
        actor: &Keypair,
        economy_hash: [u8; 32],
        economy: Pubkey,
        economy_args: &[u8],
        supplied_timepin_program: Pubkey,
    ) -> Result<(), String> {
        let mut args = economy_hash.to_vec();
        args.extend_from_slice(economy_args);
        self.send(
            self.instruction(
                "register_economy",
                args,
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new(economy, false),
                    AccountMeta::new_readonly(supplied_timepin_program, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn register_ruleset(
        &mut self,
        actor: &Keypair,
        economy: Pubkey,
        spec: Pubkey,
        expected_hash: [u8; 32],
        ruleset: Pubkey,
        args: &RulesArgs,
    ) -> Result<(), String> {
        let mut encoded = expected_hash.to_vec();
        encoded.extend_from_slice(&args.encode());
        encoded.extend_from_slice(&encode_vec32(&[]));
        self.send(
            self.instruction(
                "register_ruleset",
                encoded,
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(economy, false),
                    AccountMeta::new(ruleset, false),
                    AccountMeta::new_readonly(spec, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn open_ledger(&mut self, player: &Keypair, kernel: &Kernel) -> Result<(), String> {
        self.send(
            self.instruction(
                "open_ledger",
                vec![],
                vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player.pubkey()), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }

    fn open_history_page(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        page_index: u64,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "open_history_page",
                page_index.to_le_bytes().to_vec(),
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(*player, false),
                    AccountMeta::new_readonly(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, page_index),
                        false,
                    ),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn open_work_page(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        page_index: u64,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "open_work_page",
                page_index.to_le_bytes().to_vec(),
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(*player, false),
                    AccountMeta::new_readonly(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, page_index),
                        false,
                    ),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn open_reload_page(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        page_index: u64,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "open_reload_page",
                page_index.to_le_bytes().to_vec(),
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(*player, false),
                    AccountMeta::new_readonly(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(
                        reload_history_page_pda(&kernel.economy_hash, player, page_index).0,
                        false,
                    ),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn claim_legacy(&mut self, player: &Keypair, kernel: &Kernel) -> Result<(), String> {
        let mut args = LEGACY_CREDITS.to_le_bytes().to_vec();
        args.extend_from_slice(&LEGACY_XP.to_le_bytes());
        args.extend_from_slice(&encode_vec32(&[]));
        self.send(
            self.instruction(
                "claim_legacy",
                args,
                vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player.pubkey()), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }

    fn grant_delegate(
        &mut self,
        player: &Keypair,
        delegate: &Pubkey,
        kernel: &Kernel,
        grant_id: [u8; 16],
    ) -> Result<Pubkey, String> {
        let grant = delegate_grant_pda(
            &kernel.economy_hash,
            &kernel.ruleset_hash,
            &player.pubkey(),
            delegate,
            &grant_id,
        );
        let mut args = grant_id.to_vec();
        args.extend_from_slice(&10u64.to_le_bytes());
        args.extend_from_slice(&20u64.to_le_bytes());
        args.extend_from_slice(&2u16.to_le_bytes());
        args.extend_from_slice(&1u32.to_le_bytes());
        args.extend_from_slice(&(NOW + 3_600).to_le_bytes());
        self.send(
            self.instruction(
                "grant_delegate",
                args,
                vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new_readonly(*delegate, false),
                    AccountMeta::new(grant, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )?;
        Ok(grant)
    }

    fn revoke_delegate(
        &mut self,
        player: &Keypair,
        kernel: &Kernel,
        grant: Pubkey,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "revoke_delegate",
                vec![],
                vec![
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(grant, false),
                    AccountMeta::new_readonly(player.pubkey(), true),
                ],
            ),
            &[player],
        )
    }

    fn need_data(
        &self,
        spec_hash: [u8; 32],
        target: i64,
        state: u8,
        candidate_a: [u8; 32],
    ) -> Vec<u8> {
        let (_, bump) = need_pda(&spec_hash, target);
        let mut data = discriminator("account", "TimepinNeedV2").to_vec();
        data.extend_from_slice(&SCHEMA.to_le_bytes());
        data.push(bump);
        data.push(state);
        data.extend_from_slice(&spec_hash);
        data.extend_from_slice(&target.to_le_bytes());
        data.extend_from_slice(&(target + SOURCE_DEADLINE_OFFSET).to_le_bytes());
        data.extend_from_slice(&(target + CAPTURE_DEADLINE_OFFSET).to_le_bytes());
        data.extend_from_slice(&candidate_a);
        data.extend_from_slice(&[0; 32]);
        // open_refs and rent_payer. Timepin writes both, Core's view reads both,
        // and a fabricated Need that stops at candidate_b_hash is 132 bytes
        // against a decoder that demands 168 - which is the whole of I1 in
        // miniature. Zeroes are correct here: this harness never exercises
        // close_need, and rent_payer is only ever compared, never dereferenced.
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&[0; 32]);
        assert_eq!(data.len(), NEED_LEN);
        data
    }

    fn put_open_need(&mut self, spec_hash: [u8; 32], target: i64) -> Pubkey {
        let need = need_pda(&spec_hash, target).0;
        self.put_timepin_account(need, self.need_data(spec_hash, target, 0, [0; 32]));
        need
    }
}

#[derive(Clone, Copy, Debug)]
struct FinalEvidence {
    need: Pubkey,
    candidate: Pubkey,
    target: i64,
    message_hash: [u8; 32],
    result_hash: [u8; 32],
}

impl World {
    fn price_message_hash(
        price: i64,
        conf: u64,
        exponent: i32,
        publish: i64,
        prev: i64,
    ) -> [u8; 32] {
        hash_parts(&[
            TIMEPIN_MESSAGE_DOMAIN,
            &FEED,
            &price.to_le_bytes(),
            &conf.to_le_bytes(),
            &exponent.to_le_bytes(),
            &publish.to_le_bytes(),
            &prev.to_le_bytes(),
            &price.to_le_bytes(),
            &conf.to_le_bytes(),
        ])
    }

    fn open_timepin_need(
        &mut self,
        actor: &Keypair,
        spec_hash: [u8; 32],
        target: i64,
    ) -> Result<Pubkey, String> {
        let need = need_pda(&spec_hash, target).0;
        let mut args = spec_hash.to_vec();
        args.extend_from_slice(&target.to_le_bytes());
        self.send(
            self.timepin_instruction(
                "open_need",
                args,
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(spec_pda(&spec_hash), false),
                    AccountMeta::new(need, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )?;
        let stored = self.svm.get_account(&need).expect("Timepin-produced Need");
        assert_eq!(stored.owner, timepin_program());
        assert_eq!(stored.data.len(), NEED_LEN);
        assert_eq!(
            &stored.data[..8],
            &discriminator("account", "TimepinNeedV2")
        );
        assert_eq!(stored.data[11], 0);
        assert_eq!(read_hash(&stored.data, 12), spec_hash);
        assert_eq!(read_i64(&stored.data, 44), target);
        assert_eq!(read_i64(&stored.data, 52), target + SOURCE_DEADLINE_OFFSET);
        assert_eq!(read_i64(&stored.data, 60), target + CAPTURE_DEADLINE_OFFSET);
        Ok(need)
    }

    fn expire_timepin_need(
        &mut self,
        actor: &Keypair,
        spec_hash: [u8; 32],
        target: i64,
    ) -> Result<[u8; 32], String> {
        let need = need_pda(&spec_hash, target).0;
        self.set_clock(target + CAPTURE_DEADLINE_OFFSET);
        self.send(
            self.timepin_instruction(
                "expire",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(spec_pda(&spec_hash), false),
                    AccountMeta::new(need, false),
                    AccountMeta::new(timepin_work_page_pda(&need), false),
                ],
            ),
            &[actor],
        )?;
        let expired = self.svm.get_account(&need).expect("expired Timepin Need");
        assert_eq!(expired.owner, timepin_program());
        assert_eq!(expired.data.len(), NEED_LEN);
        assert_eq!(expired.data[11], 4);
        assert_eq!(read_hash(&expired.data, 68), [0; 32]);
        assert_eq!(read_hash(&expired.data, 100), [0; 32]);
        Ok(hash_parts(&[
            TIMEPIN_EXPIRED_DOMAIN,
            need.as_ref(),
            &target.to_le_bytes(),
        ]))
    }

    fn put_price_update(&mut self, target: i64, price: i64) -> [u8; 32] {
        let conf = 1u64;
        let exponent = -6i32;
        let publish = target;
        let prev = target - 60;
        let posted_slot = self.svm.get_sysvar::<Clock>().slot;
        let source = price_source_pda();
        let mut data = discriminator("account", "PriceUpdateV2").to_vec();
        data.extend_from_slice(source.as_ref());
        data.push(1);
        data.extend_from_slice(&FEED);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&exponent.to_le_bytes());
        data.extend_from_slice(&publish.to_le_bytes());
        data.extend_from_slice(&prev.to_le_bytes());
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&posted_slot.to_le_bytes());
        data.resize(134, 0);
        self.set_account(source, receiver_program(), 10_000_000, data);
        Self::price_message_hash(price, conf, exponent, publish, prev)
    }

    fn capture_and_finalize_timepin(
        &mut self,
        actor: &Keypair,
        spec_hash: [u8; 32],
        target: i64,
        price: i64,
    ) -> Result<FinalEvidence, String> {
        self.set_clock(target);
        let message_hash = self.put_price_update(target, price);
        let need = need_pda(&spec_hash, target).0;
        let candidate = candidate_pda(&need, &message_hash).0;
        let timepin_work_page = timepin_work_page_pda(&need);
        self.send(
            self.timepin_instruction(
                "capture_first",
                message_hash.to_vec(),
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(spec_pda(&spec_hash), false),
                    AccountMeta::new(need, false),
                    AccountMeta::new(candidate, false),
                    AccountMeta::new_readonly(receiver_program(), false),
                    AccountMeta::new_readonly(programdata_pda(&receiver_program()), false),
                    AccountMeta::new_readonly(receiver_config_pda(), false),
                    AccountMeta::new_readonly(wormhole_program(), false),
                    AccountMeta::new_readonly(programdata_pda(&wormhole_program()), false),
                    AccountMeta::new_readonly(price_source_pda(), false),
                    AccountMeta::new(timepin_work_page, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )?;
        let captured_need = self.svm.get_account(&need).expect("captured Need");
        let captured_candidate = self
            .svm
            .get_account(&candidate)
            .expect("captured Candidate");
        assert_eq!(captured_need.owner, timepin_program());
        assert_eq!(captured_need.data.len(), NEED_LEN);
        assert_eq!(captured_need.data[11], 1);
        assert_eq!(read_hash(&captured_need.data, 68), message_hash);
        assert_eq!(captured_candidate.owner, timepin_program());
        assert_eq!(captured_candidate.data.len(), 119);
        assert_eq!(
            &captured_candidate.data[..8],
            &discriminator("account", "CandidateV2")
        );
        assert_eq!(&captured_candidate.data[11..43], need.as_ref());
        assert_eq!(read_i64(&captured_candidate.data, 43), price);
        assert_eq!(read_i64(&captured_candidate.data, 63), target);
        assert_eq!(read_i64(&captured_candidate.data, 111), target);

        self.set_clock(target + CAPTURE_DEADLINE_OFFSET);
        self.send(
            self.timepin_instruction(
                "finalize",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(spec_pda(&spec_hash), false),
                    AccountMeta::new(need, false),
                    AccountMeta::new_readonly(candidate, false),
                    AccountMeta::new(timepin_work_page, false),
                ],
            ),
            &[actor],
        )?;
        let final_need = self.svm.get_account(&need).expect("final Timepin Need");
        assert_eq!(final_need.data[11], 2);
        assert_eq!(read_hash(&final_need.data, 68), message_hash);
        assert_eq!(read_hash(&final_need.data, 100), [0; 32]);
        let result_hash = hash_parts(&[TIMEPIN_SET_DOMAIN, need.as_ref(), &message_hash]);
        Ok(FinalEvidence {
            need,
            candidate,
            target,
            message_hash,
            result_hash,
        })
    }

    fn put_final(&mut self, spec_hash: [u8; 32], target: i64, price: i64) -> FinalEvidence {
        let conf = 1u64;
        let exponent = -6i32;
        let publish = target;
        let prev = target - 60;
        let message_hash = Self::price_message_hash(price, conf, exponent, publish, prev);
        let need = need_pda(&spec_hash, target).0;
        self.put_timepin_account(need, self.need_data(spec_hash, target, 2, message_hash));

        let (candidate, candidate_bump) = candidate_pda(&need, &message_hash);
        let capture_slot = self.svm.get_sysvar::<Clock>().slot;
        let posted_slot = capture_slot.saturating_sub(1);
        let mut candidate_data = discriminator("account", "CandidateV2").to_vec();
        candidate_data.extend_from_slice(&SCHEMA.to_le_bytes());
        candidate_data.push(candidate_bump);
        candidate_data.extend_from_slice(need.as_ref());
        candidate_data.extend_from_slice(&price.to_le_bytes());
        candidate_data.extend_from_slice(&conf.to_le_bytes());
        candidate_data.extend_from_slice(&exponent.to_le_bytes());
        candidate_data.extend_from_slice(&publish.to_le_bytes());
        candidate_data.extend_from_slice(&prev.to_le_bytes());
        candidate_data.extend_from_slice(&price.to_le_bytes());
        candidate_data.extend_from_slice(&conf.to_le_bytes());
        candidate_data.extend_from_slice(&posted_slot.to_le_bytes());
        candidate_data.extend_from_slice(&capture_slot.to_le_bytes());
        candidate_data.extend_from_slice(&target.to_le_bytes());
        assert_eq!(candidate_data.len(), 119);
        self.put_timepin_account(candidate, candidate_data);

        let result_hash = hash_parts(&[TIMEPIN_SET_DOMAIN, need.as_ref(), &message_hash]);

        FinalEvidence {
            need,
            candidate,
            target,
            message_hash,
            result_hash,
        }
    }

    fn seal_forward(
        &mut self,
        player: &Keypair,
        kernel: &Kernel,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target: i64,
    ) -> Result<(), String> {
        let player_key = player.pubkey();
        let exit_target = entry_target + 300;
        let day = score_day(exit_target);
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commit);
        args.extend_from_slice(&stake.to_le_bytes());
        args.extend_from_slice(&entry_target.to_le_bytes());
        args.extend_from_slice(&day.to_le_bytes());
        self.send(
            self.instruction(
                "seal_forward",
                args,
                vec![
                    AccountMeta::new(player_key, true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player_key), false),
                    AccountMeta::new(
                        player_day_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        rank_shard_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, &player_key, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(shot_pda(&kernel.economy_hash, &player_key, nonce), false),
                    AccountMeta::new_readonly(need_pda(&kernel.spec_hash, entry_target).0, false),
                    AccountMeta::new_readonly(need_pda(&kernel.spec_hash, exit_target).0, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }

    fn seal_forward_delegated(
        &mut self,
        delegate: &Keypair,
        player: &Pubkey,
        grant: Pubkey,
        kernel: &Kernel,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target: i64,
    ) -> Result<(), String> {
        let exit_target = entry_target + 300;
        let day = score_day(exit_target);
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commit);
        args.extend_from_slice(&stake.to_le_bytes());
        args.extend_from_slice(&entry_target.to_le_bytes());
        args.extend_from_slice(&day.to_le_bytes());
        self.send(
            self.instruction(
                "seal_forward_delegated",
                args,
                vec![
                    AccountMeta::new(delegate.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(grant, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(player_day_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(rank_shard_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(shot_pda(&kernel.economy_hash, player, nonce), false),
                    AccountMeta::new_readonly(need_pda(&kernel.spec_hash, entry_target).0, false),
                    AccountMeta::new_readonly(need_pda(&kernel.spec_hash, exit_target).0, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[delegate],
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn seal_observed(
        &mut self,
        player: &Keypair,
        kernel: &Kernel,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry: FinalEvidence,
        exit_target: i64,
    ) -> Result<(), String> {
        let player_key = player.pubkey();
        let day = score_day(exit_target);
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commit);
        args.extend_from_slice(&stake.to_le_bytes());
        args.extend_from_slice(&entry.target.to_le_bytes());
        args.extend_from_slice(&exit_target.to_le_bytes());
        args.extend_from_slice(&day.to_le_bytes());
        self.send(
            self.instruction(
                "seal_observed",
                args,
                vec![
                    AccountMeta::new(player_key, true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player_key), false),
                    AccountMeta::new(
                        player_day_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        rank_shard_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, &player_key, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(shot_pda(&kernel.economy_hash, &player_key, nonce), false),
                    AccountMeta::new_readonly(kernel.spec, false),
                    AccountMeta::new_readonly(entry.need, false),
                    AccountMeta::new_readonly(entry.candidate, false),
                    AccountMeta::new_readonly(need_pda(&kernel.spec_hash, exit_target).0, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }

    fn reserve_work(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
        work_kind: u8,
        expected_index: u8,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "reserve_work",
                vec![work_kind, expected_index],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new_readonly(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new_readonly(shot_pda(&kernel.economy_hash, player, nonce), false),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn activate(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
        entry: FinalEvidence,
    ) -> Result<(), String> {
        self.activate_with_work_page(
            actor,
            player,
            kernel,
            nonce,
            entry,
            work_page_pda(&kernel.economy_hash, player, nonce / 16),
        )
    }

    fn activate_with_work_page(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
        entry: FinalEvidence,
        work_page: Pubkey,
    ) -> Result<(), String> {
        self.send(
            self.instruction(
                "activate_entry",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new_readonly(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(shot_pda(&kernel.economy_hash, player, nonce), false),
                    AccountMeta::new(work_page, false),
                    AccountMeta::new_readonly(kernel.spec, false),
                    AccountMeta::new_readonly(entry.need, false),
                    AccountMeta::new_readonly(entry.candidate, false),
                ],
            ),
            &[actor],
        )
    }
}

impl World {
    fn settle(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
        exit: FinalEvidence,
    ) -> Result<(), String> {
        self.settle_against_kernel(actor, player, kernel, kernel, nonce, exit)
    }

    fn settle_against_kernel(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        account_kernel: &Kernel,
        shot_kernel: &Kernel,
        nonce: u64,
        exit: FinalEvidence,
    ) -> Result<(), String> {
        let day = score_day(exit.target);
        self.send(
            self.instruction(
                "settle_final",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(account_kernel.economy, false),
                    AccountMeta::new_readonly(account_kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&account_kernel.economy_hash, player), false),
                    AccountMeta::new(shot_pda(&shot_kernel.economy_hash, player, nonce), false),
                    AccountMeta::new(
                        work_page_pda(&shot_kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        player_day_pda(&shot_kernel.economy_hash, day, player),
                        false,
                    ),
                    AccountMeta::new(
                        rank_shard_pda(&shot_kernel.economy_hash, day, player),
                        false,
                    ),
                    AccountMeta::new_readonly(account_kernel.spec, false),
                    AccountMeta::new_readonly(exit.need, false),
                    AccountMeta::new_readonly(exit.candidate, false),
                ],
            ),
            &[actor],
        )
    }

    fn reveal(
        &mut self,
        player: &Keypair,
        kernel: &Kernel,
        nonce: u64,
        side: u8,
        p_bps: u16,
        salt: [u8; 32],
    ) -> Result<(), String> {
        let player_key = player.pubkey();
        let shot = shot_pda(&kernel.economy_hash, &player_key, nonce);
        let live = self
            .svm
            .get_account(&shot)
            .expect("live shot before reveal");
        let day = score_day(read_i64(&live.data, 254));
        let mut args = vec![side];
        args.extend_from_slice(&p_bps.to_le_bytes());
        args.extend_from_slice(&salt);
        self.send(
            self.instruction(
                "reveal",
                args,
                vec![
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player_key), false),
                    AccountMeta::new(shot, false),
                    AccountMeta::new(
                        player_day_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        rank_shard_pda(&kernel.economy_hash, day, &player_key),
                        false,
                    ),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, &player_key, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, &player_key, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(player_key, true),
                    AccountMeta::new(player_key, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }

    fn reveal_delegated(
        &mut self,
        delegate: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
        side: u8,
        p_bps: u16,
        salt: [u8; 32],
    ) -> Result<(), String> {
        let shot = shot_pda(&kernel.economy_hash, player, nonce);
        let live = self
            .svm
            .get_account(&shot)
            .expect("live delegated shot before reveal");
        let day = score_day(read_i64(&live.data, 254));
        let mut args = vec![side];
        args.extend_from_slice(&p_bps.to_le_bytes());
        args.extend_from_slice(&salt);
        self.send(
            self.instruction(
                "reveal_delegated",
                args,
                vec![
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(shot, false),
                    AccountMeta::new(player_day_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(rank_shard_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(delegate.pubkey(), true),
                    AccountMeta::new(delegate.pubkey(), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[delegate],
        )
    }

    fn void_pending_entry(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
    ) -> Result<(), String> {
        let shot = shot_pda(&kernel.economy_hash, player, nonce);
        let live = self
            .svm
            .get_account(&shot)
            .expect("live PendingEntry shot before void");
        let day = score_day(read_i64(&live.data, 254));
        let rent_refund = Pubkey::new_from_array(live.data[107..139].try_into().unwrap());
        let entry_need = Pubkey::new_from_array(live.data[271..303].try_into().unwrap());
        self.send(
            self.instruction(
                "void_pending_entry",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(shot, false),
                    AccountMeta::new(player_day_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(rank_shard_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(rent_refund, false),
                    AccountMeta::new_readonly(entry_need, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn void_active_shot(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
    ) -> Result<(), String> {
        let shot = shot_pda(&kernel.economy_hash, player, nonce);
        let live = self
            .svm
            .get_account(&shot)
            .expect("live Active shot before void");
        let day = score_day(read_i64(&live.data, 254));
        let rent_refund = Pubkey::new_from_array(live.data[107..139].try_into().unwrap());
        let exit_need = Pubkey::new_from_array(live.data[303..335].try_into().unwrap());
        self.send(
            self.instruction(
                "void_active_shot",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(shot, false),
                    AccountMeta::new(player_day_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(rank_shard_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(rent_refund, false),
                    AccountMeta::new_readonly(exit_need, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }

    fn finalize_resolved_void(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        kernel: &Kernel,
        nonce: u64,
    ) -> Result<(), String> {
        let shot = shot_pda(&kernel.economy_hash, player, nonce);
        let live = self
            .svm
            .get_account(&shot)
            .expect("live AwaitVoid shot before finalization");
        let day = score_day(read_i64(&live.data, 254));
        self.send(
            self.instruction(
                "finalize_resolved_void",
                vec![],
                vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new_readonly(kernel.ruleset, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, player), false),
                    AccountMeta::new(shot, false),
                    AccountMeta::new(player_day_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(rank_shard_pda(&kernel.economy_hash, day, player), false),
                    AccountMeta::new(
                        history_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(
                        work_page_pda(&kernel.economy_hash, player, nonce / 16),
                        false,
                    ),
                    AccountMeta::new(*player, false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[actor],
        )
    }
}

impl World {
    fn install_rcx_mainnet_mint(&mut self) {
        let (json, data) = rcx_mint_fixture();
        assert_eq!(json["contextSlot"].as_u64(), Some(444_123_919));
        assert_eq!(
            json["address"].as_str(),
            Some("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump")
        );
        assert_eq!(
            json["owner"].as_str(),
            Some("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
        );
        assert_eq!(data.len(), 409);
        let mint = StateWithExtensions::<Mint>::unpack(&data).unwrap();
        assert_eq!(mint.base.supply, RCX_SUPPLY);
        assert_eq!(mint.base.decimals, 6);
        assert!(mint.base.mint_authority.is_none());
        assert!(mint.base.freeze_authority.is_none());
        assert_eq!(
            mint.get_extension_types().unwrap(),
            vec![ExtensionType::MetadataPointer, ExtensionType::TokenMetadata]
        );
        self.set_account(
            rcx_mint(),
            token_2022(),
            json["lamports"].as_u64().unwrap(),
            data,
        );
    }

    fn put_memo_token_account(&mut self, address: Pubkey, owner: Pubkey, amount: u64) {
        let account_len = ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::MemoTransfer,
        ])
        .unwrap();
        let mut data = vec![0u8; account_len];
        {
            let mut state =
                StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
            let extension = state.init_extension::<MemoTransfer>(true).unwrap();
            extension.require_incoming_transfer_memos = true.into();
            state.base.mint = rcx_mint();
            state.base.owner = owner;
            state.base.amount = amount;
            state.base.delegate = None.into();
            state.base.state = AccountState::Initialized;
            state.base.is_native = None.into();
            state.base.delegated_amount = 0;
            state.base.close_authority = None.into();
            state.pack_base();
            state.init_account_type().unwrap();
        }
        let parsed = StateWithExtensions::<TokenAccount>::unpack(&data).unwrap();
        assert!(memo_required(&parsed));
        assert_eq!(
            parsed.get_extension_types().unwrap(),
            vec![ExtensionType::MemoTransfer]
        );
        self.set_account(address, token_2022(), 10_000_000, data);
    }

    fn token_balance(&self, address: Pubkey) -> u64 {
        let account = self.svm.get_account(&address).expect("token account");
        StateWithExtensions::<TokenAccount>::unpack(&account.data)
            .unwrap()
            .base
            .amount
    }

    fn token_requires_memo(&self, address: Pubkey) -> bool {
        let account = self.svm.get_account(&address).expect("token account");
        let state = StateWithExtensions::<TokenAccount>::unpack(&account.data).unwrap();
        memo_required(&state)
    }

    fn mint_supply(&self) -> u64 {
        let account = self.svm.get_account(&rcx_mint()).expect("RCX mint");
        StateWithExtensions::<Mint>::unpack(&account.data)
            .unwrap()
            .base
            .supply
    }

    fn put_day_final(
        &mut self,
        kernel: &Kernel,
        day: i64,
        top: [(Pubkey, u64); 3],
        finalizer: Pubkey,
    ) -> (Pubkey, [u8; 32]) {
        let (key, bump) = day_final_pda(&kernel.economy_hash, day);
        let accepted = top
            .iter()
            .filter(|(wallet, _)| *wallet != Pubkey::default())
            .count() as u64;
        let terminal = accepted;
        let shards_hash = [109; 32];
        let final_hash = day_final_hash(
            &kernel.economy_hash,
            day,
            accepted,
            terminal,
            &top,
            &shards_hash,
        );
        let finalized_slot = self.svm.get_sysvar::<Clock>().slot;
        let finalized_ts = (day + 1) * 86_400;
        let mut data = discriminator("account", "DayFinal").to_vec();
        data.extend_from_slice(&SCHEMA.to_le_bytes());
        data.push(bump);
        data.extend_from_slice(&kernel.economy_hash);
        data.extend_from_slice(&day.to_le_bytes());
        data.extend_from_slice(&accepted.to_le_bytes());
        data.extend_from_slice(&terminal.to_le_bytes());
        for (wallet, xp) in top {
            data.extend_from_slice(wallet.as_ref());
            data.extend_from_slice(&xp.to_le_bytes());
        }
        data.extend_from_slice(&shards_hash);
        data.extend_from_slice(&final_hash);
        data.extend_from_slice(&finalized_slot.to_le_bytes());
        data.extend_from_slice(&finalized_ts.to_le_bytes());
        data.extend_from_slice(finalizer.as_ref());
        assert_eq!(data.len(), DAY_FINAL_LEN);
        self.set_account(key, core_program(), 10_000_000, data);
        (key, final_hash)
    }

    #[allow(clippy::too_many_arguments)]
    fn reload_single_champion(
        &mut self,
        player: &Keypair,
        kernel: &Kernel,
        day_final: Pubkey,
        expected_day_final_hash: [u8; 32],
        nonce: u64,
        gross: u64,
        player_token: Pubkey,
        champion_token: Pubkey,
        memo: Pubkey,
    ) -> Result<Vec<String>, String> {
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&gross.to_le_bytes());
        args.extend_from_slice(&expected_day_final_hash);
        self.send_with_logs(
            self.instruction(
                "reload_rcx",
                args,
                vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new_readonly(kernel.economy, false),
                    AccountMeta::new(ledger_pda(&kernel.economy_hash, &player.pubkey()), false),
                    AccountMeta::new_readonly(day_final, false),
                    AccountMeta::new(
                        reload_history_page_pda(&kernel.economy_hash, &player.pubkey(), nonce / 32)
                            .0,
                        false,
                    ),
                    AccountMeta::new(rcx_mint(), false),
                    AccountMeta::new(player_token, false),
                    AccountMeta::new_readonly(token_2022(), false),
                    AccountMeta::new_readonly(memo, false),
                    AccountMeta::new_readonly(system_program(), false),
                    AccountMeta::new(champion_token, false),
                    AccountMeta::new_readonly(system_program(), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
            ),
            &[player],
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn expected_game_result_hash(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    ruleset_hash: &[u8; 32],
    commit: &[u8; 32],
    stake: u64,
    sealed_ts: i64,
    entry_target: i64,
    exit_target: i64,
    state: u8,
    void_reason: u8,
    side: u8,
    p_bps: u16,
    delegate: &Pubkey,
    entry_timepin_result_hash: &[u8; 32],
    exit_timepin_result_hash: &[u8; 32],
    outcome_yes: u8,
    hit: u8,
    xp_awarded: u64,
    day: i64,
) -> [u8; 32] {
    hash_parts(&[
        GAME_RESULT_HASH_DOMAIN,
        core_program().as_ref(),
        economy_hash,
        player.as_ref(),
        &nonce.to_le_bytes(),
        ruleset_hash,
        commit,
        &stake.to_le_bytes(),
        &sealed_ts.to_le_bytes(),
        &entry_target.to_le_bytes(),
        &exit_target.to_le_bytes(),
        &[state],
        &[void_reason],
        &[side],
        &p_bps.to_le_bytes(),
        delegate.as_ref(),
        entry_timepin_result_hash,
        exit_timepin_result_hash,
        &[outcome_yes],
        &[hit],
        &xp_awarded.to_le_bytes(),
        &day.to_le_bytes(),
    ])
}

fn assert_closed(world: &World, key: Pubkey) {
    if let Some(account) = world.svm.get_account(&key) {
        assert_eq!(account.lamports, 0, "closed account retained lamports");
        assert!(
            account.data.is_empty(),
            "closed account retained live account data"
        );
    }
}

fn work_record_offset(index: usize) -> usize {
    WORK_BASE_LEN + index * WORK_RECORD_LEN
}

fn assert_anchor_custom_error(error: &str, expected_name: &str, expected_code: u32) {
    let expected_tail = format!("InstructionError(0, Custom({expected_code}))");
    assert_eq!(
        error.lines().last(),
        Some(expected_tail.as_str()),
        "wrong transaction error for {expected_name}: {error}"
    );
    let observed_names: Vec<&str> = error
        .lines()
        .filter_map(|line| {
            let (_, suffix) = line.split_once("Error Code: ")?;
            suffix.split('.').next()
        })
        .collect();
    assert_eq!(
        observed_names.last().copied(),
        Some(expected_name),
        "wrong Anchor error name for Custom({expected_code}): {error}"
    );
}

struct ActiveForwardFixture {
    world: World,
    player: Keypair,
    worker: Keypair,
    kernel: Kernel,
    nonce: u64,
    exit_target: i64,
}

fn active_forward_fixture() -> ActiveForwardFixture {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let worker = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let nonce = 0;
    let entry_target = NOW + 60;
    let exit_target = entry_target + 300;
    let salt = [0xA7; 32];
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        1,
        6_000,
        &salt,
    );
    world
        .open_timepin_need(&player, kernel.spec_hash, entry_target)
        .unwrap();
    world
        .open_timepin_need(&player, kernel.spec_hash, exit_target)
        .unwrap();
    world
        .seal_forward(&player, &kernel, nonce, commit, 10, entry_target)
        .unwrap();
    let entry = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, entry_target, 10_000)
        .unwrap();
    world
        .activate(&worker, &player.pubkey(), &kernel, nonce, entry)
        .unwrap();

    let active = world
        .svm
        .get_account(&shot_pda(&kernel.economy_hash, &player.pubkey(), nonce))
        .expect("positive-control Active shot");
    assert_eq!(active.data[212], 2, "fixture must reach Active");
    assert_eq!(read_hash(&active.data, 383), entry.message_hash);

    ActiveForwardFixture {
        world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
    }
}

fn settle_account_keys(
    account_kernel: &Kernel,
    shot_kernel: &Kernel,
    player: &Pubkey,
    nonce: u64,
    exit: FinalEvidence,
) -> Vec<Pubkey> {
    let day = score_day(exit.target);
    vec![
        account_kernel.economy,
        account_kernel.ruleset,
        ledger_pda(&account_kernel.economy_hash, player),
        shot_pda(&shot_kernel.economy_hash, player, nonce),
        work_page_pda(&shot_kernel.economy_hash, player, nonce / 16),
        player_day_pda(&shot_kernel.economy_hash, day, player),
        rank_shard_pda(&shot_kernel.economy_hash, day, player),
        account_kernel.spec,
        exit.need,
        exit.candidate,
    ]
}

fn void_active_account_keys(
    kernel: &Kernel,
    player: &Pubkey,
    nonce: u64,
    exit_target: i64,
) -> Vec<Pubkey> {
    let day = score_day(exit_target);
    vec![
        kernel.economy,
        kernel.ruleset,
        ledger_pda(&kernel.economy_hash, player),
        shot_pda(&kernel.economy_hash, player, nonce),
        player_day_pda(&kernel.economy_hash, day, player),
        rank_shard_pda(&kernel.economy_hash, day, player),
        history_page_pda(&kernel.economy_hash, player, nonce / 16),
        work_page_pda(&kernel.economy_hash, player, nonce / 16),
        *player,
        need_pda(&kernel.spec_hash, exit_target).0,
    ]
}

fn seal_forward_account_keys(
    kernel: &Kernel,
    player: &Pubkey,
    nonce: u64,
    entry_target: i64,
) -> Vec<Pubkey> {
    let exit_target = entry_target + 300;
    let day = score_day(exit_target);
    vec![
        kernel.economy,
        kernel.ruleset,
        ledger_pda(&kernel.economy_hash, player),
        player_day_pda(&kernel.economy_hash, day, player),
        rank_shard_pda(&kernel.economy_hash, day, player),
        history_page_pda(&kernel.economy_hash, player, nonce / 16),
        shot_pda(&kernel.economy_hash, player, nonce),
        need_pda(&kernel.spec_hash, entry_target).0,
        need_pda(&kernel.spec_hash, exit_target).0,
    ]
}

#[test]
fn immutable_generation_registration_ledger_claim_and_history_are_permissionless() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let stranger = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());

    let economy = world.svm.get_account(&kernel.economy).unwrap();
    assert_eq!(economy.owner, core_program());
    assert_eq!(economy.data.len(), ECONOMY_LEN);
    assert_eq!(&economy.data[..8], &discriminator("account", "Economy"));
    assert_eq!(&economy.data[11..43], &kernel.economy_hash);
    assert_eq!(&economy.data[43..], kernel.economy_args.as_slice());
    let ruleset = world.svm.get_account(&kernel.ruleset).unwrap();
    assert_eq!(ruleset.owner, core_program());
    assert_eq!(ruleset.data.len(), RULESET_LEN);
    assert_eq!(&ruleset.data[..8], &discriminator("account", "Ruleset"));
    assert_eq!(&ruleset.data[11..43], &kernel.ruleset_hash);

    let economy_before = economy.data;
    world
        .register_economy(
            &stranger,
            kernel.economy_hash,
            kernel.economy,
            &kernel.economy_args,
        )
        .unwrap();
    assert_eq!(
        world.svm.get_account(&kernel.economy).unwrap().data,
        economy_before
    );
    let ruleset_before = ruleset.data;
    world
        .register_ruleset(
            &stranger,
            kernel.economy,
            kernel.spec,
            kernel.ruleset_hash,
            kernel.ruleset,
            &kernel.rules,
        )
        .unwrap();
    assert_eq!(
        world.svm.get_account(&kernel.ruleset).unwrap().data,
        ruleset_before
    );

    world.open_ledger(&player, &kernel).unwrap();
    world.open_ledger(&player, &kernel).unwrap();
    let ledger_key = ledger_pda(&kernel.economy_hash, &player.pubkey());
    let empty_ledger = world.svm.get_account(&ledger_key).unwrap();
    assert_eq!(empty_ledger.data.len(), LEDGER_LEN);
    assert_eq!(read_u64(&empty_ledger.data, 75), 0);

    world.claim_legacy(&player, &kernel).unwrap();
    let ledger = world.svm.get_account(&ledger_key).unwrap();
    assert_eq!(read_u64(&ledger.data, 75), LEGACY_CREDITS);
    assert_eq!(read_u64(&ledger.data, 91), LEGACY_XP);
    assert_eq!(read_u64(&ledger.data, 99), LEGACY_CREDITS);
    assert_eq!(read_u64(&ledger.data, 147), LEGACY_XP);
    assert_eq!(read_u64(&ledger.data, 237), 0);
    // The permanent ledger's immutable legacy counters are the replay
    // tombstone; no duplicate per-player LegacyClaim account is retained.
    assert!(world.claim_legacy(&player, &kernel).is_err());

    world
        .open_history_page(&stranger, &player.pubkey(), &kernel, 0)
        .unwrap();
    world
        .open_history_page(&stranger, &player.pubkey(), &kernel, 0)
        .unwrap();
    assert!(world
        .open_history_page(&stranger, &player.pubkey(), &kernel, 1)
        .is_err());
    let history_key = history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(history.owner, core_program());
    assert_eq!(history.data.len(), HISTORY_BASE_LEN);
    assert_eq!(&history.data[..8], &discriminator("account", "HistoryPage"));
    assert_eq!(read_u32(&history.data, 83), 0);
}

#[test]
fn full_forward_lifecycle_archives_and_closes_with_sponsor_reserved_work_page() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let worker = world.wallet();
    let sponsor = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let nonce = 0;
    let side = 1;
    let p_bps = 6_000;
    let salt = [91; 32];
    let stake = 10;
    let entry_target = NOW + 60;
    let exit_target = entry_target + 300;
    let day = score_day(exit_target);
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        side,
        p_bps,
        &salt,
    );
    world
        .open_timepin_need(&player, kernel.spec_hash, entry_target)
        .unwrap();
    world
        .open_timepin_need(&player, kernel.spec_hash, exit_target)
        .unwrap();
    world
        .seal_forward(&player, &kernel, nonce, commit, stake, entry_target)
        .unwrap();

    let shot_key = shot_pda(&kernel.economy_hash, &player.pubkey(), nonce);
    let history_key = history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let work_key = work_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let sealed = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(sealed.data.len(), SHOT_LEN);
    assert_eq!(&sealed.data[..8], &discriminator("account", "Shot"));
    assert_eq!(sealed.data[211], 2);
    assert_eq!(sealed.data[212], 1);
    assert_eq!(read_u64(&sealed.data, 214), stake);
    assert_eq!(read_u64(&sealed.data, 222), 5_000);
    assert_eq!(read_i64(&sealed.data, 246), entry_target);
    assert_eq!(read_i64(&sealed.data, 254), exit_target);
    assert_eq!(read_i64(&sealed.data, 262), day);
    let pending_history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(pending_history.data.len(), HISTORY_BASE_LEN);
    assert_eq!(read_u32(&pending_history.data, 83), 1);
    assert_eq!(pending_history.data[87], 0);

    // A dust-funded canonical PDA cannot veto sponsor initialization.
    world.put_empty_system_account(work_key, 17);
    world
        .open_work_page(&sponsor, &player.pubkey(), &kernel, 0)
        .unwrap();
    for (index, kind) in [3u8, 4, 5].into_iter().enumerate() {
        world
            .reserve_work(
                &sponsor,
                &player.pubkey(),
                &kernel,
                nonce,
                kind,
                index as u8,
            )
            .unwrap();
    }
    let reserved = world.svm.get_account(&work_key).unwrap();
    assert_eq!(reserved.owner, core_program());
    assert_eq!(reserved.data.len(), WORK_BASE_LEN + 3 * WORK_RECORD_LEN);
    assert_eq!(read_u32(&reserved.data, 83), 3);
    for (index, kind) in [3u8, 4, 5].into_iter().enumerate() {
        let offset = work_record_offset(index);
        assert_eq!(&reserved.data[offset..offset + 32], shot_key.as_ref());
        assert_eq!(reserved.data[offset + 32], kind);
        assert_eq!(reserved.data[offset + 33], 0);
        assert_eq!(&reserved.data[offset + 34..offset + 66], &[0; 32]);
        assert_eq!(&reserved.data[offset + 66..offset + 98], &[0; 32]);
        assert_eq!(read_u64(&reserved.data, offset + 98), 0);
    }

    let entry = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, entry_target, 10_000)
        .unwrap();
    world
        .activate(&worker, &player.pubkey(), &kernel, nonce, entry)
        .unwrap();
    let active = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(active.data[212], 2);
    assert_eq!(read_hash(&active.data, 383), entry.message_hash);
    assert_eq!(read_hash(&active.data, 415), entry.result_hash);
    let after_activation = world.svm.get_account(&work_key).unwrap();
    let activation_offset = work_record_offset(0);
    assert_eq!(after_activation.data[activation_offset + 33], 1);
    assert_eq!(
        &after_activation.data[activation_offset + 34..activation_offset + 66],
        worker.pubkey().as_ref()
    );
    assert_ne!(
        &after_activation.data[activation_offset + 66..activation_offset + 98],
        &[0; 32]
    );
    assert!(read_u64(&after_activation.data, activation_offset + 98) > 0);

    let exit = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, exit_target, 11_000)
        .unwrap();
    world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .unwrap();
    let awaiting = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(awaiting.data[212], 3);
    assert_eq!(read_hash(&awaiting.data, 475), exit.message_hash);
    assert_eq!(read_hash(&awaiting.data, 507), exit.result_hash);
    assert_eq!(awaiting.data[567], 1);
    assert_eq!(read_i64(&awaiting.data, 584), exit_target + 300);
    assert_eq!(&awaiting.data[604..636], worker.pubkey().as_ref());
    assert_ne!(&awaiting.data[716..748], &[0; 32]);
    assert_eq!(&awaiting.data[748..780], &[0; 32]);
    let after_resolution = world.svm.get_account(&work_key).unwrap();
    let resolution_offset = work_record_offset(1);
    assert_eq!(after_resolution.data[resolution_offset + 33], 1);
    assert_eq!(
        &after_resolution.data[resolution_offset + 34..resolution_offset + 66],
        worker.pubkey().as_ref()
    );
    assert_ne!(
        &after_resolution.data[resolution_offset + 66..resolution_offset + 98],
        &[0; 32]
    );

    let player_before_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    world
        .reveal(&player, &kernel, nonce, side, p_bps, salt)
        .unwrap();
    let player_after_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    assert!(
        player_after_close > player_before_close,
        "Shot rent and cleanup remainder must return to immutable rent_refund"
    );
    assert_closed(&world, shot_key);

    let history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(history.data.len(), HISTORY_BASE_LEN);
    assert_eq!(read_u32(&history.data, 83), 1);
    assert_eq!(history.data[87], 1);
    let result = 88;
    assert_eq!(&history.data[result..result + 32], &kernel.ruleset_hash);
    assert_eq!(&history.data[result + 32..result + 64], &salt);
    assert_eq!(
        (history.data[result + 64], history.data[result + 65]),
        (4, 0)
    );
    assert_eq!(read_u64(&history.data, result + 66), stake);
    assert_eq!(read_i64(&history.data, result + 74), NOW);
    assert_eq!(read_i64(&history.data, result + 82), entry_target);
    assert_eq!(read_i64(&history.data, result + 90), exit_target);
    assert_eq!(history.data[result + 98], side);
    assert_eq!(read_u16(&history.data, result + 99), p_bps);
    assert_eq!(
        &history.data[result + 101..result + 133],
        Pubkey::default().as_ref()
    );
    let expected_game_hash = expected_game_result_hash(
        &kernel.economy_hash,
        &player.pubkey(),
        nonce,
        &kernel.ruleset_hash,
        &commit,
        stake,
        NOW,
        entry_target,
        exit_target,
        4,
        0,
        side,
        p_bps,
        &Pubkey::default(),
        &entry.result_hash,
        &exit.result_hash,
        1,
        1,
        6,
        day,
    );
    assert_eq!(
        read_hash(&history.data, result + 133),
        expected_game_hash,
        "compact row must bind both authenticated Timepin terminal hashes"
    );

    let completed_work = world.svm.get_account(&work_key).unwrap();
    assert_eq!(
        completed_work.data.len(),
        WORK_BASE_LEN + 3 * WORK_RECORD_LEN
    );
    for (index, kind, disposition, expected_worker) in [
        (0usize, 3u8, 1u8, worker.pubkey()),
        (1usize, 4u8, 1u8, worker.pubkey()),
        (2usize, 5u8, 2u8, Pubkey::default()),
    ] {
        let offset = work_record_offset(index);
        assert_eq!(completed_work.data[offset + 32], kind);
        assert_eq!(completed_work.data[offset + 33], disposition);
        assert_eq!(
            &completed_work.data[offset + 34..offset + 66],
            expected_worker.as_ref()
        );
        assert_ne!(&completed_work.data[offset + 66..offset + 98], &[0; 32]);
        assert!(read_u64(&completed_work.data, offset + 98) > 0);
    }

    let ledger = world
        .svm
        .get_account(&ledger_pda(&kernel.economy_hash, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&ledger.data, 75), 110);
    assert_eq!(read_u64(&ledger.data, 83), 0);
    assert_eq!(read_u64(&ledger.data, 91), 13);
    assert_eq!(read_u64(&ledger.data, 115), 20);
    assert_eq!(read_u64(&ledger.data, 123), 0);
    assert_eq!(read_u64(&ledger.data, 131), 10);
    assert_eq!(read_u64(&ledger.data, 155), 6);
    assert_eq!(read_u64(&ledger.data, 163), 0);
    assert_eq!(read_u64(&ledger.data, 179), 1);
    assert_eq!(read_u64(&ledger.data, 187), 1);
    assert_eq!(read_u64(&ledger.data, 211), 1);
    assert_eq!(read_u16(&ledger.data, 219), 0);
    assert_eq!(read_u64(&ledger.data, 237), 1);
    let player_day = world
        .svm
        .get_account(&player_day_pda(&kernel.economy_hash, day, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&player_day.data, 84), 1);
    assert_eq!(read_u64(&player_day.data, 92), 1);
    assert_eq!(read_u64(&player_day.data, 100), 6);
    let rank = world
        .svm
        .get_account(&rank_shard_pda(&kernel.economy_hash, day, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&rank.data, 52), 1);
    assert_eq!(read_u64(&rank.data, 60), 1);
}

#[test]
fn equality_waits_for_permissionless_void_and_canonical_absent_work_page_is_safe() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let worker = world.wallet();
    let finalizer = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let nonce = 0;
    let stake = 10;
    let side = 1;
    let p_bps = 5_500;
    let salt = [62; 32];
    let entry_target = NOW + 60;
    let exit_target = entry_target + 300;
    let day = score_day(exit_target);
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        side,
        p_bps,
        &salt,
    );
    world.put_open_need(kernel.spec_hash, entry_target);
    world.put_open_need(kernel.spec_hash, exit_target);
    world
        .seal_forward(&player, &kernel, nonce, commit, stake, entry_target)
        .unwrap();

    let shot_key = shot_pda(&kernel.economy_hash, &player.pubkey(), nonce);
    let history_key = history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let canonical_work = work_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    assert!(world.svm.get_account(&canonical_work).is_none());

    world.set_clock(entry_target);
    let entry = world.put_final(kernel.spec_hash, entry_target, 10_000);
    let sealed_before = world.svm.get_account(&shot_key).unwrap().data;
    let wrong_work = Pubkey::new_unique();
    world.put_empty_system_account(wrong_work, 17);
    assert!(world
        .activate_with_work_page(&worker, &player.pubkey(), &kernel, nonce, entry, wrong_work,)
        .is_err());
    assert_eq!(
        world.svm.get_account(&shot_key).unwrap().data,
        sealed_before,
        "wrong optional WorkPage must roll back the action"
    );
    world
        .activate(&worker, &player.pubkey(), &kernel, nonce, entry)
        .unwrap();
    assert!(
        world.svm.get_account(&canonical_work).is_none(),
        "canonical system-owned zero-data WorkPage is logical absence, not a required DB"
    );

    world.set_clock(exit_target);
    let exit = world.put_final(kernel.spec_hash, exit_target, 10_000);
    world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .unwrap();
    let awaiting_void = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(awaiting_void.data[212], 7);
    assert_eq!(awaiting_void.data[213], 5);
    assert_eq!(awaiting_void.data[567], 0);
    assert_ne!(&awaiting_void.data[716..748], &[0; 32]);
    assert_eq!(&awaiting_void.data[748..780], &[0; 32]);
    let locked = world
        .svm
        .get_account(&ledger_pda(&kernel.economy_hash, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&locked.data, 75), 90);
    assert_eq!(read_u64(&locked.data, 83), 10);
    assert_eq!(read_u16(&locked.data, 219), 1);

    let player_before_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    world
        .finalize_resolved_void(&finalizer, &player.pubkey(), &kernel, nonce)
        .unwrap();
    let player_after_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    assert!(
        player_after_close > player_before_close,
        "closed Shot rent must return to the immutable player rent_refund"
    );
    assert_closed(&world, shot_key);
    assert!(
        world.svm.get_account(&canonical_work).is_none(),
        "all actions must remain permissionless when nobody sponsored a WorkPage"
    );

    let history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(history.data.len(), HISTORY_BASE_LEN);
    assert_eq!(history.data[87], 1);
    let result = 88;
    assert_eq!(&history.data[result + 32..result + 64], &commit);
    assert_eq!(
        (history.data[result + 64], history.data[result + 65]),
        (5, 5)
    );
    assert_eq!(read_u64(&history.data, result + 66), stake);
    assert_eq!(history.data[result + 98], 0);
    assert_eq!(read_u16(&history.data, result + 99), 0);
    let expected_game_hash = expected_game_result_hash(
        &kernel.economy_hash,
        &player.pubkey(),
        nonce,
        &kernel.ruleset_hash,
        &commit,
        stake,
        NOW,
        entry_target,
        exit_target,
        5,
        5,
        0,
        0,
        &Pubkey::default(),
        &entry.result_hash,
        &exit.result_hash,
        0,
        0,
        0,
        day,
    );
    assert_eq!(read_hash(&history.data, result + 133), expected_game_hash);

    let ledger = world
        .svm
        .get_account(&ledger_pda(&kernel.economy_hash, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&ledger.data, 75), 100);
    assert_eq!(read_u64(&ledger.data, 83), 0);
    assert_eq!(read_u64(&ledger.data, 123), 0);
    assert_eq!(read_u64(&ledger.data, 139), 10);
    assert_eq!(read_u64(&ledger.data, 163), 0);
    assert_eq!(read_u64(&ledger.data, 195), 1);
    assert_eq!(read_u16(&ledger.data, 219), 0);
    assert_eq!(read_u64(&ledger.data, 237), 1);
    let player_day = world
        .svm
        .get_account(&player_day_pda(&kernel.economy_hash, day, &player.pubkey()))
        .unwrap();
    assert_eq!(read_u64(&player_day.data, 84), 1);
    assert_eq!(read_u64(&player_day.data, 92), 1);
    assert_eq!(read_u64(&player_day.data, 100), 0);
}

#[test]
fn reload_rcx_uses_real_token_2022_memo_route_burn_packed_history_and_atomic_replay() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let champion = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.install_rcx_mainnet_mint();

    let player_token = canonical_rcx_ata(&player.pubkey());
    let champion_token = canonical_rcx_ata(&champion.pubkey());
    world.put_memo_token_account(player_token, player.pubkey(), 20 * RCX_UNIT);
    world.put_memo_token_account(champion_token, champion.pubkey(), 0);
    assert!(world.token_requires_memo(player_token));
    assert!(world.token_requires_memo(champion_token));

    let mint = world.svm.get_account(&rcx_mint()).unwrap();
    assert_eq!(mint.owner, token_2022());
    assert_eq!(mint.data.len(), 409);
    assert_eq!(world.mint_supply(), RCX_SUPPLY);

    let payout_day = utc_day(NOW) - 1;
    let (day_final, final_hash) = world.put_day_final(
        &kernel,
        payout_day,
        [
            (champion.pubkey(), 100),
            (Pubkey::default(), 0),
            (Pubkey::default(), 0),
        ],
        registrar.pubkey(),
    );
    let day_data = world.svm.get_account(&day_final).unwrap().data;
    assert_eq!(day_data.len(), DAY_FINAL_LEN);
    assert_eq!(read_i64(&day_data, 43), payout_day);
    assert_eq!(read_u64(&day_data, 51), 1);
    assert_eq!(read_u64(&day_data, 59), 1);
    assert_eq!(&day_data[67..99], champion.pubkey().as_ref());
    assert_eq!(read_u64(&day_data, 99), 100);
    assert_eq!(read_hash(&day_data, 219), final_hash);

    world.open_ledger(&player, &kernel).unwrap();
    world
        .open_reload_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let gross = 10 * RCX_UNIT;
    let routed = 1_500_000;
    let burned = 8_500_000;
    let retained = 0;
    let consumed = gross;
    let credits = 10;
    let ledger_key = ledger_pda(&kernel.economy_hash, &player.pubkey());
    let (reload_page_key, reload_page_bump) =
        reload_history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let ledger_before = world.svm.get_account(&ledger_key).unwrap().data;
    let reload_page_before = world.svm.get_account(&reload_page_key).unwrap().data;
    assert_eq!(reload_page_before.len(), RELOAD_HISTORY_BASE_LEN);
    assert_eq!(read_u32(&reload_page_before, 83), 0);

    // Positive-control the destination's real MemoTransfer enforcement: the
    // bundled Token-2022 processor rejects an otherwise-valid transfer with no
    // preceding Memo instruction, and rolls back both token accounts.
    let direct_without_memo = spl_token_2022_interface::instruction::transfer_checked(
        &token_2022(),
        &player_token,
        &rcx_mint(),
        &champion_token,
        &player.pubkey(),
        &[],
        1,
        6,
    )
    .unwrap();
    let player_before = world.token_balance(player_token);
    let champion_before = world.token_balance(champion_token);
    let supply_before = world.mint_supply();
    world
        .send_with_logs(direct_without_memo, &[&player])
        .expect_err("MemoTransfer destination must reject a transfer without a memo");
    assert_eq!(world.token_balance(player_token), player_before);
    assert_eq!(world.token_balance(champion_token), champion_before);
    assert_eq!(world.mint_supply(), supply_before);

    // The Core parser has already authenticated the ledger and packed history
    // page when it reaches Memo program validation. A wrong executable Memo id
    // must roll the whole transaction back atomically.
    let wrong_memo_error = world
        .reload_single_champion(
            &player,
            &kernel,
            day_final,
            final_hash,
            0,
            gross,
            player_token,
            champion_token,
            wrong_memo_program(),
        )
        .expect_err("wrong Memo program must fail");
    assert!(
        wrong_memo_error.contains("WrongMemoProgram")
            || wrong_memo_error.contains("InvalidProgramId"),
        "unexpected wrong-Memo failure: {wrong_memo_error}"
    );
    assert_eq!(
        world.svm.get_account(&ledger_key).unwrap().data,
        ledger_before
    );
    assert_eq!(
        world.svm.get_account(&reload_page_key).unwrap().data,
        reload_page_before
    );
    assert_eq!(world.token_balance(player_token), player_before);
    assert_eq!(world.token_balance(champion_token), champion_before);
    assert_eq!(world.mint_supply(), supply_before);

    let logs = world
        .reload_single_champion(
            &player,
            &kernel,
            day_final,
            final_hash,
            0,
            gross,
            player_token,
            champion_token,
            memo_program(),
        )
        .unwrap();
    let memo_invoke = logs
        .iter()
        .position(|line| line.contains(&memo_program().to_string()) && line.contains("invoke"))
        .expect("real Memo CPI");
    let token_invokes: Vec<usize> = logs
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            (line.contains(&token_2022().to_string()) && line.contains("invoke")).then_some(index)
        })
        .collect();
    assert_eq!(token_invokes.len(), 2, "one transfer_checked and one burn");
    assert!(memo_invoke < token_invokes[0]);
    let transfer_log = logs
        .iter()
        .position(|line| line.contains("Instruction: TransferChecked"))
        .expect("real Token-2022 transfer_checked");
    let burn_log = logs
        .iter()
        .position(|line| line.contains("Instruction: Burn"))
        .expect("real Token-2022 burn");
    assert!(memo_invoke < transfer_log && transfer_log < burn_log);

    let route_digest = reload_route_memo(
        &kernel.economy_hash,
        &player.pubkey(),
        0,
        payout_day,
        &final_hash,
        0,
        &champion_token,
        routed,
    );
    let memo_payload = lowercase_hex(&route_digest);
    assert_eq!(memo_payload.len(), 64);
    assert!(memo_payload
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    assert!(
        logs.iter().any(|line| line.contains(&memo_payload)),
        "Memo program must log the independently reconstructed 64-byte ASCII digest"
    );

    assert_eq!(world.token_balance(player_token), 10 * RCX_UNIT);
    assert_eq!(world.token_balance(champion_token), routed);
    assert_eq!(world.mint_supply(), RCX_SUPPLY - burned);

    let ledger = world.svm.get_account(&ledger_key).unwrap();
    assert_eq!(ledger.owner, core_program());
    assert_eq!(ledger.data.len(), LEDGER_LEN);
    assert_eq!(read_u64(&ledger.data, 75), credits);
    assert_eq!(read_u64(&ledger.data, 107), credits);
    assert_eq!(read_u64(&ledger.data, 245), 1);
    assert_eq!(read_u64(&ledger.data, 253), burned);
    assert_eq!(read_u64(&ledger.data, 261), routed);
    assert_eq!(read_u64(&ledger.data, 269), consumed);
    assert_eq!(read_u64(&ledger.data, 277), retained);

    let reload_page = world.svm.get_account(&reload_page_key).unwrap();
    assert_eq!(reload_page.owner, core_program());
    assert_eq!(
        reload_page.data.len(),
        RELOAD_HISTORY_BASE_LEN + RELOAD_RECORD_LEN
    );
    assert_eq!(
        &reload_page.data[..8],
        &discriminator("account", "ReloadHistoryPage")
    );
    assert_eq!(read_u16(&reload_page.data, 8), SCHEMA);
    assert_eq!(reload_page.data[10], reload_page_bump);
    assert_eq!(&reload_page.data[11..43], &kernel.economy_hash);
    assert_eq!(&reload_page.data[43..75], player.pubkey().as_ref());
    assert_eq!(read_u64(&reload_page.data, 75), 0);
    assert_eq!(read_u32(&reload_page.data, 83), 1);
    let record = RELOAD_HISTORY_BASE_LEN;
    assert_eq!(read_i64(&reload_page.data, record), payout_day);
    assert_eq!(read_hash(&reload_page.data, record + 8), final_hash);
    assert_eq!(read_u64(&reload_page.data, record + 40), gross);
    assert_eq!(&reload_page.data[record + 48..record + 51], &[2, 1, 1]);

    // The packed append position and monotonic ledger nonce jointly reject
    // replay. No successful token/state mutation may be partially repeated.
    let ledger_after = ledger.data;
    let reload_page_after = reload_page.data;
    let player_after = world.token_balance(player_token);
    let champion_after = world.token_balance(champion_token);
    let supply_after = world.mint_supply();
    world
        .reload_single_champion(
            &player,
            &kernel,
            day_final,
            final_hash,
            0,
            gross,
            player_token,
            champion_token,
            memo_program(),
        )
        .expect_err("packed reload history/nonce must reject replay");
    assert_eq!(
        world.svm.get_account(&ledger_key).unwrap().data,
        ledger_after
    );
    assert_eq!(
        world.svm.get_account(&reload_page_key).unwrap().data,
        reload_page_after
    );
    assert_eq!(world.token_balance(player_token), player_after);
    assert_eq!(world.token_balance(champion_token), champion_after);
    assert_eq!(world.mint_supply(), supply_after);
}

#[test]
fn delegated_forward_survives_revocation_and_pending_expiry_void_is_permissionless() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let delegate = world.wallet();
    let worker = world.wallet();
    let finalizer = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let grant_id = [41; 16];
    let grant_key = world
        .grant_delegate(&player, &delegate.pubkey(), &kernel, grant_id)
        .unwrap();
    let grant = world.svm.get_account(&grant_key).unwrap();
    assert_eq!(grant.owner, core_program());
    assert_eq!(grant.data.len(), 204);
    assert_eq!(&grant.data[..8], &discriminator("account", "DelegateGrant"));
    assert_eq!(&grant.data[11..27], &grant_id);
    assert_eq!(&grant.data[91..123], player.pubkey().as_ref());
    assert_eq!(&grant.data[123..155], delegate.pubkey().as_ref());
    assert_eq!(read_u64(&grant.data, 155), 10);
    assert_eq!(read_u64(&grant.data, 163), 20);
    assert_eq!(read_u16(&grant.data, 171), 2);
    assert_eq!(read_u32(&grant.data, 173), 1);
    assert_eq!(grant.data[203], 0);

    let nonce = 0;
    let side = 1;
    let p_bps = 6_000;
    let salt = [101; 32];
    let stake = 10;
    let entry_target = NOW + 60;
    let exit_target = entry_target + 300;
    let day = score_day(exit_target);
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        side,
        p_bps,
        &salt,
    );
    world
        .open_timepin_need(&delegate, kernel.spec_hash, entry_target)
        .unwrap();
    world
        .open_timepin_need(&delegate, kernel.spec_hash, exit_target)
        .unwrap();
    world
        .seal_forward_delegated(
            &delegate,
            &player.pubkey(),
            grant_key,
            &kernel,
            nonce,
            commit,
            stake,
            entry_target,
        )
        .unwrap();

    let ledger_key = ledger_pda(&kernel.economy_hash, &player.pubkey());
    let history_key = history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let shot_key = shot_pda(&kernel.economy_hash, &player.pubkey(), nonce);
    let sealed = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(sealed.data[211], 2);
    assert_eq!(sealed.data[212], 1);
    assert_eq!(&sealed.data[107..139], delegate.pubkey().as_ref());
    assert_eq!(&sealed.data[139..171], delegate.pubkey().as_ref());
    let consumed_grant = world.svm.get_account(&grant_key).unwrap();
    assert_eq!(read_u64(&consumed_grant.data, 185), stake);
    assert_eq!(read_u16(&consumed_grant.data, 193), 1);
    assert_eq!(read_i64(&consumed_grant.data, 195), NOW);

    // The canonical ledger nonce and one-shot Shot PDA reject an exact retry
    // without any partial grant, ledger, history, or Shot mutation.
    let replay_ledger = world.svm.get_account(&ledger_key).unwrap().data;
    let replay_grant = consumed_grant.data;
    let replay_history = world.svm.get_account(&history_key).unwrap().data;
    let replay_shot = sealed.data;
    world
        .seal_forward_delegated(
            &delegate,
            &player.pubkey(),
            grant_key,
            &kernel,
            nonce,
            commit,
            stake,
            entry_target,
        )
        .expect_err("same delegated nonce must not replay");
    assert_eq!(
        world.svm.get_account(&ledger_key).unwrap().data,
        replay_ledger
    );
    assert_eq!(
        world.svm.get_account(&grant_key).unwrap().data,
        replay_grant
    );
    assert_eq!(
        world.svm.get_account(&history_key).unwrap().data,
        replay_history
    );
    assert_eq!(world.svm.get_account(&shot_key).unwrap().data, replay_shot);

    world.revoke_delegate(&player, &kernel, grant_key).unwrap();
    assert_eq!(world.svm.get_account(&grant_key).unwrap().data[203], 1);

    // Revocation blocks only a new seal. Even though account initialization
    // precedes the handler check, the failed transaction rolls every write back.
    let rejected_nonce = 1;
    let rejected_commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        rejected_nonce,
        0,
        4_000,
        &[102; 32],
    );
    let revoked_ledger = world.svm.get_account(&ledger_key).unwrap().data;
    let revoked_grant = world.svm.get_account(&grant_key).unwrap().data;
    let revoked_history = world.svm.get_account(&history_key).unwrap().data;
    world
        .seal_forward_delegated(
            &delegate,
            &player.pubkey(),
            grant_key,
            &kernel,
            rejected_nonce,
            rejected_commit,
            stake,
            entry_target,
        )
        .expect_err("revoked grant must reject a new seal");
    assert_eq!(
        world.svm.get_account(&ledger_key).unwrap().data,
        revoked_ledger
    );
    assert_eq!(
        world.svm.get_account(&grant_key).unwrap().data,
        revoked_grant
    );
    assert_eq!(
        world.svm.get_account(&history_key).unwrap().data,
        revoked_history
    );
    assert!(
        world
            .svm
            .get_account(&shot_pda(
                &kernel.economy_hash,
                &player.pubkey(),
                rejected_nonce,
            ))
            .is_none(),
        "revoked seal must not strand an initialized Shot"
    );

    let entry = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, entry_target, 10_000)
        .unwrap();
    world
        .activate(&worker, &player.pubkey(), &kernel, nonce, entry)
        .unwrap();
    let exit = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, exit_target, 11_000)
        .unwrap();
    world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .unwrap();
    let delegate_before_close = world.svm.get_account(&delegate.pubkey()).unwrap().lamports;
    world
        .reveal_delegated(
            &delegate,
            &player.pubkey(),
            &kernel,
            nonce,
            side,
            p_bps,
            salt,
        )
        .unwrap();
    let delegate_after_close = world.svm.get_account(&delegate.pubkey()).unwrap().lamports;
    assert!(
        delegate_after_close > delegate_before_close,
        "revoked delegate may safely finish and receives its frozen Shot rent refund"
    );
    assert_closed(&world, shot_key);

    let delegated_history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(
        delegated_history.data.len(),
        HISTORY_BASE_LEN
    );
    let first_result = 88;
    assert_eq!(
        (
            delegated_history.data[first_result + 64],
            delegated_history.data[first_result + 65],
        ),
        (4, 0)
    );
    assert_eq!(
        &delegated_history.data[first_result + 101..first_result + 133],
        delegate.pubkey().as_ref()
    );
    assert_eq!(
        read_hash(&delegated_history.data, first_result + 133),
        expected_game_result_hash(
            &kernel.economy_hash,
            &player.pubkey(),
            nonce,
            &kernel.ruleset_hash,
            &salt,
            stake,
            NOW,
            entry_target,
            exit_target,
            4,
            0,
            side,
            p_bps,
            &delegate.pubkey(),
            &entry.result_hash,
            &exit.result_hash,
            1,
            1,
            6,
            day,
        )
    );

    // A direct second Shot proves the distinct PendingEntry -> expiry -> VOID
    // route while the canonical optional WorkPage remains absent.
    let seal_now = world.svm.get_sysvar::<Clock>().unix_timestamp;
    let pending_entry_target = (seal_now + 30 + 59).div_euclid(60) * 60;
    let pending_exit_target = pending_entry_target + 300;
    let pending_day = score_day(pending_exit_target);
    let pending_salt = [103; 32];
    let pending_commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        rejected_nonce,
        0,
        4_000,
        &pending_salt,
    );
    world
        .open_timepin_need(&player, kernel.spec_hash, pending_entry_target)
        .unwrap();
    world
        .open_timepin_need(&player, kernel.spec_hash, pending_exit_target)
        .unwrap();
    world
        .seal_forward(
            &player,
            &kernel,
            rejected_nonce,
            pending_commit,
            stake,
            pending_entry_target,
        )
        .unwrap();
    let pending_shot = shot_pda(&kernel.economy_hash, &player.pubkey(), rejected_nonce);
    let expired_entry = world
        .expire_timepin_need(&finalizer, kernel.spec_hash, pending_entry_target)
        .unwrap();
    let player_before_void = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    world
        .void_pending_entry(&finalizer, &player.pubkey(), &kernel, rejected_nonce)
        .unwrap();
    let player_after_void = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    assert!(player_after_void > player_before_void);
    assert_closed(&world, pending_shot);
    assert!(world
        .svm
        .get_account(&work_page_pda(&kernel.economy_hash, &player.pubkey(), 0))
        .is_none());

    let history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(
        history.data.len(),
        HISTORY_BASE_LEN + 2 * (1 + SHOT_RESULT_LEN)
    );
    assert_eq!(read_u32(&history.data, 83), 2);
    assert_eq!(history.data[253], 1);
    let second_result = 254;
    assert_eq!(
        (
            history.data[second_result + 64],
            history.data[second_result + 65],
        ),
        (5, 1)
    );
    assert_eq!(
        read_hash(&history.data, second_result + 133),
        expected_game_result_hash(
            &kernel.economy_hash,
            &player.pubkey(),
            rejected_nonce,
            &kernel.ruleset_hash,
            &pending_commit,
            stake,
            seal_now,
            pending_entry_target,
            pending_exit_target,
            5,
            1,
            0,
            0,
            &Pubkey::default(),
            &expired_entry,
            &[0; 32],
            0,
            0,
            0,
            pending_day,
        )
    );
}

#[test]
fn observed_seal_replay_rolls_back_and_active_expiry_void_is_permissionless() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let worker = world.wallet();
    let finalizer = world.wallet();
    let kernel = world.bootstrap_observed(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();

    let nonce = 0;
    let stake = 10;
    let side = 1;
    let p_bps = 6_200;
    let salt = [111; 32];
    let entry_target = NOW + 60;
    world
        .open_timepin_need(&player, kernel.spec_hash, entry_target)
        .unwrap();
    let entry = world
        .capture_and_finalize_timepin(&worker, kernel.spec_hash, entry_target, 10_000)
        .unwrap();
    let sealed_ts = world.svm.get_sysvar::<Clock>().unix_timestamp;
    assert_eq!(sealed_ts, entry_target + CAPTURE_DEADLINE_OFFSET);
    let exit_target = sealed_ts + 300;
    let day = score_day(exit_target);
    world
        .open_timepin_need(&player, kernel.spec_hash, exit_target)
        .unwrap();
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        side,
        p_bps,
        &salt,
    );
    world
        .seal_observed(&player, &kernel, nonce, commit, stake, entry, exit_target)
        .unwrap();

    let ledger_key = ledger_pda(&kernel.economy_hash, &player.pubkey());
    let history_key = history_page_pda(&kernel.economy_hash, &player.pubkey(), 0);
    let shot_key = shot_pda(&kernel.economy_hash, &player.pubkey(), nonce);
    let active = world.svm.get_account(&shot_key).unwrap();
    assert_eq!(active.data[211], 1);
    assert_eq!(active.data[212], 2);
    assert_eq!(read_hash(&active.data, 383), entry.message_hash);
    assert_eq!(read_hash(&active.data, 415), entry.result_hash);

    let replay_ledger = world.svm.get_account(&ledger_key).unwrap().data;
    let replay_history = world.svm.get_account(&history_key).unwrap().data;
    let replay_shot = active.data;
    world
        .seal_observed(&player, &kernel, nonce, commit, stake, entry, exit_target)
        .expect_err("same observed nonce must not replay");
    assert_eq!(
        world.svm.get_account(&ledger_key).unwrap().data,
        replay_ledger
    );
    assert_eq!(
        world.svm.get_account(&history_key).unwrap().data,
        replay_history
    );
    assert_eq!(world.svm.get_account(&shot_key).unwrap().data, replay_shot);

    let expired_exit = world
        .expire_timepin_need(&finalizer, kernel.spec_hash, exit_target)
        .unwrap();
    let player_before_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    world
        .void_active_shot(&finalizer, &player.pubkey(), &kernel, nonce)
        .unwrap();
    let player_after_close = world.svm.get_account(&player.pubkey()).unwrap().lamports;
    assert!(player_after_close > player_before_close);
    assert_closed(&world, shot_key);
    assert!(world
        .svm
        .get_account(&work_page_pda(&kernel.economy_hash, &player.pubkey(), 0))
        .is_none());

    let history = world.svm.get_account(&history_key).unwrap();
    assert_eq!(history.data.len(), HISTORY_BASE_LEN);
    assert_eq!(history.data[87], 1);
    let result = 88;
    assert_eq!(
        (history.data[result + 64], history.data[result + 65]),
        (5, 3)
    );
    assert_eq!(
        read_hash(&history.data, result + 133),
        expected_game_result_hash(
            &kernel.economy_hash,
            &player.pubkey(),
            nonce,
            &kernel.ruleset_hash,
            &commit,
            stake,
            sealed_ts,
            entry_target,
            exit_target,
            5,
            3,
            0,
            0,
            &Pubkey::default(),
            &entry.result_hash,
            &expired_exit,
            0,
            0,
            0,
            day,
        )
    );
}

#[test]
fn settle_final_rejects_candidate_need() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let mut candidate_need = world
        .svm
        .get_account(&exit.need)
        .expect("positive-control Final Need");
    assert_eq!(candidate_need.data[11], 2);
    candidate_need.data[11] = 1;
    world.svm.set_account(exit.need, candidate_need).unwrap();

    let before = world.snapshot_accounts(&settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect_err("Candidate Need must not settle");
    assert_anchor_custom_error(&error, "NeedNotFinal", TIMEPIN_NEED_NOT_FINAL);
    world.assert_accounts_unchanged(&before, "Candidate Need settlement");
}

#[test]
fn void_active_shot_rejects_final_need() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let before = world.snapshot_accounts(&void_active_account_keys(
        &kernel,
        &player.pubkey(),
        nonce,
        exit_target,
    ));
    let error = world
        .void_active_shot(&worker, &player.pubkey(), &kernel, nonce)
        .expect_err("Final Need must not take the void path");
    assert_anchor_custom_error(
        &error,
        "NeedNotVoidTerminal",
        TIMEPIN_NEED_NOT_VOID_TERMINAL,
    );
    world.assert_accounts_unchanged(&before, "Final Need void");
    assert_eq!(
        world.svm.get_account(&exit.need).unwrap().data[11],
        2,
        "positive-control Need must remain Final"
    );
}

#[test]
fn settle_final_rejects_candidate_for_other_message_hash() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let other_message = world.put_final(kernel.spec_hash, exit_target, 12_000);
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    assert_eq!(other_message.need, exit.need);
    assert_ne!(other_message.message_hash, exit.message_hash);
    assert_ne!(other_message.candidate, exit.candidate);
    let wrong_candidate_exit = FinalEvidence {
        candidate: other_message.candidate,
        ..exit
    };
    let mut keys = settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        wrong_candidate_exit,
    );
    keys.push(exit.candidate);
    let before = world.snapshot_accounts(&keys);
    let error = world
        .settle(
            &worker,
            &player.pubkey(),
            &kernel,
            nonce,
            wrong_candidate_exit,
        )
        .expect_err("Candidate for another message hash must not settle");
    assert_anchor_custom_error(&error, "WrongCandidatePda", TIMEPIN_WRONG_CANDIDATE_PDA);
    world.assert_accounts_unchanged(&before, "wrong-message Candidate settlement");
}

#[test]
fn settle_final_replay_is_rejected() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect("positive-control settlement");
    let shot = shot_pda(&kernel.economy_hash, &player.pubkey(), nonce);
    assert_eq!(
        world.svm.get_account(&shot).unwrap().data[212],
        3,
        "positive control must reach AwaitReveal"
    );

    let before = world.snapshot_accounts(&settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect_err("settle_final must not replay");
    assert_anchor_custom_error(&error, "WrongState", CORE_WRONG_STATE);
    world.assert_accounts_unchanged(&before, "settle_final replay");
}

#[test]
fn settle_final_rejects_other_final_need() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let canonical_exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let other_exit = world.put_final(kernel.spec_hash, exit_target + 60, 12_000);
    assert_ne!(canonical_exit.need, other_exit.need);
    assert_eq!(
        score_day(canonical_exit.target),
        score_day(other_exit.target),
        "the one-account mutation must retain the same score accounts"
    );

    let mut keys = settle_account_keys(&kernel, &kernel, &player.pubkey(), nonce, other_exit);
    keys.extend([canonical_exit.need, canonical_exit.candidate]);
    let before = world.snapshot_accounts(&keys);
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, other_exit)
        .expect_err("a different valid Final Need must not settle this Shot");
    assert_anchor_custom_error(&error, "WrongNeed", CORE_WRONG_NEED);
    world.assert_accounts_unchanged(&before, "different Final Need settlement");
}

#[test]
fn seal_forward_rejects_final_need() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    world.claim_legacy(&player, &kernel).unwrap();
    world
        .open_history_page(&player, &player.pubkey(), &kernel, 0)
        .unwrap();
    let nonce = 0;
    let entry_target = NOW + 60;
    let exit_target = entry_target + 300;
    world.put_open_need(kernel.spec_hash, entry_target);
    world.put_final(kernel.spec_hash, exit_target, 11_000);
    let salt = [0x61; 32];
    let commit = commitment(
        &kernel.economy_hash,
        &kernel.ruleset_hash,
        &player.pubkey(),
        nonce,
        1,
        6_000,
        &salt,
    );

    let before = world.snapshot_accounts(&seal_forward_account_keys(
        &kernel,
        &player.pubkey(),
        nonce,
        entry_target,
    ));
    let error = world
        .seal_forward(&player, &kernel, nonce, commit, 10, entry_target)
        .expect_err("seal_forward must require an Open exit Need");
    assert_anchor_custom_error(&error, "NeedNotOpen", TIMEPIN_NEED_NOT_OPEN);
    world.assert_accounts_unchanged(&before, "seal with Final Need");
}

#[test]
fn settle_final_rejects_shot_from_another_economy_and_ruleset() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let other_registrar = world.wallet();
    let other_legacy_player = world.wallet();
    let other_kernel = world.bootstrap(&other_registrar, &other_legacy_player.pubkey());
    assert_ne!(other_kernel.economy_hash, kernel.economy_hash);
    assert_ne!(other_kernel.ruleset_hash, kernel.ruleset_hash);
    world.open_ledger(&player, &other_kernel).unwrap();

    let before = world.snapshot_accounts(&settle_account_keys(
        &other_kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle_against_kernel(
            &worker,
            &player.pubkey(),
            &other_kernel,
            &kernel,
            nonce,
            exit,
        )
        .expect_err("a Shot from another Economy/Ruleset must not settle");
    assert_anchor_custom_error(&error, "WrongShot", CORE_WRONG_SHOT);
    world.assert_accounts_unchanged(&before, "cross-Economy settlement");
}

#[test]
fn register_economy_rejects_wrong_or_nonexecutable_timepin_and_changed_bytes() {
    let mut world = World::new();
    let registrar = world.wallet();
    let player = world.wallet();
    let kernel = world.bootstrap(&registrar, &player.pubkey());
    let canonical_economy = world.svm.get_account(&kernel.economy).unwrap();

    world
        .register_economy(
            &registrar,
            kernel.economy_hash,
            kernel.economy,
            &kernel.economy_args,
        )
        .expect("byte-identical Economy registration must be idempotent");

    let wrong_timepin = Pubkey::new_unique();
    let canonical_timepin = world.svm.get_account(&timepin_program()).unwrap();
    world
        .svm
        .set_account(wrong_timepin, canonical_timepin.clone())
        .unwrap();
    let error = world
        .register_economy_with_program(
            &registrar,
            kernel.economy_hash,
            kernel.economy,
            &kernel.economy_args,
            wrong_timepin,
        )
        .expect_err("a different Timepin program key must be rejected");
    assert_anchor_custom_error(&error, "WrongTimepinProgram", CORE_WRONG_TIMEPIN_PROGRAM);
    assert_eq!(
        world.svm.get_account(&kernel.economy).unwrap(),
        canonical_economy
    );

    let mut nonexecutable_timepin = canonical_timepin.clone();
    nonexecutable_timepin.executable = false;
    world
        .svm
        .set_account(timepin_program(), nonexecutable_timepin)
        .unwrap();
    let error = world
        .register_economy(
            &registrar,
            kernel.economy_hash,
            kernel.economy,
            &kernel.economy_args,
        )
        .expect_err("a non-executable canonical Timepin account must be rejected");
    assert_anchor_custom_error(
        &error,
        "TimepinProgramNotExecutable",
        CORE_TIMEPIN_PROGRAM_NOT_EXECUTABLE,
    );
    world
        .svm
        .set_account(timepin_program(), canonical_timepin)
        .unwrap();
    assert_eq!(
        world.svm.get_account(&kernel.economy).unwrap(),
        canonical_economy
    );

    let mut changed_args = kernel.economy_args.clone();
    changed_args[68] ^= 1;
    let error = world
        .register_economy(
            &registrar,
            kernel.economy_hash,
            kernel.economy,
            &changed_args,
        )
        .expect_err("changed Economy bytes must not pass the original content hash");
    assert_anchor_custom_error(&error, "WrongExpectedHash", CORE_WRONG_EXPECTED_HASH);
    assert_eq!(
        world.svm.get_account(&kernel.economy).unwrap(),
        canonical_economy
    );
}

#[test]
fn settle_final_rejects_lookalike_owned_need_and_candidate_bytes() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let lookalike_owner = Pubkey::new_unique();

    let canonical_need = world.svm.get_account(&exit.need).unwrap();
    let mut lookalike_need = canonical_need.clone();
    lookalike_need.owner = lookalike_owner;
    world.svm.set_account(exit.need, lookalike_need).unwrap();
    let before = world.snapshot_accounts(&settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect_err("identical Need bytes from a lookalike owner must be rejected");
    assert_anchor_custom_error(&error, "WrongTimepinOwner", TIMEPIN_WRONG_OWNER);
    world.assert_accounts_unchanged(&before, "lookalike-owned Need");
    world.svm.set_account(exit.need, canonical_need).unwrap();

    let canonical_candidate = world.svm.get_account(&exit.candidate).unwrap();
    let mut lookalike_candidate = canonical_candidate.clone();
    lookalike_candidate.owner = lookalike_owner;
    world
        .svm
        .set_account(exit.candidate, lookalike_candidate)
        .unwrap();
    let before = world.snapshot_accounts(&settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect_err("identical Candidate bytes from a lookalike owner must be rejected");
    assert_anchor_custom_error(&error, "WrongTimepinOwner", TIMEPIN_WRONG_OWNER);
    world.assert_accounts_unchanged(&before, "lookalike-owned Candidate");
}

#[test]
fn settle_final_rejects_timepin_deadline_drift() {
    let ActiveForwardFixture {
        mut world,
        player,
        worker,
        kernel,
        nonce,
        exit_target,
        ..
    } = active_forward_fixture();
    let exit = world.put_final(kernel.spec_hash, exit_target, 11_000);
    let mut changed_need = world.svm.get_account(&exit.need).unwrap();
    changed_need.data[60..68].copy_from_slice(&(exit_target + 181).to_le_bytes());
    world.svm.set_account(exit.need, changed_need).unwrap();

    let before = world.snapshot_accounts(&settle_account_keys(
        &kernel,
        &kernel,
        &player.pubkey(),
        nonce,
        exit,
    ));
    let error = world
        .settle(&worker, &player.pubkey(), &kernel, nonce, exit)
        .expect_err("a Timepin capture-deadline drift must not settle");
    assert_anchor_custom_error(&error, "BadTimepinDeadline", CORE_BAD_TIMEPIN_DEADLINE);
    world.assert_accounts_unchanged(&before, "Timepin deadline drift");
}
