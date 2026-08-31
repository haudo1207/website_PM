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
const { buildZip } = require('./zip-utils');

const EXT_DIR = path.resolve(__dirname, '../../extensions/zalo-login');
const OUT_ZIP = path.resolve(__dirname, '../public/zalo-login-extension.zip');

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
