const { PublicKey, SystemProgram, Keypair, TransactionInstruction } = require('@solana/web3.js');

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// We need the program ID for player passport
const PASSPORT_PROGRAM_ID = new PublicKey("4WQ4XtZC29M6YoxgNi9WHhYJWEtYyj6YNftSB9yCM6E2"); // Devnet deploy

function serializeCreateV2Data(configPubKey) {
  const name = "RATCHET Player Passport V2";
  const uri = "https://ratchet.game/passport.json";
  
  const nameBytes = Buffer.from(name, 'utf8');
  const uriBytes = Buffer.from(uri, 'utf8');
  
  const size = 1 + 1 + 4 + nameBytes.length + 4 + uriBytes.length + 1 + 1 + 4 + 1 + 1 + 32 + 1 + 1 + 32 + 1;
  const buffer = Buffer.alloc(size);
  let offset = 0;
  
  buffer.writeUInt8(20, offset); offset += 1;
  buffer.writeUInt8(0, offset); offset += 1;
  
  buffer.writeUInt32LE(nameBytes.length, offset); offset += 4;
  nameBytes.copy(buffer, offset); offset += nameBytes.length;
  
  buffer.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(buffer, offset); offset += uriBytes.length;
  
  buffer.writeUInt8(0, offset); offset += 1;
  buffer.writeUInt8(1, offset); offset += 1;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt8(2, offset); offset += 1;
  buffer.writeUInt8(3, offset); offset += 1;
  configPubKey.toBuffer().copy(buffer, offset); offset += 32;
  buffer.writeUInt8(1, offset); offset += 1;
  buffer.writeUInt8(3, offset); offset += 1;
  configPubKey.toBuffer().copy(buffer, offset); offset += 32;
  buffer.writeUInt8(0, offset); offset += 1;
  
  return buffer;
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Parse body safely
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      body = {};
    }

    const { wallet } = body;
    if (!wallet) return res.status(400).json({ ok: false, error: 'wallet required' });
    
    let playerPubkey;
    try {
      playerPubkey = new PublicKey(wallet);
    } catch(e) {
      return res.status(400).json({ ok: false, error: 'invalid wallet pubkey' });
    }

    const [config] = PublicKey.findProgramAddressSync([Buffer.from("passport-config")], PASSPORT_PROGRAM_ID);
    
    // We generate an ephemeral keypair for the mint
    const mintKeypair = Keypair.generate();
    
    // 1. Create Account Instruction
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: playerPubkey,
      newAccountPubkey: mintKeypair.publicKey,
      space: 100, // Safe minimum for Metaplex Core Mint
      lamports: 2000000, // ~0.002 SOL rent
      programId: MPL_CORE_PROGRAM_ID
    });

    // 2. Metaplex Core CreateV2
    const createV2Ix = new TransactionInstruction({
      programId: MPL_CORE_PROGRAM_ID,
      keys: [
        { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // Collection
        { pubkey: playerPubkey, isSigner: true, isWritable: true }, // Payer
        { pubkey: playerPubkey, isSigner: false, isWritable: false }, // Owner
        { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // Update Authority
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System Program
        { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // Log Wrapper
      ],
      data: serializeCreateV2Data(config)
    });

    // 3. Initialize Registry in Passport Program
    const [registry] = PublicKey.findProgramAddressSync(
      [Buffer.from("passport"), playerPubkey.toBuffer()],
      PASSPORT_PROGRAM_ID
    );

    // sha256("global:initialize_registry")[..8] = [174, 95, 237, 240, 203, 76, 50, 48]
    const initRegistryIx = new TransactionInstruction({
      programId: PASSPORT_PROGRAM_ID,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: playerPubkey, isSigner: true, isWritable: true },
        { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([174, 95, 237, 240, 203, 76, 50, 48])
    });

    return res.status(200).json({
      ok: true,
      mint: mintKeypair.publicKey.toBase58(),
      mintSecretKey: Array.from(mintKeypair.secretKey),
      instructions: [
        {
          programId: createAccountIx.programId.toBase58(),
          keys: createAccountIx.keys.map(k => ({
            pubkey: k.pubkey.toBase58(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          })),
          data: createAccountIx.data.toString('base64')
        },
        {
          programId: createV2Ix.programId.toBase58(),
          keys: createV2Ix.keys.map(k => ({
            pubkey: k.pubkey.toBase58(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          })),
          data: createV2Ix.data.toString('base64')
        },
        {
          programId: initRegistryIx.programId.toBase58(),
          keys: initRegistryIx.keys.map(k => ({
            pubkey: k.pubkey.toBase58(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          })),
          data: initRegistryIx.data.toString('base64')
        }
      ]
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
