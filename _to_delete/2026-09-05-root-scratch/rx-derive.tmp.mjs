import { PublicKey } from '@solana/web3.js';
const PUSH = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(Number(v)); return b; };
const pda = id => PublicKey.findProgramAddressSync([u16(0), Buffer.from(id,'hex')], PUSH)[0].toBase58();
const rows = [
  ['SOL   (control, known sponsored)', 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'],
  ['Crypto.TSLAX/USD', '47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362'],
  ['Crypto.NVDAX/USD', '4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f'],
  ['Crypto.COINX/USD', '641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f'],
  ['Crypto.HOODX/USD', 'dd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9'],
  ['Equity.Index.TSLA/USD (for contrast)', 'e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0'],
];
for (const [name,id] of rows) console.log(pda(id).padEnd(46), name);
