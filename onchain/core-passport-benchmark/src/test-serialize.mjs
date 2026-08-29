import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { 
  createV2, pluginAuthorityPair, baseExternalPluginAdapterInitInfo, appDataInitInfoArgsToBase
} from '@metaplex-foundation/mpl-core';

const umi = createUmi('https://api.devnet.solana.com');
const player = generateSigner(umi);
const ratchetAuth = generateSigner(umi);
umi.use(keypairIdentity(player));
const asset = generateSigner(umi);

try {
  const tx = createV2(umi, {
    asset,
    name: 'test',
    uri: 'https://test',
    owner: player.publicKey,
    plugins: [
      pluginAuthorityPair({ type: 'FreezeDelegate', data: { frozen: true } })
    ],
    externalPluginAdapters: [
      baseExternalPluginAdapterInitInfo('AppData', [
        appDataInitInfoArgsToBase({
          dataAuthority: { type: 'Address', address: ratchetAuth.publicKey },
          initPluginAuthority: { type: 'Owner' },
          schema: null
        })
      ])
    ]
  });
  const serialized = tx.build(umi);
  console.log("Serialization SUCCESS!");
} catch (e) {
  console.log("Serialization FAILED:", e);
}
