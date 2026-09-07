import { PublicKey } from '@solana/web3.js';
const PUSH = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(Number(v)); return b; };
const rows = [
  ['SOL',   'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'],
  ['TSLAX', '47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362'],
  ['NVDAX', '4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f'],
  ['COINX', '641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f'],
  ['HOODX', 'dd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9'],
  ['SPYX',  '2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14'],
  ['AAPLX', '978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675'],
  ['MSTRX', '53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28'],
  ['CRCLX', 'c13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758'],
];
const out = {};
for (const [n,id] of rows) out[PublicKey.findProgramAddressSync([u16(0), Buffer.from(id,'hex')], PUSH)[0].toBase58()] = [n,id];
console.log(JSON.stringify(out));
