use anchor_lang::{prelude::Pubkey, AnchorSerialize};
use ratchet_work_market_v2::{
    account_discriminator, settlement_memo, settlement_memo_payload, work_manifest_address,
    CompletionReceipt, Voucher, WorkManifest, WorkRecord, COMPLETION_SCHEMA_VERSION,
    LOCATOR_MODE_PACKED_WORK_PAGE, MANIFEST_SCHEMA_VERSION, MAX_WORK_PAGE_RECORDS, RECEIPT_PAYABLE,
    RECEIPT_PENDING, SCHEMA_VERSION, WORK_RECORD_LEN,
};

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

fn main() {
    let completion_program = Pubkey::new_from_array([7; 32]);
    let subject = Pubkey::new_from_array([3; 32]);
    let sponsor = Pubkey::new_from_array([5; 32]);
    let worker = Pubkey::new_from_array([4; 32]);
    let work_kind = 4u8;
    let nonce = 9u64;
    let (manifest_pda, manifest_bump) = work_manifest_address(&completion_program, work_kind);
    let manifest = WorkManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        bump: manifest_bump,
        work_kind,
        completion_schema_version: COMPLETION_SCHEMA_VERSION,
        locator_mode: LOCATOR_MODE_PACKED_WORK_PAGE,
        subject_schema_version: 2,
        subject_account_size: 780,
        subject_discriminator: account_discriminator(b"Shot"),
        locator_schema_version: 2,
        locator_discriminator: account_discriminator(b"WorkPage"),
        records_offset: 87,
        entry_len: WORK_RECORD_LEN as u16,
        locator_capacity: MAX_WORK_PAGE_RECORDS,
    };
    let mut manifest_bytes = Vec::new();
    manifest.serialize(&mut manifest_bytes).unwrap();

    let pending = WorkRecord {
        subject,
        work_kind,
        disposition: RECEIPT_PENDING,
        worker: Pubkey::default(),
        result_hash: [0; 32],
        completed_slot: 0,
    };
    let payable = WorkRecord {
        disposition: 1,
        worker,
        result_hash: [6; 32],
        completed_slot: 7,
        ..pending
    };
    let mut pending_bytes = Vec::new();
    pending.serialize(&mut pending_bytes).unwrap();
    let mut payable_bytes = Vec::new();
    payable.serialize(&mut payable_bytes).unwrap();

    let (receipt_pda, receipt_bump) = Pubkey::find_program_address(
        &[b"completion", subject.as_ref(), &[work_kind]],
        &completion_program,
    );
    let direct = CompletionReceipt {
        schema_version: COMPLETION_SCHEMA_VERSION,
        bump: receipt_bump,
        disposition: RECEIPT_PENDING,
        work_kind,
        subject,
        worker: Pubkey::default(),
        result_hash: [0; 32],
        completed_slot: 0,
        completed_ts: 0,
    };
    let mut direct_bytes = account_discriminator(b"CompletionReceipt").to_vec();
    direct.serialize(&mut direct_bytes).unwrap();

    let (voucher_pda, voucher_bump) = Pubkey::find_program_address(
        &[
            b"voucher",
            &SCHEMA_VERSION.to_le_bytes(),
            completion_program.as_ref(),
            subject.as_ref(),
            &[work_kind],
            sponsor.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &ratchet_work_market_v2::ID,
    );
    let completion_locator = Pubkey::new_from_array([9; 32]);
    let destination_token = Pubkey::new_from_array([8; 32]);
    let voucher = Voucher {
        schema_version: SCHEMA_VERSION,
        bump: voucher_bump,
        state: 0,
        work_kind,
        completion_program,
        subject,
        completion_locator,
        locator_slot: 2,
        sponsor,
        nonce,
        funded_amount: 1_000_000,
        settled_amount: 0,
        funded_slot: 11,
        funded_ts: 12,
        beneficiary: Pubkey::default(),
        result_hash: [0; 32],
    };
    let settlement_memo = settlement_memo(
        &voucher,
        &destination_token,
        RECEIPT_PAYABLE,
        &worker,
        &[6; 32],
        1_000_000,
    );
    let settlement_payload =
        String::from_utf8(settlement_memo_payload(&settlement_memo).to_vec()).unwrap();

    println!(
        r#"{{
  "fixture": "ratchet-work-market-v2-abi-1",
  "work_market_program": "{}",
  "completion_program": "{}",
  "subject": "{}",
  "sponsor": "{}",
  "work_kind": {},
  "nonce": {},
  "work_manifest": {{
    "pda": "{}",
    "bump": {},
    "payload_hex": "{}"
  }},
  "voucher": {{
    "pda": "{}",
    "bump": {}
  }},
  "packed_work_record_pending_hex": "{}",
  "packed_work_record_payable_hex": "{}",
  "direct_completion_receipt": {{
    "pda": "{}",
    "bump": {},
    "account_hex": "{}"
  }},
  "settlement_memo": {{
    "destination_token": "{}",
    "completion_locator": "{}",
    "locator_slot": 2,
    "amount": 1000000,
    "hash_hex": "{}",
    "payload_encoding": "lowercase-hex-utf8",
    "payload_utf8": "{}"
  }}
}}"#,
        ratchet_work_market_v2::ID,
        completion_program,
        subject,
        sponsor,
        work_kind,
        nonce,
        manifest_pda,
        manifest_bump,
        hex(&manifest_bytes),
        voucher_pda,
        voucher_bump,
        hex(&pending_bytes),
        hex(&payable_bytes),
        receipt_pda,
        receipt_bump,
        hex(&direct_bytes),
        destination_token,
        completion_locator,
        hex(&settlement_memo),
        settlement_payload,
    );
}
