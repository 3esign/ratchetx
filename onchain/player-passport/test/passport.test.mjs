import test from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { getMintSize } from '@solana-program/token-2022';
import { buildPassportExtensions, describePassportLayout } from '../src/passport.mjs';

const MINT = address('11111111111111111111111111111111');
const AUTHORITY = address('SysvarRent111111111111111111111111111111111');

test('passport combines NonTransferable, self-pointing metadata and TokenMetadata', () => {
  const extensions = buildPassportExtensions({
    mint: MINT,
    updateAuthority: AUTHORITY,
    player: MINT,
    checkpoint: { lifetimeXp: 100 },
  });
  assert.deepEqual(extensions.map(item => item.__kind), [
    'NonTransferable',
    'MetadataPointer',
    'TokenMetadata',
  ]);
  assert.equal(extensions[2].uri, '');
  assert.equal(extensions[2].additionalMetadata.get('ratchet.player'), MINT);
  assert.ok(getMintSize(extensions) > 82);
});

test('layout report is JSON-friendly and preserves exact account size', () => {
  const input = {
    mint: MINT,
    updateAuthority: AUTHORITY,
    player: MINT,
    checkpoint: { shots: 1 },
  };
  const report = describePassportLayout(input);
  assert.equal(report.bytes, getMintSize(buildPassportExtensions(input)));
  assert.equal(report.metadataFields['ratchet.shots'], '00000000000000000001');
});
