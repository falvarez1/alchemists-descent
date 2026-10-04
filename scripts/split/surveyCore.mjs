// The split survey as a function (docs/split/SPLIT-PLAN.md): resolve every import in src/ (static, type-only,
// dynamic, import.meta.glob), give each module its owner from ownership.mjs, and list every import that crosses a
// boundary the target layout forbids. survey.mjs is the command line; tests/split-boundaries.test.ts is the ratchet.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, SEAM_OWNERS, SEAM_RE, owner } from './ownership.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_PATH = join(ROOT, 'scripts', 'split', 'baseline.json');

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]([^'"`]+)['"`]\s*\)|import\.meta\.glob(?:<[^>]*>)?\(\s*\[?\s*['"]([^'"]+)['"]/g;
const TEST_IMPORT_RE = /(?:from\s+|import\(\s*)['"](@\/[^'"]+|\.\.\/src\/[^'"]+)['"]/g;
const ARENA_SCRIPT = /duel|arena|fighter|versus|stock|foundry|lobby|fight-|loadout/i;

export function survey(root = ROOT) {
  const SRC = join(root, 'src');
  const rel = (p) => relative(SRC, p).split(sep).join('/');
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(SRC);

  const resolveSpec = (from, spec) => {
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
  };

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
    graph[rel(f)] = { lines: text.split('\n').length, edges, seamRefs: [...text.matchAll(SEAM_RE)].length };
  }

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
  const seam = modules
    .filter((m) => SEAM_OWNERS.includes(owner(m)) && graph[m].seamRefs)
    .map((m) => ({ module: m, refs: graph[m].seamRefs }))
    .sort((a, b) => b.refs - a.refs);

  // Tests: which package's modules each test imports.
  const tests = {};
  for (const f of readdirSync(join(root, 'tests'))) {
    if (!/\.test\.ts$/.test(f)) continue;
    const owners = new Set();
    for (const m of readFileSync(join(root, 'tests', f), 'utf8').matchAll(TEST_IMPORT_RE)) {
      const spec = m[1].replace(/^@\//, '').replace(/^\.\.\/src\//, '').replace(/\.ts$/, '');
      const hit = [`${spec}.ts`, `${spec}/index.ts`].find((c) => graph[c]);
      if (hit) owners.add(owner(hit));
    }
    const arena = owners.has('clashforged') || owners.has('fighters');
    const side = arena ? (owners.has('descent') ? 'both' : 'clashforged') : owners.has('descent') ? 'descent' : 'engine';
    tests[side] = (tests[side] ?? 0) + 1;
  }
  const scriptNames = readdirSync(join(root, 'scripts')).filter((f) => /\.(mjs|cjs|js)$/.test(f));
  const scripts = { clashforged: scriptNames.filter((f) => ARENA_SCRIPT.test(f)).length, other: scriptNames.filter((f) => !ARENA_SCRIPT.test(f)).length };

  return {
    modules: modules.length,
    packages: byPkg,
    forbiddenEdges: forbidden.length,
    forbiddenByPair: Object.fromEntries(
      Object.entries(pairs)
        .sort((a, b) => b[1].edges - a[1].edges || a[0].localeCompare(b[0]))
        .map(([k, v]) => [k, { edges: v.edges, files: [...v.files].sort() }]),
    ),
    arenaSeamInSharedCode: { files: seam.length, refs: seam.reduce((s, x) => s + x.refs, 0), byModule: seam },
    tests,
    scripts,
    forbidden,
    ownership: Object.fromEntries(modules.map((m) => [m, owner(m)])),
  };
}

/** The numbers the ratchet holds: forbidden edges per pair, and the arena seam's ctx refs in shared code. */
export function ratchetNumbers(report) {
  return {
    forbiddenEdges: report.forbiddenEdges,
    byPair: Object.fromEntries(Object.entries(report.forbiddenByPair).map(([k, v]) => [k, v.edges]).sort((a, b) => a[0].localeCompare(b[0]))),
    arenaSeamRefs: report.arenaSeamInSharedCode.refs,
  };
}

export function readBaseline(path = BASELINE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Compare today's numbers with the recorded baseline. `rises` break the boundary (a new crossing import, or a
 * new ctx.arena call in shared code); `drops` are progress the baseline has not banked yet. Both fail the ratchet:
 * a drop left unrecorded is slack someone else can spend.
 */
export function compareToBaseline(now, base) {
  const rises = [];
  const drops = [];
  const pairs = new Set([...Object.keys(now.byPair), ...Object.keys(base.byPair)]);
  for (const p of [...pairs].sort()) {
    const n = now.byPair[p] ?? 0;
    const b = base.byPair[p] ?? 0;
    if (n > b) rises.push(`${p}: ${b} -> ${n} edges`);
    else if (n < b) drops.push(`${p}: ${b} -> ${n} edges`);
  }
  if (now.arenaSeamRefs > base.arenaSeamRefs) rises.push(`ctx.arena/fighters/versus/duel in shared code: ${base.arenaSeamRefs} -> ${now.arenaSeamRefs} refs`);
  else if (now.arenaSeamRefs < base.arenaSeamRefs) drops.push(`ctx.arena/fighters/versus/duel in shared code: ${base.arenaSeamRefs} -> ${now.arenaSeamRefs} refs`);
  return { rises, drops };
}
