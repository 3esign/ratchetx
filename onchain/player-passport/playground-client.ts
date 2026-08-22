import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getMintLen,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
} from "@solana/spl-token-metadata";

declare const pg: any;

// RATCHET Player Passport v1 — disposable Devnet experiment only.
// It does not touch RCX, the live RATCHET game, or any production authority.
const EXPECTED_PLAYER = new PublicKey(
  "8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH",
);
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const NAME = "RATCHET Player Passport";
const SYMBOL = "RPX";
const URI = "";

const fields: [string, string][] = [
  ["ratchet.schema", "ratchet-passport-v1"],
  ["ratchet.player", EXPECTED_PLAYER.toBase58()],
  ["ratchet.lifetime_xp", "00000000000000000000"],
  ["ratchet.best_streak", "0000000000"],
  ["ratchet.shots", "00000000000000000000"],
  ["ratchet.podium_wins", "0000000000"],
  ["ratchet.epoch_day", "0000020687"],
  ["ratchet.checkpoint_unix", "1787424300"],
  [
    "ratchet.checkpoint_hash",
    "bd5e1237b8e2ed3b40678af288b5e78a66a03c57507cd8421406bb64cf3babb5",
  ],
  ["ratchet.proof", "https://ratchetx.xyz/api/proof"],
];

async function send(
  label: string,
  instructions: any[],
  extraSigners: Keypair[] = [],
) {
  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(
    pg.connection,
    tx,
    [pg.wallet.keypair, ...extraSigners],
    { commitment: "confirmed" },
  );
  console.log(`${label}: ${signature}`);
  return signature;
}

const wallet = pg.wallet.keypair;
if (!wallet.publicKey.equals(EXPECTED_PLAYER)) {
  throw new Error(
    `Wrong Playground wallet. Expected ${EXPECTED_PLAYER.toBase58()}, got ${wallet.publicKey.toBase58()}`,
  );
}

const genesis = await pg.connection.getGenesisHash();
if (genesis !== DEVNET_GENESIS) {
  throw new Error(
    `Refusing to run outside the expected Devnet genesis. Received ${genesis}`,
  );
}

const startingBalance = await pg.connection.getBalance(wallet.publicKey, "confirmed");
if (startingBalance < 50_000_000) {
  throw new Error("At least 0.05 Devnet SOL is required for the experiment");
}

const mint = Keypair.generate();
const recipient = Keypair.generate();
const metadata = {
  updateAuthority: wallet.publicKey,
  mint: mint.publicKey,
  name: NAME,
  symbol: SYMBOL,
  uri: URI,
  additionalMetadata: fields,
};

const baseMintLength = getMintLen([
  ExtensionType.NonTransferable,
  ExtensionType.MetadataPointer,
]);
const metadataLength = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const mintLength = baseMintLength + metadataLength;
const rent = await pg.connection.getMinimumBalanceForRentExemption(mintLength);
const signatures: { stage: string; signature: string }[] = [];

signatures.push({
  stage: "create-mint",
  signature: await send(
    "create-mint",
    [
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: baseMintLength,
        lamports: rent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(
        mint.publicKey,
        wallet.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeNonTransferableMintInstruction(
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        0,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ],
    [mint],
  ),
});

signatures.push({
  stage: "initialize-metadata",
  signature: await send("initialize-metadata", [
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint.publicKey,
      updateAuthority: wallet.publicKey,
      mint: mint.publicKey,
      mintAuthority: wallet.publicKey,
      name: NAME,
      symbol: SYMBOL,
      uri: URI,
    }),
  ]),
});

// Two fields per transaction keeps each message small and makes failures easy to locate.
for (let index = 0; index < fields.length; index += 2) {
  const batch = fields.slice(index, index + 2);
  signatures.push({
    stage: `metadata-${index / 2 + 1}`,
    signature: await send(
      `metadata-${index / 2 + 1}`,
      batch.map(([field, value]) =>
        createUpdateFieldInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint.publicKey,
          updateAuthority: wallet.publicKey,
          field,
          value,
        }),
      ),
    ),
  });
}

const ownerAta = getAssociatedTokenAddressSync(
  mint.publicKey,
  wallet.publicKey,
  false,
  TOKEN_2022_PROGRAM_ID,
);
signatures.push({
  stage: "issue-one-and-revoke-mint-authority",
  signature: await send("issue-one-and-revoke-mint-authority", [
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      ownerAta,
      wallet.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(
      mint.publicKey,
      ownerAta,
      wallet.publicKey,
      1,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
    createSetAuthorityInstruction(
      mint.publicKey,
      wallet.publicKey,
      AuthorityType.MintTokens,
      null,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  ]),
});

const recipientAta = getAssociatedTokenAddressSync(
  mint.publicKey,
  recipient.publicKey,
  false,
  TOKEN_2022_PROGRAM_ID,
);
signatures.push({
  stage: "create-negative-test-destination",
  signature: await send("create-negative-test-destination", [
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      recipientAta,
      recipient.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
  ]),
});

let nonTransferablePassed = false;
try {
  await send("forbidden-transfer-UNEXPECTED", [
    createTransferCheckedInstruction(
      ownerAta,
      mint.publicKey,
      recipientAta,
      wallet.publicKey,
      1,
      0,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  ]);
} catch (error) {
  nonTransferablePassed = true;
  console.log("PASS: Token-2022 rejected the attempted passport transfer.");
  console.log(String(error));
}
if (!nonTransferablePassed) {
  throw new Error("SECURITY FAILURE: non-transferable passport moved wallets");
}

const mintState = await getMint(
  pg.connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
const endingBalance = await pg.connection.getBalance(wallet.publicKey, "confirmed");

const report = {
  network: "devnet",
  productionTouched: false,
  rcxTouched: false,
  player: wallet.publicKey.toBase58(),
  mint: mint.publicKey.toBase58(),
  ownerAta: ownerAta.toBase58(),
  mintBytes: mintLength,
  supply: mintState.supply.toString(),
  decimals: mintState.decimals,
  mintAuthority: mintState.mintAuthority?.toBase58() ?? null,
  freezeAuthority: mintState.freezeAuthority?.toBase58() ?? null,
  nonTransferablePassed,
  totalLamportsConsumed: startingBalance - endingBalance,
  signatures,
  explorer: `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
};

console.log("RATCHET_PLAYER_PASSPORT_REPORT");
console.log(JSON.stringify(report, null, 2));
