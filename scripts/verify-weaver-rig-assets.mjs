// Validates the sidecar manifest for the image-backed Weaver rig.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rigDir = join(root, 'assets', 'enemies');
const manifestPath = join(rigDir, 'weaver-crystal-silk-assassin-rig.json');
const requiredParts = [
  'head',
  'mandibleA',
  'mandibleB',
  'thorax',
  'abdomen',
  'spinnerets',
  'crystalSpine',
  'jointCap',
  'legUpperA',
  'legUpperB',
  'legUpperC',
  'legLowerA',
  'legLowerB',
  'legLowerC',
  'footA',
  'footB',
  'footC',
  'silk',
];

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assertObject(manifest, 'manifest');
assert(manifest.schemaVersion === 1, 'schemaVersion must be 1');
assert(typeof manifest.atlas === 'string' && manifest.atlas.endsWith('.png'), 'atlas must name a PNG');
assert(typeof manifest.source === 'string' && manifest.source.endsWith('.png'), 'source must name a PNG');

const atlasPath = join(rigDir, manifest.atlas);
const sourcePath = join(rigDir, manifest.source);
const atlasSize = readPngSize(atlasPath);
readPngSize(sourcePath);

assertObject(manifest.parts, 'parts');
for (const name of requiredParts) {
  assertObject(manifest.parts[name], `parts.${name}`);
  const part = manifest.parts[name];
  for (const key of ['sx', 'sy', 'sw', 'sh', 'w', 'h', 'pivotX', 'pivotY']) {
    assert(Number.isFinite(part[key]), `parts.${name}.${key} must be a finite number`);
  }
  assert(part.sx >= 0 && part.sy >= 0, `parts.${name} crop origin must be non-negative`);
  assert(part.sw > 0 && part.sh > 0 && part.w > 0 && part.h > 0, `parts.${name} dimensions must be positive`);
  assert(part.sx + part.sw <= atlasSize.width, `parts.${name} crop exceeds atlas width`);
  assert(part.sy + part.sh <= atlasSize.height, `parts.${name} crop exceeds atlas height`);
  assert(part.pivotX >= 0 && part.pivotX <= part.w, `parts.${name}.pivotX must sit inside runtime width`);
  assert(part.pivotY >= 0 && part.pivotY <= part.h, `parts.${name}.pivotY must sit inside runtime height`);
}

const known = new Set(requiredParts);
assertObject(manifest.legParts, 'legParts');
for (const group of ['upper', 'lower', 'foot']) {
  const names = manifest.legParts[group];
  assert(Array.isArray(names) && names.length > 0, `legParts.${group} must be a non-empty array`);
  for (const name of names) assert(known.has(name), `legParts.${group} contains unknown part ${name}`);
}

console.log(`PASS - Weaver rig manifest validates against ${atlasSize.width}x${atlasSize.height} atlas.`);

function readPngSize(path) {
  const bytes = readFileSync(path);
  const signature = '89504e470d0a1a0a';
  assert(bytes.subarray(0, 8).toString('hex') === signature, `${path} is not a PNG`);
  assert(bytes.subarray(12, 16).toString('ascii') === 'IHDR', `${path} is missing PNG IHDR`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function assertObject(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
