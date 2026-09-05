#[test]
fn register_fails_with_trailing_bytes() {
    let mut fixture = Fixture::new(REGISTERED_SLOT);
    fixture.deploy_sbf(sbf_path());

    let args = SpecArgs::new();
    let accounts = fixture.generation_accounts(REGISTERED_SLOT, RECEIVER_GENERATION_SLOT, WORMHOLE_GENERATION_SLOT);
    
    let mut ix = fixture.register_ix(&args, accounts.clone());
    ix.data.push(0x00); // Trailing byte

    let err = fixture.send_as(ix, &fixture.actor.insecure_clone()).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound"));
}

#[test]
fn open_fails_with_invalid_discriminator() {
    let mut fixture = Fixture::new(REGISTERED_SLOT);
    fixture.deploy_sbf(sbf_path());

    let args = SpecArgs::new();
    let accounts = fixture.generation_accounts(REGISTERED_SLOT, RECEIVER_GENERATION_SLOT, WORMHOLE_GENERATION_SLOT);
    let ix = fixture.register_ix(&args, accounts.clone());
    fixture.send_as(ix, &fixture.actor.insecure_clone()).unwrap();

    let mut ix_open = fixture.open_ix(fixture.actor.pubkey(), args.spec_hash());
    ix_open.data[0] ^= 0xFF; // Corrupt discriminator

    let err = fixture.send_as(ix_open, &fixture.actor.insecure_clone()).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn capture_first_fails_with_truncated_data() {
    let mut fixture = Fixture::new(REGISTERED_SLOT);
    fixture.deploy_sbf(sbf_path());

    let args = SpecArgs::new();
    let accounts = fixture.generation_accounts(REGISTERED_SLOT, RECEIVER_GENERATION_SLOT, WORMHOLE_GENERATION_SLOT);
    fixture.send_as(fixture.register_ix(&args, accounts.clone()), &fixture.actor.insecure_clone()).unwrap();
    fixture.send_as(fixture.open_ix(fixture.actor.pubkey(), args.spec_hash()), &fixture.actor.insecure_clone()).unwrap();

    let mut ix_capture = fixture.capture_first_ix(args.spec_hash(), LIVE_SOL_FEED, accounts);
    ix_capture.data.pop(); // Truncate

    let err = fixture.send_as(ix_capture, &fixture.actor.insecure_clone()).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}
