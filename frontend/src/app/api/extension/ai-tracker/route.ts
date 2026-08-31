import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXT_DIR = path.resolve(process.cwd(), 'extension-src/ai-tracker');

// Hand-rolled STORE-only (uncompressed) ZIP writer — same approach as
// frontend/scripts/build-extension-zip.js (frontend/scripts/zip-utils.js),
// duplicated here in TS rather than cross-imported from that CommonJS script
// to avoid relying on Next's file-tracer resolving a deep relative require()
// from inside an app-router route handler at build time.
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = buildCrcTable();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const crc = crc32(file.data);
    const size = file.data.length;

    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBuf.length), u16(0),
    ]);
    const localEntry = Buffer.concat([localHeader, nameBuf, file.data]);
    localParts.push(localEntry);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset),
    ]);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localDir = Buffer.concat(localParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDir.length), u32(localDir.length), u16(0),
  ]);

  return Buffer.concat([localDir, centralDir, end]);
}

function walk(dir: string, baseDir: string, out: { name: string; data: Buffer }[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
    } else {
      const relative = path.relative(baseDir, full).split(path.sep).join('/');
      out.push({ name: relative, data: fs.readFileSync(full) });
    }
  }
}

export async function GET(request: NextRequest) {
  // Optional — ONE zip works for every project now (re-downloading per
  // project was annoying). When present (e.g. downloaded from a specific
  // project's Prototype tab), it only seeds a one-time default; the real,
  // changeable project selection lives inside the extension itself.
  const rawProjectId = request.nextUrl.searchParams.get('project_id');
  const projectId = rawProjectId && /^\d+$/.test(rawProjectId) ? rawProjectId : null;
  const projectName = request.nextUrl.searchParams.get('project_name') || '';

  if (!fs.existsSync(EXT_DIR)) {
    return NextResponse.json({ detail: 'Extension source không tồn tại trên server' }, { status: 500 });
  }

  // NOT request.nextUrl.origin — under `output: standalone` + custom
  // server.js with no reverse proxy in front, it can resolve to the
  // container's own hostname (e.g. http://<container-id>:3000) instead of
  // the address the browser actually used. Read the real Host header the
  // browser sent (or X-Forwarded-Host, if something does sit in front in
  // another environment) directly.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const apiBase = `${proto}://${host}`;
  const hostPermission = `${apiBase}/*`;

  const files: { name: string; data: Buffer }[] = [];
  walk(EXT_DIR, EXT_DIR, files);

  const escapedProjectName = projectName.replace(/"/g, '\\"');

  const injected = files.map((f) => {
    if (f.name === 'manifest.json') {
      const text = f.data.toString('utf-8').replace('%%API_HOST_PERMISSION%%', hostPermission);
      return { name: f.name, data: Buffer.from(text, 'utf-8') };
    }
    if (f.name === 'scripts/config.js') {
      const text = f.data
        .toString('utf-8')
        .replace('%%API_BASE%%', apiBase)
        .replace('%%SUGGESTED_PROJECT_ID%%', projectId ? projectId : 'null')
        .replace('%%SUGGESTED_PROJECT_NAME%%', escapedProjectName);
      return { name: f.name, data: Buffer.from(text, 'utf-8') };
    }
    return f;
  });

  const zipBuffer = buildZip(injected);

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="kpi-prototype-extension.zip"',
      'Content-Length': String(zipBuffer.length),
    },
  });
}
