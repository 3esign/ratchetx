import { none, some } from '@solana/kit';
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getCreateMintInstructionPlan,
  getMintSize,
  getMintToInstruction,
  getSetAuthorityInstruction,
  getTransferCheckedInstruction,
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
} from '@solana-program/token-2022';
import {
  PASSPORT_NAME,
  PASSPORT_SYMBOL,
  buildPassportFields,
  checkpointUpdates,
} from './model.mjs';

export function buildPassportExtensions({ mint, updateAuthority, player, checkpoint, checkpointHash }) {
  const additionalMetadata = buildPassportFields({ player, checkpoint, checkpointHash });
  return [
    extension('NonTransferable'),
    extension('MetadataPointer', {
      authority: some(updateAuthority),
      metadataAddress: some(mint),
    }),
    extension('TokenMetadata', {
      updateAuthority: some(updateAuthority),
      mint,
      name: PASSPORT_NAME,
      symbol: PASSPORT_SYMBOL,
      uri: '',
      additionalMetadata,
    }),
  ];
}

export function describePassportLayout(input) {
  const extensions = buildPassportExtensions(input);
  return Object.freeze({
    bytes: getMintSize(extensions),
    extensionKinds: extensions.map(item => item.__kind),
    metadataFields: Object.fromEntries(extensions[2].additionalMetadata),
  });
}

export async function createPassportMintPlan(client, { payer, mint, player, checkpoint, checkpointHash }) {
  const extensions = buildPassportExtensions({
    mint: mint.address,
    updateAuthority: payer.address,
    player,
    checkpoint,
    checkpointHash,
  });
  return await getCreateMintInstructionPlan(client, {
    payer,
    newMint: mint,
    decimals: 0,
    mintAuthority: payer,
    freezeAuthority: none(),
    extensions,
  });
}

export async function getIssuePassportInstructions({ payer, mint, player }) {
  const [ata] = await findAssociatedTokenPda({
    owner: player,
    mint: mint.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  return Object.freeze({
    ata,
    instructions: [
      await getCreateAssociatedTokenInstructionAsync({
        payer,
        owner: player,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }),
      getMintToInstruction({
        mint: mint.address,
        token: ata,
        mintAuthority: payer,
        amount: 1,
      }),
      getSetAuthorityInstruction({
        owned: mint.address,
        owner: payer,
        authorityType: AuthorityType.MintTokens,
        newAuthority: none(),
      }),
    ],
  });
}

export function getCheckpointInstructions({ mint, updateAuthority, player, checkpoint, checkpointHash }) {
  return checkpointUpdates({ player, checkpoint, checkpointHash }).map(({ key, value }) =>
    getUpdateTokenMetadataFieldInstruction({
      metadata: mint,
      updateAuthority,
      field: tokenMetadataField('Key', { key }),
      value,
    }),
  );
}

export async function getNegativeTransferFixture({ payer, mint, source, sourceOwner, recipient }) {
  const [destination] = await findAssociatedTokenPda({
    owner: recipient,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  return Object.freeze({
    destination,
    createDestination: await getCreateAssociatedTokenInstructionAsync({
      payer,
      owner: recipient,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    forbiddenTransfer: getTransferCheckedInstruction({
      source,
      mint,
      destination,
      authority: sourceOwner,
      amount: 1,
      decimals: 0,
    }),
  });
}
