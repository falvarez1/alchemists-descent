#!/usr/bin/env node
// The split survey (docs/split/SPLIT-PLAN.md): resolves every import in src/ (static, type-only, dynamic,
// import.meta.glob), assigns each module to the package it is headed for by the first-cut ownership rules
// below, and reports every import that crosses a boundary the target layout forbids.
//
//   node scripts/split/survey.mjs            summary on stdout, full detail in verify-out/split/survey.json
//   node scripts/split/survey.mjs --edges    also print every forbidden edge
//
// The rules are a first cut, not the final map: Phase 0 of the plan turns them into a checked-in ownership
// file and a ratchet test (the forbidden-edge count may only go down).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
const showEdges = process.argv.includes('--edges');

const rel = (p) => relative(SRC, p).split(sep).join('/');
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(SRC);

function resolveSpec(from, spec) {
  spec = spec.split('?')[0];
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // a dependency from node_modules
  if (spec.includes('*')) return `GLOB:${rel(base)}`;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return rel(c);
  }
  if (base.endsWith('.js') && existsSync(`${base.slice(0, -3)}.ts`)) return rel(`${base.slice(0, -3)}.ts`);
  return `UNRESOLVED:${spec}`;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]([^'"`]+)['"`]\s*\)|import\.meta\.glob(?:<[^>]*>)?\(\s*\[?\s*['"]([^'"]+)['"]/g;
const graph = {};
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const edges = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[2] || m[3] || m[4];
    const kind = m[3] ? 'dyn' : m[4] ? 'glob' : m[1] ? 'type' : 'val';
    const to = resolveSpec(f, spec);
    if (to) edges.push({ to, kind });
  }
  graph[rel(f)] = { lines: text.split('\n').length, edges };
}

// ---- first-cut ownership rules (first match wins) ----
// Arena-named modules that are not the arena: campaign test arenas, the lantern, a terrain plane.
const NOT_ARENA = /^(game\/Lantern|world\/(wardenArenas|weaverArena|physicsArena|sandboxArena|looseStock)|render\/terrainArtPlane)\.ts$/;
const ARENA_NAMED = /^(arena|fighters)\/|^render\/(duel|player\/looks)\/|^net\/duel\/|duel|arena|fighter|versus|stock|foundry|lobby/i;
const RULES = [
  ['kernel', /^game\/Game\.ts$/], // the composition root: splits into the engine kernel + one root per app
  ['ui-kit', /^ui\/foundryKit\.ts$/],
  ['fighters', /^fighters\/(?!telemetry\/\w+Harness)|^content\/fighter(s|Bodies|Loadouts|Techniques)\.ts$|^core\/fighter(s|Body)\.ts$|^render\/player\/(looks\/|FighterArt|fighterLook)|^render\/(FighterFx|fighterReveal)\.ts$/],
  ['clashforged', /^config\/ai\w+\.ts$|^game\/console\/(arena|fighters|ai)\.ts$/],
  ['clashforged', (m) => ARENA_NAMED.test(m) && !NOT_ARENA.test(m)],
  ['authoring', /^builder\/|^app\/(AuthorLink\w*|BuilderHost|BuilderLauncher|LinkControl|authorLink\w*|builder\w*)\.ts$|^net\/(AuthorLinkClient|authorLinkProtocol|tuningPatch)\.ts$/],
  ['descent', /^(game|world|ui|content|app)\/|^main\.ts$/],
  ['descent', /^config\/(biomes|difficulty\w*|floorLooks|gen|pacing|worldgraph)\.ts$/],
  ['descent', /^core\/(boons|run|runTaint|progressionPacing|story|grimoireStore)\.ts$/],
  ['descent', /^audio\/(Narrator|narration\w*)\.ts$/],
  ['engine', /./],
];
const owner = (m) => {
  for (const [pkg, rule] of RULES) if (typeof rule === 'function' ? rule(m) : rule.test(m)) return pkg;
  return 'engine';
};
// Who may depend on whom in the target layout (type-only imports count: a package's types are its API).
const ALLOWED = {
  engine: ['engine'],
  'ui-kit': ['ui-kit', 'engine'],
  fighters: ['fighters', 'engine'],
  authoring: ['authoring', 'engine'],
  descent: ['descent', 'engine', 'authoring'],
  clashforged: ['clashforged', 'engine', 'fighters', 'ui-kit', 'authoring'],
  kernel: ['kernel', 'engine', 'descent', 'clashforged', 'fighters', 'ui-kit', 'authoring'],
};

const modules = Object.keys(graph).sort();
const byPkg = {};
for (const m of modules) {
  const p = owner(m);
  byPkg[p] ??= { modules: 0, lines: 0 };
  byPkg[p].modules++;
  byPkg[p].lines += graph[m].lines;
}

const forbidden = [];
for (const m of modules) {
  const from = owner(m);
  for (const e of graph[m].edges) {
    if (/^(GLOB|UNRESOLVED):/.test(e.to)) continue;
    const to = owner(e.to);
    if (!ALLOWED[from].includes(to)) forbidden.push({ from: m, to: e.to, kind: e.kind, pair: `${from}->${to}` });
  }
}
const pairs = {};
for (const f of forbidden) {
  pairs[f.pair] ??= { edges: 0, files: new Set() };
  pairs[f.pair].edges++;
  pairs[f.pair].files.add(f.from);
}

// The arena seam inside shared code: how often the engine-to-be names an arena service through ctx.
const SEAM_RE = /ctx\.(fighters|arena|versus|duel)\b/g;
const seam = [];
for (const m of modules) {
  if (!['engine', 'descent', 'authoring'].includes(owner(m))) continue;
  const n = [...readFileSync(join(SRC, m), 'utf8').matchAll(SEAM_RE)].length;
  if (n) seam.push({ module: m, refs: n });
}
seam.sort((a, b) => b.refs - a.refs);

// Tests: which package's modules each test imports.
const TEST_IMPORT_RE = /(?:from\s+|import\(\s*)['"](@\/[^'"]+|\.\.\/src\/[^'"]+)['"]/g;
const tests = {};
for (const f of readdirSync(join(ROOT, 'tests'))) {
  if (!/\.test\.ts$/.test(f)) continue;
  const owners = new Set();
  for (const m of readFileSync(join(ROOT, 'tests', f), 'utf8').matchAll(TEST_IMPORT_RE)) {
    const spec = m[1].replace(/^@\//, '').replace(/^\.\.\/src\//, '').replace(/\.ts$/, '');
    const hit = [`${spec}.ts`, `${spec}/index.ts`].find((c) => graph[c]);
    if (hit) owners.add(owner(hit));
  }
  const side = owners.has('clashforged') || owners.has('fighters') ? (owners.has('descent') ? 'both' : 'clashforged') : owners.has('descent') ? 'descent' : 'engine';
  tests[side] = (tests[side] ?? 0) + 1;
}
const ARENA_SCRIPT = /duel|arena|fighter|versus|stock|foundry|lobby|fight-|loadout/i;
const scriptNames = readdirSync(join(ROOT, 'scripts')).filter((f) => /\.(mjs|cjs|js)$/.test(f));
const scripts = { clashforged: scriptNames.filter((f) => ARENA_SCRIPT.test(f)).length, other: scriptNames.filter((f) => !ARENA_SCRIPT.test(f)).length };

const report = {
  modules: modules.length,
  packages: byPkg,
  forbiddenEdges: forbidden.length,
  forbiddenByPair: Object.fromEntries(Object.entries(pairs).sort((a, b) => b[1].edges - a[1].edges).map(([k, v]) => [k, { edges: v.edges, files: [...v.files].sort() }])),
  arenaSeamInSharedCode: { files: seam.length, refs: seam.reduce((s, x) => s + x.refs, 0), byModule: seam },
  tests,
  scripts,
  forbidden,
  ownership: Object.fromEntries(modules.map((m) => [m, owner(m)])),
};
mkdirSync(join(ROOT, 'verify-out', 'split'), { recursive: true });
writeFileSync(join(ROOT, 'verify-out', 'split', 'survey.json'), JSON.stringify(report, null, 1));

console.log(`${modules.length} modules`);
for (const [p, v] of Object.entries(byPkg).sort((a, b) => b[1].lines - a[1].lines)) console.log(`  ${p.padEnd(10)} ${String(v.modules).padStart(4)} modules ${String(v.lines).padStart(7)} lines`);
console.log(`forbidden edges: ${forbidden.length}`);
for (const [k, v] of Object.entries(report.forbiddenByPair)) console.log(`  ${k.padEnd(20)} ${String(v.edges).padStart(4)} edges from ${v.files.length} files`);
console.log(`arena seam in shared code: ${report.arenaSeamInSharedCode.refs} ctx refs in ${seam.length} files`);
console.log(`tests: ${JSON.stringify(tests)}; scripts: ${JSON.stringify(scripts)}`);
if (showEdges) for (const f of forbidden) console.log(`  ${f.pair}  ${f.kind}  ${f.from} -> ${f.to}`);
console.log('detail: verify-out/split/survey.json');
