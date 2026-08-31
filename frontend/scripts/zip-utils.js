// Hand-rolled STORE-only (uncompressed) ZIP writer, shared by
// build-extension-zip.js (build-time, zalo-login) and
// src/app/api/extension/ai-tracker/route.ts (runtime, per-project KPI
// Prototype download). No external zip dependency needed — these are all
// small text/binary files.
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

module.exports = { buildZip, crc32 };
