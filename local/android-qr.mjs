import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const mobileRequire = createRequire(
  new URL('../apps/mobile/package.json', import.meta.url),
);
const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const qrRequire = createRequire(
  cliRequire.resolve('qrcode-terminal/package.json'),
);
const QRCode = qrRequire('./vendor/QRCode');
const levels = qrRequire('./vendor/QRCode/QRErrorCorrectLevel');
const host = new URL(
  process.env.LOCAL_PUBLIC_API_URL || 'http://127.0.0.1:54321',
).hostname;
const uri = `exp://${host}:8081`;
const qr = new QRCode(-1, levels.M);
qr.addData(uri);
qr.make();
const n = qr.getModuleCount(),
  scale = 10,
  quiet = 4,
  size = (n + quiet * 2) * scale;
const pixels = Buffer.alloc((size + 1) * size, 255);
for (let y = 0; y < size; y++) {
  pixels[y * (size + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const r = Math.floor(y / scale) - quiet,
      c = Math.floor(x / scale) - quiet;
    if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c))
      pixels[y * (size + 1) + x + 1] = 0;
  }
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
await mkdir(resolve(root, '.local-data'), { recursive: true });
await writeFile(resolve(root, '.local-data/android-qr.png'), png);
console.log(`Android QR: .local-data/android-qr.png\n${uri}`);
