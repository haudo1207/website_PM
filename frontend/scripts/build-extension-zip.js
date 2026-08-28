// Packages extensions/zalo-login/ (repo root, sibling to frontend/) into
// public/zalo-login-extension.zip so the "Tải extension" button on
// /zalo-account always serves an up-to-date build. No external zip library —
// hand-rolled STORE-only (uncompressed) ZIP writer, since these are a
// handful of small text files and this avoids adding a dependency just for
// this. Run via predev/prebuild, same as design:build.
//
// The Docker build context for frontend/ is `./frontend` only (see
// docker-compose.yml), so ../extensions is NOT visible inside a Docker
// build — this script silently skips in that case and leaves whatever zip
// is already sitting in public/ (committed from a host run) untouched.
// Always run `npm run extension:build` on the host BEFORE rebuilding the
// frontend Docker image if extensions/zalo-login/ changed.
const fs = require('fs');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '../../extensions/zalo-login');
const OUT_ZIP = path.resolve(__dirname, '../public/zalo-login-extension.zip');

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = buildCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function buildZip(files) {
  // files: [{ name, data: Buffer }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const crc = crc32(file.data);
    const size = file.data.length;

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: store
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size), // compressed size
      u32(size), // uncompressed size
      u16(nameBuf.length),
      u16(0), // extra field length
    ]);
    const localEntry = Buffer.concat([localHeader, nameBuf, file.data]);
    localParts.push(localEntry);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBuf.length),
      u16(0), // extra field length
      u16(0), // comment length
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset), // offset of local header
    ]);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localDir = Buffer.concat(localParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with CD
    u16(files.length), // records on this disk
    u16(files.length), // total records
    u32(centralDir.length),
    u32(localDir.length), // offset of start of CD
    u16(0), // comment length
  ]);

  return Buffer.concat([localDir, centralDir, end]);
}

function main() {
  if (!fs.existsSync(EXT_DIR)) {
    console.log('[build-extension-zip] extensions/zalo-login not found (normal inside a Docker build) — skipping.');
    return;
  }

  const entries = fs
    .readdirSync(EXT_DIR)
    .filter((f) => fs.statSync(path.join(EXT_DIR, f)).isFile())
    .map((name) => ({ name, data: fs.readFileSync(path.join(EXT_DIR, name)) }));

  if (entries.length === 0) {
    console.log('[build-extension-zip] extensions/zalo-login is empty — skipping.');
    return;
  }

  const zipBuffer = buildZip(entries);
  fs.mkdirSync(path.dirname(OUT_ZIP), { recursive: true });
  fs.writeFileSync(OUT_ZIP, zipBuffer);
  console.log(`[build-extension-zip] wrote ${path.relative(process.cwd(), OUT_ZIP)} (${entries.length} files, ${zipBuffer.length} bytes)`);
}

main();
