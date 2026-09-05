#[test]
fn register_fails_with_invalid_pda() {
    let mut fixture = Fixture::new(REGISTERED_SLOT);
    fixture.deploy_sbf(sbf_path());

    let args = SpecArgs::new();
    let accounts = fixture.generation_accounts(REGISTERED_SLOT, RECEIVER_GENERATION_SLOT, WORMHOLE_GENERATION_SLOT);
    
    let mut ix = fixture.register_ix(&args, accounts.clone());
    
    // Change spec account PDA to something else
    ix.accounts[1].pubkey = Pubkey::new_unique();

    let err = fixture.send_as(ix, &fixture.actor.insecure_clone()).unwrap_err();
    assert!(err.contains("ConstraintSeeds") || err.contains("CrossProgramInvocation"));
}

#[test]
fn open_fails_with_invalid_need_pda() {
    let mut fixture = Fixture::new(REGISTERED_SLOT);
    fixture.deploy_sbf(sbf_path());

    let args = SpecArgs::new();
    let accounts = fixture.generation_accounts(REGISTERED_SLOT, RECEIVER_GENERATION_SLOT, WORMHOLE_GENERATION_SLOT);
    let ix = fixture.register_ix(&args, accounts.clone());
    fixture.send_as(ix, &fixture.actor.insecure_clone()).unwrap();

    let mut ix_open = fixture.open_ix(fixture.actor.pubkey(), args.spec_hash());
    
    // Modify Need PDA
    ix_open.accounts[2].pubkey = Pubkey::new_unique();

    let err = fixture.send_as(ix_open, &fixture.actor.insecure_clone()).unwrap_err();
    assert!(err.contains("ConstraintSeeds") || err.contains("CrossProgramInvocation"));
}
