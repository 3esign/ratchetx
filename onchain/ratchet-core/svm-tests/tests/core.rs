//! RatchetX Core v1 — adversarial exercise on LiteSVM with hand-built Pyth
//! accounts. No network, no keys, no validator. Every instruction of the
//! program is driven the way a hostile or careless client would drive it.

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::str::FromStr;
mod system_program { pub fn id() -> solana_sdk::pubkey::Pubkey { solana_sdk::pubkey::Pubkey::from_str_const("11111111111111111111111111111111") } }

/// The program under test: `RATCHET_CORE_SO` if set, else the fresh
/// `../target/deploy/ratchet_core.so`, else the newest committed artifact in
/// `../artifacts/` — so the battery also runs against the exact bytes a
/// verifier reproduced, without a build.
fn so_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("RATCHET_CORE_SO") { return p.into(); }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let built = root.join("target/deploy/ratchet_core.so");
    if built.exists() { return built; }
    let mut arts: Vec<_> = std::fs::read_dir(root.join("artifacts")).expect("artifacts dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "so").unwrap_or(false)).collect();
    arts.sort();
    arts.pop().expect("no ratchet_core .so found: build with cargo build-sbf or set RATCHET_CORE_SO")
}
fn program_id() -> Pubkey { Pubkey::from_str("6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv").unwrap() }
fn rcx_mint() -> Pubkey { Pubkey::from_str("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump").unwrap() }
fn pyth_receiver() -> Pubkey { Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap() }
fn pyth_push_oracle() -> Pubkey { Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap() }
const DECIMALS: u8 = 6;
const UNIT: u64 = 1_000_000;

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 { out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap(); }
    out
}
fn feed(index: u8) -> [u8; 32] {
    const F: [&str; 7] = [
        "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
        "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
        "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
        "7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9",
    ];
    hex32(F[(index as usize).min(6)]) // out-of-range indexes still need some account to pass; the program rejects them
}
fn disc(kind: &str, name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("{kind}:{name}").as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}
fn pda(seeds: &[&[u8]]) -> Pubkey { Pubkey::find_program_address(seeds, &program_id()).0 }
fn ledger_pda(p: &Pubkey) -> Pubkey { pda(&[b"player", p.as_ref()]) }
fn shot_pda(p: &Pubkey, nonce: u64) -> Pubkey { pda(&[b"shot", p.as_ref(), &nonce.to_le_bytes()]) }
fn clock_pda(feed_index: u8) -> Pubkey { pda(&[b"clock", &[feed_index]]) }
fn podium_pda() -> Pubkey { pda(&[b"podium"]) }
fn grant_pda(p: &Pubkey, d: &Pubkey) -> Pubkey { pda(&[b"grant", p.as_ref(), d.as_ref()]) }
fn claim_pda(p: &Pubkey) -> Pubkey { pda(&[b"claim", p.as_ref()]) }
fn price_account(feed_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), feed_id], &pyth_push_oracle()).0
}
fn ata(owner: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address_with_program_id(owner, &rcx_mint(), &spl_token_2022_interface::id())
}

struct World {
    svm: LiteSVM,
    now: i64,
}

impl World {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), so_path()).expect("load .so");
        // Positive control for the real RCX token family: Token-2022, six
        // decimals, fixed supply and no mint/freeze authority.
        let mut data = vec![0u8; spl_token_2022_interface::state::Mint::LEN];
        spl_token_2022_interface::state::Mint {
            mint_authority: None.into(),
            supply: 1_000_000_000 * UNIT,
            decimals: DECIMALS,
            is_initialized: true,
            freeze_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        svm.set_account(rcx_mint(), Account { lamports: 10_000_000, data, owner: spl_token_2022_interface::id(), executable: false, rent_epoch: 0 }).unwrap();
        let mut w = World { svm, now: 1_800_000_000 };
        w.set_clock(w.now);
        w
    }
    fn set_clock(&mut self, ts: i64) {
        self.now = ts;
        let clock = Clock { slot: (ts as u64) * 2, epoch_start_timestamp: ts - 1000, epoch: 1, leader_schedule_epoch: 1, unix_timestamp: ts };
        self.svm.set_sysvar(&clock);
    }
    fn advance(&mut self, secs: i64) { let t = self.now + secs; self.set_clock(t); }
    fn player(&mut self, rcx_whole: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        self.token_account(&kp.pubkey(), rcx_whole * UNIT);
        kp
    }
    fn token_account(&mut self, owner: &Pubkey, amount: u64) {
        let mut data = vec![0u8; spl_token_2022_interface::state::Account::LEN];
        spl_token_2022_interface::state::Account {
            mint: rcx_mint(),
            owner: *owner,
            amount,
            delegate: None.into(),
            state: spl_token_2022_interface::state::AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.svm.set_account(ata(owner), Account { lamports: 10_000_000, data, owner: spl_token_2022_interface::id(), executable: false, rent_epoch: 0 }).unwrap();
    }
    fn balance(&self, owner: &Pubkey) -> u64 {
        let acc = self.svm.get_account(&ata(owner)).unwrap();
        spl_token_2022_interface::state::Account::unpack(&acc.data).unwrap().amount
    }
    fn supply(&self) -> u64 {
        spl_token_2022_interface::state::Mint::unpack(&self.svm.get_account(&rcx_mint()).unwrap().data).unwrap().supply
    }
    /// A fully verified sponsored push update as the receiver would leave it.
    fn pyth(&mut self, feed_index: u8, price: i64, conf: u64, publish_time: i64, prev_publish_time: i64) {
        let feed_id = feed(feed_index);
        let addr = price_account(&feed_id);
        let mut data = Vec::new();
        data.extend_from_slice(&disc("account", "PriceUpdateV2"));
        data.extend_from_slice(addr.as_ref()); // write_authority
        data.push(1); // VerificationLevel::Full
        data.extend_from_slice(&feed_id);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&(-8i32).to_le_bytes());
        data.extend_from_slice(&publish_time.to_le_bytes());
        data.extend_from_slice(&prev_publish_time.to_le_bytes());
        data.extend_from_slice(&price.to_le_bytes()); // ema
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&((publish_time as u64) * 2).to_le_bytes()); // posted_slot
        self.svm.set_account(addr, Account { lamports: 10_000_000, data, owner: pyth_receiver(), executable: false, rent_epoch: 0 }).unwrap();
    }
    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        let payer = signers[0];
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), signers, bh);
        match self.svm.send_transaction(tx) {
            Ok(_) => Ok(()),
            Err(e) => Err(e.meta.logs.join("\n") + &format!("\n{:?}", e.err)),
        }
    }
    fn account_data(&self, key: &Pubkey) -> Option<Vec<u8>> { self.svm.get_account(key).map(|a| a.data) }
    fn ledger(&self, p: &Pubkey) -> Ledger {
        let d = self.account_data(&ledger_pda(p)).expect("ledger");
        Ledger::parse(&d)
    }
    fn shot(&self, p: &Pubkey, nonce: u64) -> Option<ShotView> { self.account_data(&shot_pda(p, nonce)).map(|d| ShotView::parse(&d)) }

    // ---- instructions -------------------------------------------------
    fn ix(&self, name: &str, args: Vec<u8>, metas: Vec<AccountMeta>) -> Instruction {
        let mut data = disc("global", name).to_vec();
        data.extend(args);
        Instruction { program_id: program_id(), accounts: metas, data }
    }
    fn reload(&mut self, player: &Keypair, amount: u64, seats: &[Pubkey]) -> Result<(), String> {
        let mut metas = vec![
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new(ledger_pda(&player.pubkey()), false),
            AccountMeta::new(podium_pda(), false),
            AccountMeta::new(rcx_mint(), false),
            AccountMeta::new(ata(&player.pubkey()), false),
            AccountMeta::new_readonly(spl_token_2022_interface::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ];
        for s in seats { metas.push(AccountMeta::new(ata(s), false)); }
        let ix = self.ix("reload", amount.to_le_bytes().to_vec(), metas);
        self.send(ix, &[player])
    }
    fn seal(&mut self, player: &Keypair, nonce: u64, commit: [u8; 32], feed_index: u8, minutes: u16, stake: u64) -> Result<(), String> {
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commit);
        args.push(feed_index);
        args.extend_from_slice(&minutes.to_le_bytes());
        args.extend_from_slice(&stake.to_le_bytes());
        let ix = self.ix("seal", args, vec![
            AccountMeta::new(shot_pda(&player.pubkey(), nonce), false),
            AccountMeta::new(ledger_pda(&player.pubkey()), false),
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new_readonly(price_account(&feed(feed_index)), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[player])
    }
    fn seal_delegated(&mut self, delegate: &Keypair, player: &Pubkey, nonce: u64, commit: [u8; 32], feed_index: u8, minutes: u16, stake: u64) -> Result<(), String> {
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commit);
        args.push(feed_index);
        args.extend_from_slice(&minutes.to_le_bytes());
        args.extend_from_slice(&stake.to_le_bytes());
        let ix = self.ix("seal_delegated", args, vec![
            AccountMeta::new(grant_pda(player, &delegate.pubkey()), false),
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new(ledger_pda(player), false),
            AccountMeta::new(delegate.pubkey(), true),
            AccountMeta::new_readonly(price_account(&feed(feed_index)), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[delegate])
    }
    fn checkpoint(&mut self, cranker: &Keypair, feed_index: u8) -> Result<(), String> {
        let ix = self.ix("checkpoint", vec![feed_index], vec![
            AccountMeta::new(clock_pda(feed_index), false),
            AccountMeta::new(cranker.pubkey(), true),
            AccountMeta::new_readonly(price_account(&feed(feed_index)), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[cranker])
    }
    fn settle(&mut self, cranker: &Keypair, player: &Pubkey, nonce: u64, feed_index: u8) -> Result<(), String> {
        let ix = self.ix("settle", vec![], vec![
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new(ledger_pda(player), false),
            AccountMeta::new_readonly(clock_pda(feed_index), false),
            AccountMeta::new_readonly(cranker.pubkey(), true),
        ]);
        self.send(ix, &[cranker])
    }
    fn bind_crossing(&mut self, cranker: &Keypair, player: &Pubkey, nonce: u64, feed_index: u8) -> Result<(), String> {
        let ix = self.ix("bind_crossing", vec![], vec![
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new_readonly(clock_pda(feed_index), false),
            AccountMeta::new_readonly(cranker.pubkey(), true),
        ]);
        self.send(ix, &[cranker])
    }
    /// Push `n` fresh, fully verified observations into the ring, one per
    /// second, each one newer than the last. Returns the last publish time.
    fn flood_ring(&mut self, cranker: &Keypair, feed_index: u8, n: usize, price: i64, from_ts: i64) -> i64 {
        let mut t = from_ts;
        for _ in 0..n {
            self.pyth(feed_index, price, 1_000_000, t, t - 1);
            self.checkpoint(cranker, feed_index).unwrap();
            t += 1;
        }
        t - 1
    }
    fn reveal(&mut self, revealer: &Keypair, player: &Pubkey, nonce: u64, side: u8, p_bps: u16, salt: &str) -> Result<(), String> {
        let mut args = vec![side];
        args.extend_from_slice(&p_bps.to_le_bytes());
        args.extend_from_slice(&(salt.len() as u32).to_le_bytes());
        args.extend_from_slice(salt.as_bytes());
        let ix = self.ix("reveal", args, vec![
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new(ledger_pda(player), false),
            AccountMeta::new(podium_pda(), false),
            AccountMeta::new(revealer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[revealer])
    }
    fn simple(&mut self, name: &str, cranker: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        let ix = self.ix(name, vec![], vec![
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new(ledger_pda(player), false),
            AccountMeta::new_readonly(cranker.pubkey(), true),
        ]);
        self.send(ix, &[cranker])
    }
    fn close_shot(&mut self, cranker: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        let ix = self.ix("close_shot", vec![], vec![
            AccountMeta::new(shot_pda(player, nonce), false),
            AccountMeta::new(*player, false),
            AccountMeta::new_readonly(cranker.pubkey(), true),
        ]);
        self.send(ix, &[cranker])
    }
    fn grant(&mut self, player: &Keypair, delegate: &Pubkey, allowance: u64, max_stake: u64, expiry: i64) -> Result<(), String> {
        let mut args = allowance.to_le_bytes().to_vec();
        args.extend_from_slice(&max_stake.to_le_bytes());
        args.extend_from_slice(&expiry.to_le_bytes());
        let ix = self.ix("grant_delegate", args, vec![
            AccountMeta::new(grant_pda(&player.pubkey(), delegate), false),
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new_readonly(*delegate, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[player])
    }
    fn revoke(&mut self, player: &Keypair, delegate: &Pubkey) -> Result<(), String> {
        let ix = self.ix("revoke_delegate", vec![], vec![
            AccountMeta::new(grant_pda(&player.pubkey(), delegate), false),
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new_readonly(*delegate, false),
        ]);
        self.send(ix, &[player])
    }
    fn claim(&mut self, player: &Keypair, credits: u64, xp: u64) -> Result<(), String> {
        let mut args = credits.to_le_bytes().to_vec();
        args.extend_from_slice(&xp.to_le_bytes());
        args.extend_from_slice(&0u32.to_le_bytes()); // empty proof vec
        let ix = self.ix("claim_legacy", args, vec![
            AccountMeta::new(claim_pda(&player.pubkey()), false),
            AccountMeta::new(ledger_pda(&player.pubkey()), false),
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ]);
        self.send(ix, &[player])
    }
}

#[derive(Debug)]
struct Ledger { credits: u64, xp: u64, streak: u32, best: u32, hits: u64, shots: u64, voids: u64, forfeits: u64, sealed: u64, open: u16, daily_xp: u64, burned: u64 }
impl Ledger {
    fn parse(d: &[u8]) -> Self {
        let u64at = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
        let u32at = |o: usize| u32::from_le_bytes(d[o..o + 4].try_into().unwrap());
        // 8 disc + 32 player
        Ledger {
            credits: u64at(40), xp: u64at(48), streak: u32at(56), best: u32at(60),
            hits: u64at(64), shots: u64at(72), voids: u64at(80), forfeits: u64at(88), sealed: u64at(96),
            open: u16::from_le_bytes(d[104..106].try_into().unwrap()),
            daily_xp: u64at(114), burned: u64at(122),
        }
    }
}
#[derive(Debug)]
struct ShotView {
    stake: u64, xp_base: u64, xp_awarded: u64, expiry_ts: i64, entry_e12: i64, exit_e12: i64,
    exit_publish_time: i64, exit_conf_e12: i64, exit_prev_publish_time: i64, exit_posted_slot: u64,
    ruleset: u16, band_k_bps: u16, crossing_bound: u8,
    p_bps: u16, side: u8, hit: u8, state: u8, void_reason: u8,
}
impl ShotView {
    fn parse(d: &[u8]) -> Self {
        let u64at = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
        let i64at = |o: usize| i64::from_le_bytes(d[o..o + 8].try_into().unwrap());
        let u16at = |o: usize| u16::from_le_bytes(d[o..o + 2].try_into().unwrap());
        // 8 disc + 32 player + 32 delegate + 8 nonce + 32 commit + 32 feed_id + 1 feed_index + 2 minutes = 147
        let o = 147;
        assert_eq!(d.len(), 254, "ruleset 2 Shot is 8 + 246 bytes");
        ShotView {
            stake: u64at(o), xp_base: u64at(o + 8), xp_awarded: u64at(o + 16),
            expiry_ts: i64at(o + 32), entry_e12: i64at(o + 48), exit_e12: i64at(o + 56),
            exit_publish_time: i64at(o + 64), exit_conf_e12: i64at(o + 72),
            exit_prev_publish_time: i64at(o + 80), exit_posted_slot: u64at(o + 88),
            ruleset: u16at(o + 96), band_k_bps: u16at(o + 98), crossing_bound: d[o + 100],
            p_bps: u16at(o + 101),
            side: d[o + 103], hit: d[o + 104], state: d[o + 105], void_reason: d[o + 106],
        }
    }
}

fn commit(player: &Pubkey, nonce: u64, side: &str, p_bps: u16, salt: &str) -> [u8; 32] {
    let pre = format!("RATCHET|v3|{}|{}|{}|{}|{}", player, nonce, side, p_bps, salt);
    let h = Sha256::digest(pre.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&h);
    out
}
const SALT: &str = "0123456789abcdef0123456789abcdef";

fn assert_err(r: Result<(), String>, code: &str) {
    match r {
        Ok(()) => panic!("expected failure {code}, got success"),
        Err(logs) => assert!(logs.contains(code), "expected {code}, got:\n{logs}"),
    }
}

// ============================================================================

#[test]
fn reload_burns_everything_when_no_podium_and_credits_one_per_token() {
    let mut w = World::new();
    let p = w.player(1000);
    let supply = w.supply();
    w.reload(&p, 250 * UNIT + 123, &[]).unwrap();
    assert_eq!(w.balance(&p.pubkey()), 750 * UNIT - 123);
    assert_eq!(w.supply(), supply - (250 * UNIT + 123), "with no podium the entire reload burns");
    let l = w.ledger(&p.pubkey());
    assert_eq!(l.credits, 250, "1 credit per whole token, dust burns");
    assert_eq!(l.burned, 250 * UNIT + 123);

    // Classic SPL Token is a deliberate negative control. Both the mint and
    // player account belong to Token-2022, so swapping only the CPI program
    // must fail atomically and preserve every unit and credit.
    let balance_before = w.balance(&p.pubkey());
    let supply_before = w.supply();
    let credits_before = w.ledger(&p.pubkey()).credits;
    let classic_ix = w.ix("reload", (5 * UNIT).to_le_bytes().to_vec(), vec![
        AccountMeta::new(p.pubkey(), true),
        AccountMeta::new(ledger_pda(&p.pubkey()), false),
        AccountMeta::new(podium_pda(), false),
        AccountMeta::new(rcx_mint(), false),
        AccountMeta::new(ata(&p.pubkey()), false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]);
    assert!(w.send(classic_ix, &[&p]).is_err(), "classic SPL Token must not stand in for RCX Token-2022");
    assert_eq!(w.balance(&p.pubkey()), balance_before);
    assert_eq!(w.supply(), supply_before);
    assert_eq!(w.ledger(&p.pubkey()).credits, credits_before);

    assert_err(w.reload(&p, UNIT - 1, &[]), "InvalidAmount");
    // a stranger's token account cannot be used
    let stranger = w.player(10);
    let ix = w.ix("reload", (5 * UNIT).to_le_bytes().to_vec(), vec![
        AccountMeta::new(p.pubkey(), true),
        AccountMeta::new(ledger_pda(&p.pubkey()), false),
        AccountMeta::new(podium_pda(), false),
        AccountMeta::new(rcx_mint(), false),
        AccountMeta::new(ata(&stranger.pubkey()), false),
        AccountMeta::new_readonly(spl_token_2022_interface::id(), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]);
    assert!(w.send(ix, &[&p]).is_err(), "token account must belong to the signer");
}

#[test]
fn seal_requires_fresh_tight_price_credits_and_a_free_chamber() {
    let mut w = World::new();
    let p = w.player(1000);
    w.reload(&p, 1000 * UNIT, &[]).unwrap();
    let c = commit(&p.pubkey(), 1, "YES", 0, SALT);
    // stale price for a 5 minute window (limit 45 s)
    w.pyth(0, 100_00000000, 1_000_000, w.now - 50, w.now - 60);
    assert_err(w.seal(&p, 1, c, 0, 5, 500), "InvalidSealPrice");
    // confidence too wide (3%)
    w.pyth(0, 100_00000000, 300_000_000, w.now - 1, w.now - 2);
    assert_err(w.seal(&p, 1, c, 0, 5, 500), "TooUncertain");
    // unsupported horizon, bad feed index, stake too small
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    assert_err(w.seal(&p, 1, c, 0, 7, 500), "BadHorizon");
    assert_err(w.seal(&p, 1, c, 9, 5, 500), "BadFeed");
    assert_err(w.seal(&p, 1, c, 0, 5, 99), "InvalidStake");
    assert_err(w.seal(&p, 1, c, 0, 5, 1001), "InsufficientCredits");
    // good
    w.seal(&p, 1, c, 0, 5, 500).unwrap();
    let l = w.ledger(&p.pubkey());
    assert_eq!(l.credits, 500);
    assert_eq!(l.open, 1);
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(s.stake, 500);
    assert_eq!(s.xp_base, 22, "base 10 * sqrt(5) rounded");
    assert_eq!(s.entry_e12, 100_000_000_000_000);
    assert_eq!(s.expiry_ts, w.now + 300);
    assert_eq!(s.state, 1);
    // replay of the same nonce cannot create a second shot
    assert!(w.seal(&p, 1, c, 0, 5, 100).is_err());
    // chambers: a new wallet has two
    w.seal(&p, 2, commit(&p.pubkey(), 2, "NO", 0, SALT), 0, 5, 100).unwrap();
    assert_err(w.seal(&p, 3, commit(&p.pubkey(), 3, "NO", 0, SALT), 0, 5, 100), "ChambersFull");
}

#[test]
fn full_life_hit_miss_equality_deadline_and_forfeit() {
    let mut w = World::new();
    let p = w.player(10_000);
    let cranker = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    // nonce 1: YES, will be a HIT
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 7000, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    // Nobody can settle early, and a checkpoint before expiry is not a crossing.
    w.advance(100);
    w.pyth(0, 101_00000000, 1_000_000, w.now, w.now - 1);
    w.checkpoint(&cranker, 0).unwrap();
    assert_err(w.settle(&cranker, &p.pubkey(), 1, 0), "NotExpired");
    // First update after expiry: price 102 (a YES win).
    w.set_clock(expiry + 2);
    w.pyth(0, 102_00000000, 1_000_000, expiry + 1, expiry - 199);
    w.checkpoint(&cranker, 0).unwrap();
    // A later, higher print cannot replace the crossing.
    w.advance(30);
    w.pyth(0, 150_00000000, 1_000_000, w.now, expiry + 1);
    w.checkpoint(&cranker, 0).unwrap();
    // reveal before settle is refused; wrong salt is refused after settle
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 1, 7000, SALT), "WrongState");
    w.settle(&cranker, &p.pubkey(), 1, 0).unwrap();
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(s.state, 2);
    assert_eq!(s.exit_e12, 102_000_000_000_000, "the FIRST crossing, not the later one");
    assert_err(w.settle(&cranker, &p.pubkey(), 1, 0), "WrongState");
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 1, 7000, "ffffffffffffffffffffffffffffffff"), "CommitMismatch");
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 0, 7000, SALT), "CommitMismatch");
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 1, 7000, "ZZZZ"), "BadSalt");
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 1, 50, SALT), "BadProbability");
    // anyone with the salt may reveal (the cranker here), outcome is fixed
    w.reveal(&cranker, &p.pubkey(), 1, 1, 7000, SALT).unwrap();
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!((s.state, s.hit, s.side, s.p_bps), (3, 1, 1, 7000));
    assert_eq!(s.xp_awarded, 23, "22 skill (streak 0) + 1 settle");
    let l = w.ledger(&p.pubkey());
    assert_eq!(l.credits, 10_000 - 500 + 850);
    assert_eq!((l.xp, l.streak, l.hits, l.shots, l.open), (23, 1, 1, 1, 0));
    assert_eq!(l.daily_xp, 23);
    // podium now holds the player
    let pod = w.account_data(&podium_pda()).unwrap();
    assert_eq!(&pod[16..48], p.pubkey().as_ref());
    assert_err(w.reveal(&cranker, &p.pubkey(), 1, 1, 7000, SALT), "WrongState");
    // close returns rent to the player, not the cranker
    let before = w.svm.get_balance(&p.pubkey()).unwrap();
    w.close_shot(&cranker, &p.pubkey(), 1).unwrap();
    assert!(w.svm.get_balance(&p.pubkey()).unwrap() > before);
    assert!(w.shot(&p.pubkey(), 1).is_none());

    // nonce 2: MISS with streak reset. Seal at 102, exit 101.
    w.pyth(0, 102_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 2, commit(&p.pubkey(), 2, "YES", 0, SALT), 0, 5, 1000).unwrap();
    let expiry2 = w.now + 300;
    w.set_clock(expiry2 + 1);
    w.pyth(0, 101_00000000, 1_000_000, expiry2, expiry2 - 100);
    w.checkpoint(&cranker, 0).unwrap();
    w.settle(&cranker, &p.pubkey(), 2, 0).unwrap();
    w.reveal(&p, &p.pubkey(), 2, 1, 0, SALT).unwrap();
    let l = w.ledger(&p.pubkey());
    assert_eq!(l.credits, 10_350 - 1000);
    assert_eq!((l.xp, l.streak, l.hits, l.shots), (24, 0, 1, 2));

    // nonce 3: equality -> VOID with refund, no XP
    w.pyth(0, 101_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 3, commit(&p.pubkey(), 3, "NO", 0, SALT), 0, 5, 300).unwrap();
    let expiry3 = w.now + 300;
    w.set_clock(expiry3 + 1);
    w.pyth(0, 101_00000000, 1_000_000, expiry3, expiry3 - 50);
    w.checkpoint(&cranker, 0).unwrap();
    w.settle(&cranker, &p.pubkey(), 3, 0).unwrap();
    let s = w.shot(&p.pubkey(), 3).unwrap();
    assert_eq!((s.state, s.void_reason), (4, 1));
    let l = w.ledger(&p.pubkey());
    assert_eq!((l.credits, l.xp, l.voids, l.open), (9_350, 24, 1, 0));

    // nonce 4: no checkpoint at all -> deadline VOID
    w.pyth(0, 101_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 4, commit(&p.pubkey(), 4, "NO", 0, SALT), 0, 5, 300).unwrap();
    let expiry4 = w.now + 300;
    w.set_clock(expiry4 + 10);
    assert_err(w.settle(&cranker, &p.pubkey(), 4, 0), "CrossingNotCheckpointed");
    assert_err(w.simple("void_shot", &cranker, &p.pubkey(), 4), "NotVoidable");
    w.set_clock(expiry4 + 119);
    assert_err(w.simple("void_shot", &cranker, &p.pubkey(), 4), "NotVoidable");
    w.set_clock(expiry4 + 120);
    assert_err(w.settle(&cranker, &p.pubkey(), 4, 0), "SettlementDeadlinePassed");
    w.simple("void_shot", &cranker, &p.pubkey(), 4).unwrap();
    let l = w.ledger(&p.pubkey());
    assert_eq!((l.credits, l.voids), (9_350, 2));

    // nonce 5: settled but never revealed -> forfeit as a MISS after an hour
    w.pyth(0, 101_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 5, commit(&p.pubkey(), 5, "NO", 0, SALT), 0, 5, 300).unwrap();
    let expiry5 = w.now + 300;
    w.set_clock(expiry5 + 1);
    w.pyth(0, 90_00000000, 1_000_000, expiry5, expiry5 - 50);
    w.checkpoint(&cranker, 0).unwrap();
    w.settle(&cranker, &p.pubkey(), 5, 0).unwrap();
    assert_err(w.simple("forfeit", &cranker, &p.pubkey(), 5), "NotForfeitableYet");
    w.set_clock(expiry5 + 3600);
    w.simple("forfeit", &cranker, &p.pubkey(), 5).unwrap();
    let l = w.ledger(&p.pubkey());
    assert_eq!((l.credits, l.forfeits, l.shots, l.open), (9_050, 1, 3, 0));
    assert_err(w.reveal(&p, &p.pubkey(), 5, 0, 0, SALT), "WrongState");
}

#[test]
fn source_bracket_blocks_late_selection_and_allows_exact_crossing() {
    let mut w = World::new();
    let p = w.player(2_000);
    let cranker = w.player(1);
    w.reload(&p, 2_000 * UNIT, &[]).unwrap();

    // Seal while the source account is fresh, then record one honest
    // pre-expiry checkpoint.
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 41, commit(&p.pubkey(), 41, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    w.set_clock(expiry - 100);
    w.pyth(0, 99_00000000, 1_000_000, expiry - 100, expiry - 101);
    w.checkpoint(&cranker, 0).unwrap();

    // The source's actual expiry-crossing update was missed. This later
    // update says its own predecessor was also after expiry. The protocol
    // must not replace that signed predecessor with its last local
    // checkpoint and thereby manufacture an expiry bracket.
    w.set_clock(expiry + 30);
    w.pyth(0, 150_00000000, 1_000_000, expiry + 30, expiry + 20);
    w.checkpoint(&cranker, 0).unwrap();
    assert_err(w.settle(&cranker, &p.pubkey(), 41, 0), "CrossingNotCheckpointed");

    // A reordered older account image is a no-op and cannot backfill history
    // after a newer source update has already been accepted.
    w.pyth(0, 101_00000000, 1_000_000, expiry + 1, expiry - 1);
    w.checkpoint(&cranker, 0).unwrap();
    assert_err(w.settle(&cranker, &p.pubkey(), 41, 0), "CrossingNotCheckpointed");
    w.set_clock(expiry + 120);
    w.simple("void_shot", &cranker, &p.pubkey(), 41).unwrap();
    assert_eq!(w.ledger(&p.pubkey()).credits, 2_000, "missing source coverage refunds exactly");

    // A fresh shot with an update whose Pyth-signed predecessor really
    // brackets expiry still settles normally.
    w.pyth(1, 200_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 42, commit(&p.pubkey(), 42, "YES", 0, SALT), 1, 5, 500).unwrap();
    let expiry2 = w.now + 300;
    w.set_clock(expiry2 + 1);
    w.pyth(1, 201_00000000, 1_000_000, expiry2, expiry2 - 10);
    w.checkpoint(&cranker, 1).unwrap();
    w.settle(&cranker, &p.pubkey(), 42, 1).unwrap();
    assert_eq!(w.shot(&p.pubkey(), 42).unwrap().exit_e12, 201_000_000_000_000);
}

#[test]
fn delegate_grant_is_bounded_and_revocable() {
    let mut w = World::new();
    let p = w.player(1000);
    let d = w.player(1);
    let mallory = w.player(1);
    w.reload(&p, 1000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    // no grant -> nothing
    assert!(w.seal_delegated(&d, &p.pubkey(), 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 100).is_err());
    assert_err(w.grant(&p, &d.pubkey(), 500, 600, w.now + 3600), "BadGrant");
    assert_err(w.grant(&p, &d.pubkey(), 500, 100, w.now + 40 * 86400), "BadGrant");
    w.grant(&p, &d.pubkey(), 500, 300, w.now + 3600).unwrap();
    assert_err(w.seal_delegated(&d, &p.pubkey(), 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 400), "StakeExceedsGrant");
    // another key cannot use the grant
    assert!(w.seal_delegated(&mallory, &p.pubkey(), 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 100).is_err());
    w.seal_delegated(&d, &p.pubkey(), 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 300).unwrap();
    assert_eq!(w.ledger(&p.pubkey()).credits, 700);
    assert_err(w.seal_delegated(&d, &p.pubkey(), 2, commit(&p.pubkey(), 2, "YES", 0, SALT), 0, 5, 300), "AllowanceExhausted");
    w.seal_delegated(&d, &p.pubkey(), 2, commit(&p.pubkey(), 2, "YES", 0, SALT), 0, 5, 200).unwrap();
    assert_err(w.seal_delegated(&d, &p.pubkey(), 3, commit(&p.pubkey(), 3, "YES", 0, SALT), 0, 5, 100), "AllowanceExhausted");
    // re-grant refreshes bounds; expiry is enforced; revoke closes it
    w.grant(&p, &d.pubkey(), 1000, 300, w.now + 60).unwrap();
    w.advance(61);
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    assert_err(w.seal_delegated(&d, &p.pubkey(), 3, commit(&p.pubkey(), 3, "YES", 0, SALT), 0, 5, 100), "GrantExpired");
    assert!(w.revoke(&mallory, &d.pubkey()).is_err());
    w.revoke(&p, &d.pubkey()).unwrap();
    assert!(w.account_data(&grant_pda(&p.pubkey(), &d.pubkey())).is_none());
    assert!(w.seal_delegated(&d, &p.pubkey(), 3, commit(&p.pubkey(), 3, "YES", 0, SALT), 0, 5, 100).is_err());
    // the delegate can never reload for the player
    assert!(w.reload(&d, UNIT, &[]).is_ok(), "delegate reloads only its own tokens");
    assert_eq!(w.ledger(&p.pubkey()).credits, 500);
}

#[test]
fn reload_pays_the_live_podium_and_burns_the_rest() {
    let mut w = World::new();
    let champ = w.player(1000);
    let cranker = w.player(1);
    w.reload(&champ, 1000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.checkpoint(&cranker, 0).unwrap(); // warm the clock: the first observation never forms a crossing
    w.seal(&champ, 1, commit(&champ.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    w.set_clock(expiry + 1);
    w.pyth(0, 105_00000000, 1_000_000, expiry, expiry - 100);
    w.checkpoint(&cranker, 0).unwrap();
    w.settle(&cranker, &champ.pubkey(), 1, 0).unwrap();
    w.reveal(&champ, &champ.pubkey(), 1, 1, 0, SALT).unwrap();
    // A second player reloads 1000 RCX: 30% * 50% = 150 to the #1 seat (only seat), rest burns.
    let payer = w.player(1000);
    let supply = w.supply();
    let champ_before = w.balance(&champ.pubkey());
    w.reload(&payer, 1000 * UNIT, &[champ.pubkey()]).unwrap();
    assert_eq!(w.balance(&champ.pubkey()) - champ_before, 150 * UNIT);
    assert_eq!(w.supply(), supply - 850 * UNIT);
    assert_eq!(w.ledger(&payer.pubkey()).credits, 1000);
    // Forgetting the seat account burns the seat's share instead of failing.
    let payer2 = w.player(100);
    let supply2 = w.supply();
    w.reload(&payer2, 100 * UNIT, &[]).unwrap();
    assert_eq!(w.supply(), supply2 - 100 * UNIT);
    // Two days later the podium is stale: everything burns again.
    w.advance(2 * 86400 + 10);
    let payer3 = w.player(100);
    let supply3 = w.supply();
    let champ_mid = w.balance(&champ.pubkey());
    w.reload(&payer3, 100 * UNIT, &[champ.pubkey()]).unwrap();
    assert_eq!(w.supply(), supply3 - 100 * UNIT);
    assert_eq!(w.balance(&champ.pubkey()), champ_mid);
}

#[test]
fn legacy_claim_is_closed_until_a_root_is_compiled_in() {
    let mut w = World::new();
    let p = w.player(1);
    assert_err(w.claim(&p, 1_000_000, 0), "NoMigration");
    assert!(w.account_data(&ledger_pda(&p.pubkey())).is_none(), "a refused claim leaves nothing behind");
}

#[test]
fn oracle_account_forgeries_are_rejected() {
    let mut w = World::new();
    let p = w.player(1000);
    w.reload(&p, 1000 * UNIT, &[]).unwrap();
    let c = commit(&p.pubkey(), 1, "YES", 0, SALT);
    // 1. correct data at the correct address but owned by a stranger program
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    let addr = price_account(&feed(0));
    let mut acc = w.svm.get_account(&addr).unwrap();
    acc.owner = spl_token::id();
    w.svm.set_account(addr, acc.clone()).unwrap();
    assert_err(w.seal(&p, 1, c, 0, 5, 500), "BadPriceAccount");
    // 2. right owner, only partially verified
    acc.owner = pyth_receiver();
    acc.data[40] = 0; // VerificationLevel::Partial
    acc.data.insert(41, 1); // num_signatures
    w.svm.set_account(addr, acc.clone()).unwrap();
    assert_err(w.seal(&p, 1, c, 0, 5, 500), "PartialVerification");
    // 3. a feed id that does not match the account the index derives
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    let mut acc = w.svm.get_account(&addr).unwrap();
    acc.data[41..73].copy_from_slice(&feed(1));
    w.svm.set_account(addr, acc).unwrap();
    assert_err(w.seal(&p, 1, c, 0, 5, 500), "InvalidSealPrice");
    // 4. the BTC account offered for a SOL seal (wrong derivation)
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.pyth(1, 60_000_00000000, 1_000_000, w.now - 1, w.now - 2);
    let mut args = 1u64.to_le_bytes().to_vec();
    args.extend_from_slice(&c);
    args.push(0);
    args.extend_from_slice(&5u16.to_le_bytes());
    args.extend_from_slice(&500u64.to_le_bytes());
    let ix = w.ix("seal", args, vec![
        AccountMeta::new(shot_pda(&p.pubkey(), 1), false),
        AccountMeta::new(ledger_pda(&p.pubkey()), false),
        AccountMeta::new(p.pubkey(), true),
        AccountMeta::new_readonly(price_account(&feed(1)), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]);
    assert_err(w.send(ix, &[&p]), "BadPriceAccount");
    // 5. a good account finally seals
    w.seal(&p, 1, c, 0, 5, 500).unwrap();
    // 6. checkpoint refuses an update that is not the first of its publish time
    w.pyth(0, 100_00000000, 1_000_000, w.now, w.now);
    assert_err(w.checkpoint(&p, 0), "NotFirstUpdate");
}

#[test]
fn ring_wrap_and_wrong_clock() {
    let mut w = World::new();
    let p = w.player(1000);
    let cranker = w.player(1);
    w.reload(&p, 1000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.checkpoint(&cranker, 0).unwrap();
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    w.set_clock(expiry + 1);
    w.pyth(0, 105_00000000, 1_000_000, expiry, expiry - 100);
    w.checkpoint(&cranker, 0).unwrap();
    // the crossing survives 63 more observations...
    for i in 1..=63 {
        w.pyth(0, 105_00000000, 1_000_000, expiry + i, expiry + i - 1);
        w.checkpoint(&cranker, 0).unwrap();
    }
    // settle with the BTC clock for a SOL shot: seeds mismatch
    let ix = w.ix("settle", vec![], vec![
        AccountMeta::new(shot_pda(&p.pubkey(), 1), false),
        AccountMeta::new(ledger_pda(&p.pubkey()), false),
        AccountMeta::new_readonly(clock_pda(1), false),
        AccountMeta::new_readonly(cranker.pubkey(), true),
    ]);
    assert!(w.send(ix, &[&cranker]).is_err());
    // ...and one more evicts it: this is the documented ring vector, void by rule.
    w.pyth(0, 105_00000000, 1_000_000, expiry + 64, expiry + 63);
    w.checkpoint(&cranker, 0).unwrap();
    w.set_clock(expiry + 70);
    assert_err(w.settle(&cranker, &p.pubkey(), 1, 0), "CrossingNotCheckpointed");
    w.set_clock(expiry + 120);
    w.simple("void_shot", &cranker, &p.pubkey(), 1).unwrap();
    assert_eq!(w.ledger(&p.pubkey()).credits, 1000);
}

// ============================================================================
// Ruleset 2: binding the crossing
// ============================================================================

/// THE test this instruction exists for.
///
/// The feed clock is a 64-slot ring. Before ruleset 2 the outcome of a shot was
/// read out of that ring at settle time, which meant the answer depended on how
/// busy the feed happened to be between expiry and whenever a cranker got
/// around to it -- and on nothing stopping a well-funded party from *making* it
/// busy. `bind_crossing` copies the crossing print into the shot; after that
/// the ring is scenery.
///
/// Two shots, same feed, same expiry, same crossing. One is bound the moment it
/// expires. Then the ring is flooded past capacity, evicting that crossing
/// entirely. The bound shot settles on the print it was bound to; the unbound
/// one, on identical facts, cannot settle at all -- which is what proves the
/// flood really did destroy the evidence.
#[test]
fn a_bound_crossing_survives_a_ring_flooded_past_capacity() {
    let mut w = World::new();
    let p = w.player(10_000);
    let attacker = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();

    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    w.seal(&p, 2, commit(&p.pubkey(), 2, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;

    // The crossing: the first print at or after expiry. A YES win at 102.
    w.set_clock(expiry + 1);
    w.pyth(0, 102_00000000, 1_234_567, expiry, expiry - 30);
    w.checkpoint(&attacker, 0).unwrap();

    // Shot 1 binds immediately. Shot 2 does not.
    w.bind_crossing(&attacker, &p.pubkey(), 1, 0).unwrap();
    let bound = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(bound.crossing_bound, 1);
    assert_eq!(bound.exit_e12, 102_000_000_000_000);
    assert_eq!(bound.exit_publish_time, expiry);
    assert_eq!(bound.exit_prev_publish_time, expiry - 30, "the predecessor Pyth signed");
    assert_eq!(bound.exit_conf_e12, 12_345_670_000, "conf 1_234_567 at exponent -8, in e12");
    assert_eq!(bound.state, 1, "binding does not settle");
    assert_eq!(w.shot(&p.pubkey(), 2).unwrap().crossing_bound, 0);

    // Now bury it: 70 fresh prints at a price that would flip both shots.
    let last = w.flood_ring(&attacker, 0, 70, 96_00000000, expiry + 2);
    w.set_clock(last + 1);
    assert!(last + 1 < expiry + 120, "the flood must fit inside the settle window");

    // The bound shot settles on the print it was bound to. Not 96.
    w.settle(&attacker, &p.pubkey(), 1, 0).unwrap();
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(s.exit_e12, 102_000_000_000_000, "a bound crossing is not for sale");
    assert_eq!(s.exit_publish_time, expiry);
    assert_eq!(s.state, 2, "settled, not voided");
    w.reveal(&p, &p.pubkey(), 1, 1, 0, SALT).unwrap();
    assert_eq!(w.shot(&p.pubkey(), 1).unwrap().hit, 1, "YES from 100 to 102 is a hit");

    // The identical unbound shot: the flood ate its evidence, so it cannot
    // settle at all. This is the counterfactual that makes the test mean
    // something -- without it, the first half proves nothing.
    assert_err(w.settle(&attacker, &p.pubkey(), 2, 0), "CrossingNotCheckpointed");
    w.set_clock(expiry + 120);
    w.simple("void_shot", &attacker, &p.pubkey(), 2).unwrap();
    let s2 = w.shot(&p.pubkey(), 2).unwrap();
    assert_eq!((s2.state, s2.void_reason), (4, 2), "voided on the deadline, refunded");
}

/// A bound shot is not on the clock any more. The settle deadline was a
/// deadline for CAPTURING the print; once captured, a slow cranker must not be
/// able to turn a real answer into a refund -- and neither must anyone who
/// would rather the answer went away.
#[test]
fn a_bound_shot_settles_late_and_cannot_be_voided_out_from_under_it() {
    let mut w = World::new();
    let p = w.player(10_000);
    let cranker = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 1, commit(&p.pubkey(), 1, "NO", 0, SALT), 0, 5, 700).unwrap();
    let expiry = w.now + 300;

    w.set_clock(expiry + 1);
    w.pyth(0, 98_00000000, 1_000_000, expiry, expiry - 10);
    w.checkpoint(&cranker, 0).unwrap();
    w.bind_crossing(&cranker, &p.pubkey(), 1, 0).unwrap();

    // Long past the settle deadline, and past the reveal deadline too.
    w.set_clock(expiry + 121);
    assert_err(w.simple("void_shot", &cranker, &p.pubkey(), 1), "NotVoidable");
    w.set_clock(expiry + 4000);
    w.settle(&cranker, &p.pubkey(), 1, 0).unwrap();
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!((s.state, s.exit_e12), (2, 98_000_000_000_000));
    w.reveal(&p, &p.pubkey(), 1, 0, 0, SALT).unwrap();
    assert_eq!(w.shot(&p.pubkey(), 1).unwrap().hit, 1, "NO from 100 to 98 is a hit");
}

/// Permissionless and idempotent: anyone may bind, nobody may bind twice into a
/// different answer, and binding before there is anything to bind fails cleanly
/// without touching the shot.
#[test]
fn binding_is_permissionless_idempotent_and_refuses_the_same_things_settle_does() {
    let mut w = World::new();
    let p = w.player(10_000);
    let stranger = w.player(1);
    let other = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;

    // Before expiry there is nothing to bind.
    assert_err(w.bind_crossing(&stranger, &p.pubkey(), 1, 0), "NotExpired");
    // After expiry with an empty clock: refused, and the shot is untouched.
    w.set_clock(expiry + 1);
    assert_err(w.bind_crossing(&stranger, &p.pubkey(), 1, 0), "CrossingNotCheckpointed");
    assert_eq!(w.shot(&p.pubkey(), 1).unwrap().crossing_bound, 0);

    w.pyth(0, 105_00000000, 1_000_000, expiry, expiry - 5);
    w.checkpoint(&stranger, 0).unwrap();
    // A stranger with no stake in the shot binds it. That is the point.
    w.bind_crossing(&stranger, &p.pubkey(), 1, 0).unwrap();
    let first = w.shot(&p.pubkey(), 1).unwrap();

    // A second binder cannot move it, even with a newer print in the ring.
    w.advance(5);
    w.pyth(0, 90_00000000, 1_000_000, w.now, w.now - 1);
    w.checkpoint(&other, 0).unwrap();
    w.bind_crossing(&other, &p.pubkey(), 1, 0).unwrap();
    let second = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(second.exit_e12, first.exit_e12, "rebinding is a no-op, not a re-roll");
    assert_eq!(second.exit_publish_time, first.exit_publish_time);
    assert_eq!(second.exit_conf_e12, first.exit_conf_e12);

    // Past the deadline nothing new binds: that shot voids, exactly as before.
    w.seal(&p, 2, commit(&p.pubkey(), 2, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry2 = w.now + 300;
    w.set_clock(expiry2 + 121);
    w.pyth(0, 105_00000000, 1_000_000, expiry2 + 1, expiry2 - 1);
    w.checkpoint(&stranger, 0).unwrap();
    assert_err(w.bind_crossing(&stranger, &p.pubkey(), 2, 0), "SettlementDeadlinePassed");
    w.simple("void_shot", &stranger, &p.pubkey(), 2).unwrap();

    // And a shot that is already finished is not bindable.
    w.settle(&stranger, &p.pubkey(), 1, 0).unwrap();
    assert_err(w.bind_crossing(&stranger, &p.pubkey(), 1, 0), "WrongState");
}

/// Every settled shot carries the numbers its own settlement used -- including
/// the confidence, which ruleset 1 checked and then threw away. Without this a
/// settlement could not be re-derived after the ring wrapped, by anyone, ever.
#[test]
fn a_settled_shot_carries_the_confidence_it_settled_on() {
    let mut w = World::new();
    let p = w.player(10_000);
    let cranker = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    w.set_clock(expiry + 1);
    // conf 999_999 at exponent -8 -> 9_999_990_000 in e12.
    w.pyth(0, 103_00000000, 999_999, expiry, expiry - 44);
    w.checkpoint(&cranker, 0).unwrap();
    let posted = ((expiry as u64) * 2) as u64; // World::pyth's posted_slot rule
    w.settle(&cranker, &p.pubkey(), 1, 0).unwrap();

    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(s.exit_e12, 103_000_000_000_000);
    assert_eq!(s.exit_conf_e12, 9_999_990_000);
    assert_eq!(s.exit_publish_time, expiry);
    assert_eq!(s.exit_prev_publish_time, expiry - 44);
    assert_eq!(s.exit_posted_slot, posted);
    assert_eq!(s.crossing_bound, 1, "settle binds what it uses, even unasked");
    // Sold under ruleset 2 with the band that shipped: a mechanism, no width.
    assert_eq!((s.ruleset, s.band_k_bps), (2, 0));
    // With k = 0 the band is empty, so a real move still decides normally.
    assert_eq!(s.state, 2);
}

/// The band ships at zero, so nothing may void for being "too close" -- not at
/// one unit of difference, not at a difference far inside the confidence.
/// If this test ever fails, somebody set `k` without saying so.
#[test]
fn the_decision_band_is_inert_until_someone_chooses_a_k() {
    let mut w = World::new();
    let p = w.player(10_000);
    let cranker = w.player(1);
    w.reload(&p, 10_000 * UNIT, &[]).unwrap();
    // Entry 100.00000000, exit one e-8 unit above it: 10_000 in e12 terms.
    w.pyth(0, 100_00000000, 1_000_000, w.now - 1, w.now - 2);
    w.seal(&p, 1, commit(&p.pubkey(), 1, "YES", 0, SALT), 0, 5, 500).unwrap();
    let expiry = w.now + 300;
    w.set_clock(expiry + 1);
    w.pyth(0, 100_00000001, 1_000_000, expiry, expiry - 3);
    w.checkpoint(&cranker, 0).unwrap();
    w.settle(&cranker, &p.pubkey(), 1, 0).unwrap();
    let s = w.shot(&p.pubkey(), 1).unwrap();
    assert_eq!(s.band_k_bps, 0);
    assert!(
        (s.exit_e12 - s.entry_e12).unsigned_abs() < s.exit_conf_e12.unsigned_abs(),
        "the move is well inside the print's own confidence -- exactly the case a band would void"
    );
    assert_eq!((s.state, s.void_reason), (2, 0), "with k = 0 it settles anyway, and YES wins");
    w.reveal(&p, &p.pubkey(), 1, 1, 0, SALT).unwrap();
    assert_eq!(w.shot(&p.pubkey(), 1).unwrap().hit, 1);
}
