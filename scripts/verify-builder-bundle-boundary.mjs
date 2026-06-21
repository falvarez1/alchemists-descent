// Production bundle ownership check for Builder decoupling.
//
// Usage:
//   npm run build
//   node scripts/verify-builder-bundle-boundary.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';
const manifestPath = join(distDir, '.vite', 'manifest.json');
const builderOwnedSource = /(^|\/)src\/(?:builder\/|ui\/editor\/(?:DockHost|Fields|InspectorSchema|PanelChrome|PanelRegistry|Section|Workspace)\.ts$)/;
const builderChunkName = /(^|\/)assets\/builder-[^/]+\.js$/i;

const fail = (message) => {
  console.error(`Builder bundle boundary failed: ${message}`);
  process.exit(1);
};

const normalize = (value) => String(value).replace(/\\/g, '/');

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}; run npm run build first`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = Object.entries(manifest);
const entryKey = entries.find(([, entry]) => entry.isEntry)?.[0];
if (!entryKey) fail('Vite manifest has no entry chunk');

function manifestEntry(key) {
  const entry = manifest[key];
  if (!entry) fail(`manifest references missing chunk ${key}`);
  return entry;
}

function collectStaticGraph(rootKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifestEntry(key);
    for (const imported of entry.imports ?? []) visit(imported);
  };
  visit(rootKey);
  return seen;
}

function mapSourcesFor(entry) {
  const mapPath = join(distDir, `${entry.file}.map`);
  if (!existsSync(mapPath)) return [];
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    return Array.isArray(map.sources) ? map.sources.map(normalize) : [];
  } catch (error) {
    fail(`could not parse sourcemap ${mapPath}: ${error}`);
  }
}

function entryHasBuilderOwnedSource(key, entry) {
  if (builderOwnedSource.test(normalize(key))) return true;
  return mapSourcesFor(entry).some((source) => builderOwnedSource.test(source));
}

const staticGraph = collectStaticGraph(entryKey);
const staticBuilderSources = [];
for (const key of staticGraph) {
  const entry = manifestEntry(key);
  if (entryHasBuilderOwnedSource(key, entry)) {
    staticBuilderSources.push(`${key} -> ${entry.file}`);
  }
}
if (staticBuilderSources.length > 0) {
  fail(`initial player graph includes Builder/editor source:\n  ${staticBuilderSources.join('\n  ')}`);
}

const dynamicBuilderEntries = [];
const allImportsFromStaticGraph = new Set();
for (const key of staticGraph) {
  const entry = manifestEntry(key);
  for (const imported of entry.dynamicImports ?? []) allImportsFromStaticGraph.add(imported);
}
for (const imported of allImportsFromStaticGraph) {
  const entry = manifestEntry(imported);
  if (entryHasBuilderOwnedSource(imported, entry)) dynamicBuilderEntries.push([imported, entry]);
}

if (dynamicBuilderEntries.length === 0) {
  fail('initial player entry has no dynamic Builder chunk; lazy loading may have regressed');
}

const builderFiles = dynamicBuilderEntries.map(([, entry]) => normalize(entry.file));
const namedBuilderFiles = builderFiles.filter((file) => builderChunkName.test(file));
if (namedBuilderFiles.length === 0) {
  fail(`Builder chunk is not emitted as assets/builder-*.js: ${builderFiles.join(', ')}`);
}

const chunkOwners = new Map();
for (const [key, entry] of entries) {
  const file = normalize(entry.file);
  if (!file.endsWith('.js')) continue;
  if (!chunkOwners.has(file)) chunkOwners.set(file, []);
  chunkOwners.get(file).push(key);
}
const builderFileSet = new Set(builderFiles);
for (const file of builderFileSet) {
  const owners = chunkOwners.get(file) ?? [];
  const nonBuilderOwners = owners.filter((key) => !builderOwnedSource.test(normalize(key)));
  if (nonBuilderOwners.length > 0) {
    fail(`Builder chunk ${file} also owns non-Builder/editor manifest entries: ${nonBuilderOwners.join(', ')}`);
  }
}

console.log(
  `Builder bundle boundary passed: entry=${entryKey}, staticChunks=${staticGraph.size}, builderChunks=${[
    ...builderFileSet,
  ].join(', ')}`,
);
