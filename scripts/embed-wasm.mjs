// Base64-embed the AssemblyScript kernels into committed .ts modules so each can be
// instantiated SYNCHRONOUSLY in every context (worker, main-thread sync path, Node tests)
// without an async fetch or a separate bundled asset. Run via: npm run build:wasm
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KERNELS = [
  { wasm: 'build/roundCorners.wasm', source: 'assembly/worldgen.ts', out: 'src/world/virtual/wasm/roundCornersWasm.ts', name: 'ROUND_CORNERS_WASM_BASE64' },
  { wasm: 'build/light.wasm', source: 'assembly/light.ts', out: 'src/render/wasm/lightWasm.ts', name: 'LIGHT_WASM_BASE64' },
];

for (const k of KERNELS) {
  const bytes = readFileSync(k.wasm);
  mkdirSync(dirname(k.out), { recursive: true });
  writeFileSync(k.out, `// AUTO-GENERATED from ${k.source} -> ${k.wasm} by scripts/embed-wasm.mjs.
// Do NOT edit by hand. Regenerate with: npm run build:wasm
export const ${k.name} =
  '${bytes.toString('base64')}';
`);
  console.log(`embedded ${bytes.length} bytes -> ${k.out}`);
}
