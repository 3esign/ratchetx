#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  address,
  createClient,
  generateKeyPairSigner,
  isSome,
  lamports,
  unwrapOption,
} from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { fetchMint } from '@solana-program/token-2022';
import { canonicalSnapshot } from './model.mjs';
import {
  createPassportMintPlan,
  describePassportLayout,
  getCheckpointInstructions,
  getIssuePassportInstructions,
  getNegativeTransferFixture,
} from './passport.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '..', '.devnet', 'latest.json');
const EXPLORER = 'https://explorer.solana.com';

function nowCheckpoint(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    lifetimeXp: 0,
    bestStreak: 0,
    shots: 0,
    podiumWins: 0,
    epochDay: Math.floor(now / 86_400),
    checkpointUnix: now,
    ...overrides,
  };
}

function collectSignatures(value, found = new Set()) {
  if (!value || typeof value !== 'object') return [...found];
  if (typeof value.signature === 'string') found.add(value.signature);
  if (Array.isArray(value)) {
    for (const item of value) collectSignatures(item, found);
  } else {
    for (const item of Object.values(value)) collectSignatures(item, found);
  }
  return [...found];
}

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s)]+/g, '[rpc-url]').slice(0, 1200);
}

async function balance(client, owner) {
  return (await client.rpc.getBalance(owner, { commitment: 'confirmed' }).send()).value;
}

function optionKind(value) {
  return isSome(value) ? String(unwrapOption(value)) : null;
}

async function commandPlan() {
  const mint = address('11111111111111111111111111111111');
  const authority = address('SysvarRent111111111111111111111111111111111');
  const layout = describePassportLayout({
    mint,
    updateAuthority: authority,
    player: mint,
    checkpoint: nowCheckpoint({ checkpointUnix: 1_787_350_400, epochDay: 20_686 }),
  });
  console.log(JSON.stringify({
    experiment: 'ratchet-token-2022-player-passport',
    network: 'devnet-only',
    productionTouched: false,
    ...layout,
  }, null, 2));
}

async function commandDevnet() {
  const payer = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const rpcUrl = process.env.RATCHET_DEVNET_RPC || 'https://api.devnet.solana.com';
  const client = createClient()
    .use(signer(payer))
    .use(solanaDevnetRpc({ rpcUrl }));

  const report = {
    experiment: 'ratchet-token-2022-player-passport',
    network: 'devnet',
    productionTouched: false,
    rcxTouched: false,
    startedAt: new Date().toISOString(),
    payer: payer.address,
    player: payer.address,
    mint: mint.address,
    transactions: [],
  };

  console.log(`Funding ephemeral devnet signer ${payer.address} ...`);
  const airdropSignature = await client.airdrop(payer.address, lamports(100_000_000n));
  report.transactions.push({ stage: 'airdrop', signature: airdropSignature });
  const balanceBefore = await balance(client, payer.address);

  const initial = nowCheckpoint();
  const layout = describePassportLayout({
    mint: mint.address,
    updateAuthority: payer.address,
    player: payer.address,
    checkpoint: initial,
  });
  report.layout = layout;

  console.log(`Creating ${layout.bytes}-byte Token-2022 mint with on-mint metadata ...`);
  const mintPlan = await createPassportMintPlan(client, {
    payer,
    mint,
    player: payer.address,
    checkpoint: initial,
  });
  const mintResult = await client.sendTransactions(mintPlan, { commitment: 'confirmed' });
  for (const signature of collectSignatures(mintResult)) {
    report.transactions.push({ stage: 'create-mint', signature });
  }

  const issue = await getIssuePassportInstructions({ payer, mint, player: payer.address });
  const issueResult = await client.sendTransaction(issue.instructions, { commitment: 'confirmed' });
  report.tokenAccount = issue.ata;
  for (const signature of collectSignatures(issueResult)) {
    report.transactions.push({ stage: 'issue-one-and-revoke-mint-authority', signature });
  }

  const updated = nowCheckpoint({ lifetimeXp: 1_250, bestStreak: 3, shots: 12, podiumWins: 1 });
  const updateResult = await client.sendTransaction(
    getCheckpointInstructions({
      mint: mint.address,
      updateAuthority: payer,
      player: payer.address,
      checkpoint: updated,
    }),
    { commitment: 'confirmed' },
  );
  for (const signature of collectSignatures(updateResult)) {
    report.transactions.push({ stage: 'checkpoint-update', signature });
  }

  const negative = await getNegativeTransferFixture({
    payer,
    mint: mint.address,
    source: issue.ata,
    sourceOwner: payer,
    recipient: recipient.address,
  });
  const destinationResult = await client.sendTransaction([negative.createDestination], { commitment: 'confirmed' });
  report.negativeTransferDestination = negative.destination;
  for (const signature of collectSignatures(destinationResult)) {
    report.transactions.push({ stage: 'create-negative-test-destination', signature });
  }

  try {
    await client.sendTransaction([negative.forbiddenTransfer], { commitment: 'confirmed' });
    report.nonTransferable = { passed: false, error: 'Transfer unexpectedly succeeded' };
    throw new Error('SECURITY ASSERTION FAILED: NonTransferable passport moved between wallets');
  } catch (error) {
    if (String(error?.message).includes('SECURITY ASSERTION FAILED')) throw error;
    report.nonTransferable = { passed: true, expectedFailure: publicError(error) };
  }

  const mintAccount = await fetchMint(client.rpc, mint.address, { commitment: 'confirmed' });
  const extensions = isSome(mintAccount.data.extensions) ? unwrapOption(mintAccount.data.extensions) : [];
  const metadata = extensions.find(item => item.__kind === 'TokenMetadata');
  report.onchain = {
    supply: mintAccount.data.supply.toString(),
    decimals: mintAccount.data.decimals,
    mintAuthority: optionKind(mintAccount.data.mintAuthority),
    freezeAuthority: optionKind(mintAccount.data.freezeAuthority),
    extensionKinds: extensions.map(item => item.__kind),
    metadata: metadata ? {
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      updateAuthority: optionKind(metadata.updateAuthority),
      additionalMetadata: Object.fromEntries(metadata.additionalMetadata),
    } : null,
  };
  report.expectedCheckpoint = canonicalSnapshot(updated);

  const balanceAfter = await balance(client, payer.address);
  report.cost = {
    startingLamports: balanceBefore.toString(),
    endingLamports: balanceAfter.toString(),
    totalLamportsConsumed: (balanceBefore - balanceAfter).toString(),
    scope: 'mint rent + owner ATA + recipient ATA + successful transaction fees + failed-transfer fee',
  };
  report.explorer = {
    mint: `${EXPLORER}/address/${mint.address}?cluster=devnet`,
    transactions: report.transactions.map(item => ({
      stage: item.stage,
      url: `${EXPLORER}/tx/${item.signature}?cluster=devnet`,
    })),
  };
  report.completedAt = new Date().toISOString();

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUTPUT}`);
}

const command = process.argv[2] || 'plan';
try {
  if (command === 'plan') {
    await commandPlan();
  } else if (command === 'devnet-demo') {
    await commandDevnet();
  } else {
    console.error('Usage: npm run passport -- [plan|devnet-demo]');
    process.exitCode = 2;
  }
} catch (error) {
  const blocked = {
    experiment: 'ratchet-token-2022-player-passport',
    status: 'blocked-before-deploy',
    productionTouched: false,
    rcxTouched: false,
    reason: publicError(error),
    next: 'Retry later or set RATCHET_DEVNET_RPC to a funded devnet endpoint. Never use a mainnet URL.',
    at: new Date().toISOString(),
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(blocked, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  console.error(JSON.stringify(blocked, null, 2));
  process.exitCode = 1;
}
