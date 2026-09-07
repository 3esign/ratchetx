use anchor_lang::{prelude::Pubkey, InstructionData};
use pyth_solana_receiver_sdk::PYTH_PUSH_ORACLE_ID;
use ratchet_next_print_v2::{completion_receipt_address, instruction, FEEDS, ID, SHARD_ID};
use solana_sha256_hasher::hashv;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() {
    let player = Pubkey::new_from_array([5; 32]);
    let nonce = 42_u64;
    let side = 1_u8;
    let p_bps = 6_000_u16;
    let salt = [7_u8; 32];
    let feed_index = 1_u8;
    let commit = hashv(&[
        b"RATCHET_NEXT_PRINT_COMMIT_V2",
        player.as_ref(),
        &nonce.to_le_bytes(),
        &[side],
        &p_bps.to_le_bytes(),
        &salt,
    ])
    .to_bytes();
    let (shot, shot_bump) =
        Pubkey::find_program_address(&[b"shot", player.as_ref(), &nonce.to_le_bytes()], &ID);
    let (receipt, receipt_bump) = completion_receipt_address(&shot);
    let price_update = Pubkey::find_program_address(
        &[&SHARD_ID.to_le_bytes(), &FEEDS[usize::from(feed_index)]],
        &PYTH_PUSH_ORACLE_ID,
    )
    .0;

    println!(
        concat!(
            "{{\"programId\":\"{}\",\"player\":\"{}\",\"nonce\":\"{}\",",
            "\"side\":{},\"pBps\":{},\"saltHex\":\"{}\",\"feedIndex\":{},",
            "\"commitHex\":\"{}\",\"shot\":\"{}\",\"shotBump\":{},",
            "\"receipt\":\"{}\",\"receiptBump\":{},\"priceUpdate\":\"{}\",",
            "\"openDataHex\":\"{}\",\"observeDataHex\":\"{}\",",
            "\"timeoutDataHex\":\"{}\",\"revealDataHex\":\"{}\",",
            "\"forfeitDataHex\":\"{}\",\"writeReceiptDataHex\":\"{}\",",
            "\"closeDataHex\":\"{}\"}}"
        ),
        ID,
        player,
        nonce,
        side,
        p_bps,
        hex(&salt),
        feed_index,
        hex(&commit),
        shot,
        shot_bump,
        receipt,
        receipt_bump,
        price_update,
        hex(&instruction::OpenShot {
            nonce,
            commit,
            feed_index,
        }
        .data()),
        hex(&instruction::Observe {}.data()),
        hex(&instruction::Timeout {}.data()),
        hex(&instruction::Reveal { side, p_bps, salt }.data()),
        hex(&instruction::Forfeit {}.data()),
        hex(&instruction::WriteCompletionReceipt {}.data()),
        hex(&instruction::CloseShot {}.data()),
    );
}
