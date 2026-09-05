#[test]
fn register_fails_with_trailing_bytes() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    
    let mut ix = world.register_ix(&args, accounts.clone());
    ix.data.push(0x00); // Trailing byte

    let actor = Keypair::from_bytes(&world.actor.to_bytes()).unwrap();
    let err = world.send_as(ix, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn open_fails_with_invalid_discriminator() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    let ix = world.register_ix(&args, accounts.clone());
    
    let actor = Keypair::from_bytes(&world.actor.to_bytes()).unwrap();
    world.send_as(ix, &actor).unwrap();

    let mut ix_open = world.open_ix(world.actor.pubkey(), args.spec_hash());
    ix_open.data[0] ^= 0xFF; // Corrupt discriminator

    let err = world.send_as(ix_open, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn capture_first_fails_with_truncated_data() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    
    let actor = Keypair::from_bytes(&world.actor.to_bytes()).unwrap();
    world.send_as(world.register_ix(&args, accounts.clone()), &actor).unwrap();
    world.send_as(world.open_ix(world.actor.pubkey(), args.spec_hash()), &actor).unwrap();

    let mut ix_capture = world.capture_first_ix(args.spec_hash(), LIVE_SOL_FEED, accounts);
    ix_capture.data.pop(); // Truncate

    let err = world.send_as(ix_capture, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn register_fails_with_invalid_pda() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    
    let mut ix = world.register_ix(&args, accounts.clone());
    
    // Change spec account PDA to something else
    ix.accounts[1].pubkey = Pubkey::new_unique();

    let actor = Keypair::from_bytes(&world.actor.to_bytes()).unwrap();
    let err = world.send_as(ix, &actor).unwrap_err();
    assert!(err.contains("ConstraintSeeds") || err.contains("CrossProgramInvocation") || err.contains("InstructionError"));
}

#[test]
fn open_fails_with_invalid_need_pda() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    
    let actor = Keypair::from_bytes(&world.actor.to_bytes()).unwrap();
    world.send_as(world.register_ix(&args, accounts.clone()), &actor).unwrap();

    let mut ix_open = world.open_ix(world.actor.pubkey(), args.spec_hash());
    
    // Modify Need PDA
    ix_open.accounts[2].pubkey = Pubkey::new_unique();

    let err = world.send_as(ix_open, &actor).unwrap_err();
    assert!(err.contains("ConstraintSeeds") || err.contains("CrossProgramInvocation") || err.contains("InstructionError"));
}
