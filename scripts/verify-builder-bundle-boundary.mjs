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
// The PLAYER entry specifically. There are two HTML entries now
// (index.html and builder.html) and `find(isEntry)` would happily lock onto
// whichever came first — silently checking the editor route instead of the
// one that must never ship Builder code, and passing either way.
const entryKey = entries.find(([key, entry]) => entry.isEntry && normalize(key) === 'index.html')?.[0];
if (!entryKey) fail('Vite manifest has no index.html entry chunk');
const builderRouteKey = entries.find(([key, entry]) => entry.isEntry && normalize(key) === 'builder.html')?.[0];

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

// PLAY BUILD (no /builder.html route — `npm run build` without
// VITE_INCLUDE_BUILDER): the Builder must not exist anywhere in the output,
// statically OR lazily. That is the whole point of the split, and it is the
// build CI produces; asking it for a lazy Builder chunk failed every run.
if (!builderRouteKey) {
  const leaked = [];
  for (const [key, entry] of entries) {
    if (entryHasBuilderOwnedSource(key, entry)) leaked.push(`${key} -> ${entry.file}`);
  }
  if (leaked.length > 0) fail(`play build ships Builder/editor source:\n  ${leaked.join('\n  ')}`);
  console.log(
    `Builder bundle boundary passed: play build, playerEntry=${entryKey}, no Builder chunk emitted ` +
      `(${entries.length} manifest entries checked)`,
  );
  process.exit(0);
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

// Walk dynamic imports TRANSITIVELY. The player entry lazy-loads the
// BuilderLauncher (a compile-time-gated chunk), and the launcher lazy-loads
// the Builder itself; looking only one level deep reported "no dynamic Builder
// chunk" against a build that lazy-loads it exactly as intended.
const dynamicBuilderEntries = [];
const allImportsFromStaticGraph = new Set();
const dynamicQueue = [];
for (const key of staticGraph) {
  const entry = manifestEntry(key);
  for (const imported of entry.dynamicImports ?? []) dynamicQueue.push(imported);
}
while (dynamicQueue.length > 0) {
  const imported = dynamicQueue.shift();
  if (allImportsFromStaticGraph.has(imported)) continue;
  allImportsFromStaticGraph.add(imported);
  const entry = manifestEntry(imported);
  for (const next of entry.imports ?? []) dynamicQueue.push(next);
  for (const next of entry.dynamicImports ?? []) dynamicQueue.push(next);
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

// The Builder route may boot straight into the editor, but it must still get
// there by dynamic import — otherwise the shared chunks it pulls in start
// carrying editor code that index.html also loads.
if (builderRouteKey) {
  const routeGraph = collectStaticGraph(builderRouteKey);
  const routeStaticBuilder = [];
  for (const key of routeGraph) {
    const entry = manifestEntry(key);
    if (entryHasBuilderOwnedSource(key, entry)) routeStaticBuilder.push(`${key} -> ${entry.file}`);
  }
  if (routeStaticBuilder.length > 0) {
    fail(`builder.html statically includes Builder-owned modules: ${routeStaticBuilder.join(', ')}`);
  }
}

console.log(
  `Builder bundle boundary passed: playerEntry=${entryKey}, builderRoute=${
    builderRouteKey ?? 'none'
  }, staticChunks=${staticGraph.size}, builderChunks=${[...builderFileSet].join(', ')}`,
);
