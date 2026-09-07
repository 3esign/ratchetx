import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { RatchetCore } from '../target/types/ratchet_core';
import { assert } from 'chai';

describe('ratchet-core', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RatchetCore as Program<RatchetCore>;

  it('Is initialized!', async () => {
    // Add your tests here.
    console.log('Testing G2 and G3 logic...');
  });
});
