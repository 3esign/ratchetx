use anchor_lang::{prelude::Pubkey, InstructionData};
use pyth_solana_receiver_sdk::PYTH_PUSH_ORACLE_ID;
use ratchet_next_print::{instruction, FEEDS, ID};
use solana_sha256_hasher::hashv;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let player = Pubkey::new_from_array([7; 32]);
    let nonce = 42_u64;
    let side = 1_u8;
    let p_bps = 6_500_u16;
    let salt = [5_u8; 32];
    let commit = hashv(&[
        b"RATCHET_NEXT_PRINT_COMMIT_V1",
        player.as_ref(),
        &nonce.to_le_bytes(),
        &[side],
        &p_bps.to_le_bytes(),
        &salt,
    ])
    .to_bytes();
    let (shot, bump) =
        Pubkey::find_program_address(&[b"shot", player.as_ref(), &nonce.to_le_bytes()], &ID);
    let feed_index = 1_u8;
    let (price_update, _) = Pubkey::find_program_address(
        &[&0_u16.to_le_bytes(), &FEEDS[usize::from(feed_index)]],
        &PYTH_PUSH_ORACLE_ID,
    );
    let open = instruction::OpenShot {
        nonce,
        commit,
        feed_index,
    }
    .data();
    let observe = instruction::Observe {}.data();
    let timeout = instruction::Timeout {}.data();
    let reveal = instruction::Reveal { side, p_bps, salt }.data();
    let forfeit = instruction::Forfeit {}.data();
    let close_shot = instruction::CloseShot {}.data();

    println!(
        concat!(
            "{{\"programId\":\"{}\",\"player\":\"{}\",\"nonce\":\"{}\",",
            "\"side\":{},\"pBps\":{},\"saltHex\":\"{}\",\"commitHex\":\"{}\",",
            "\"shotPda\":\"{}\",\"shotBump\":{},\"feedIndex\":{},",
            "\"priceUpdate\":\"{}\",\"openDataHex\":\"{}\",",
            "\"observeDataHex\":\"{}\",\"timeoutDataHex\":\"{}\",",
            "\"revealDataHex\":\"{}\",\"forfeitDataHex\":\"{}\",",
            "\"closeShotDataHex\":\"{}\"}}"
        ),
        ID,
        player,
        nonce,
        side,
        p_bps,
        hex(&salt),
        hex(&commit),
        shot,
        bump,
        feed_index,
        price_update,
        hex(&open),
        hex(&observe),
        hex(&timeout),
        hex(&reveal),
        hex(&forfeit),
        hex(&close_shot),
    );
}
