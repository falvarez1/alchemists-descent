// Base64-embed build/roundCorners.wasm into a committed .ts module so the kernel can be
// instantiated SYNCHRONOUSLY in every context (worker, main-thread sync path, Node tests)
// without an async fetch or a separate bundled asset. Run via: npm run build:wasm
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const wasmPath = 'build/roundCorners.wasm';
const bytes = readFileSync(wasmPath);
const b64 = bytes.toString('base64');
mkdirSync('src/world/virtual/wasm', { recursive: true });
const outPath = 'src/world/virtual/wasm/roundCornersWasm.ts';
const out = `// AUTO-GENERATED from assembly/worldgen.ts -> ${wasmPath} by scripts/embed-wasm.mjs.
// Do NOT edit by hand. Regenerate with: npm run build:wasm
export const ROUND_CORNERS_WASM_BASE64 =
  '${b64}';
`;
writeFileSync(outPath, out);
console.log(`embedded ${bytes.length} bytes -> ${outPath}`);
