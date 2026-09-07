use anchor_lang::{prelude::Pubkey, InstructionData};
use ratchet_work_market::{instruction, ID, SCHEMA_VERSION};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() {
    let completion_program = Pubkey::new_from_array([3; 32]);
    let subject = Pubkey::new_from_array([4; 32]);
    let sponsor = Pubkey::new_from_array([5; 32]);
    let nonce = 42_u64;
    let work_kind = 7_u8;
    let amount = 25_000_000_u64;
    let (voucher, voucher_bump) = Pubkey::find_program_address(
        &[
            b"voucher",
            &SCHEMA_VERSION.to_le_bytes(),
            completion_program.as_ref(),
            subject.as_ref(),
            &[work_kind],
            sponsor.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &ID,
    );
    let (vault, vault_bump) = Pubkey::find_program_address(&[b"vault", voucher.as_ref()], &ID);
    let (receipt, receipt_bump) = Pubkey::find_program_address(
        &[b"completion", subject.as_ref(), &[work_kind]],
        &completion_program,
    );

    println!(
        concat!(
            "{{\"programId\":\"{}\",\"completionProgram\":\"{}\",",
            "\"subject\":\"{}\",\"sponsor\":\"{}\",\"nonce\":\"{}\",",
            "\"workKind\":{},\"amount\":\"{}\",\"voucher\":\"{}\",",
            "\"voucherBump\":{},\"vault\":\"{}\",\"vaultBump\":{},",
            "\"receipt\":\"{}\",\"receiptBump\":{},\"fundDataHex\":\"{}\",",
            "\"claimDataHex\":\"{}\",\"refundDataHex\":\"{}\",\"closeDataHex\":\"{}\"}}"
        ),
        ID,
        completion_program,
        subject,
        sponsor,
        nonce,
        work_kind,
        amount,
        voucher,
        voucher_bump,
        vault,
        vault_bump,
        receipt,
        receipt_bump,
        hex(&instruction::FundRcxVoucher {
            nonce,
            work_kind,
            amount,
        }
        .data()),
        hex(&instruction::ClaimRcxVoucher {}.data()),
        hex(&instruction::RefundRcxVoucher {}.data()),
        hex(&instruction::CloseVoucher {}.data()),
    );
}
