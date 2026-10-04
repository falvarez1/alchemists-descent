// The split survey as a function (docs/split/SPLIT-PLAN.md): resolve every import in src/ (static, type-only,
// dynamic, import.meta.glob), give each module its owner from ownership.mjs, and measure the two prunings the copy
// sets up: what Descent cuts to delete the arena, and what CLASHFORGED can delete at once versus what its kept code
// still imports from the campaign. survey.mjs is the command line.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARENA, CAMPAIGN, SEAM_OWNERS, SEAM_RE, SHARED, owner } from './ownership.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]([^'"`]+)['"`]\s*\)|import\.meta\.glob(?:<[^>]*>)?\(\s*\[?\s*['"]([^'"]+)['"]/g;
const TEST_IMPORT_RE = /(?:from\s+|import\(\s*)['"](@\/[^'"]+|\.\.\/src\/[^'"]+)['"]/g;
const ARENA_SCRIPT = /duel|arena|fighter|versus|stock|foundry|lobby|fight-|loadout/i;

/** A glob's source modules (`GLOB:fighters/kits/*.ts`): only `*` within one folder is used in src today. */
function globTargets(glob, modules) {
  const pattern = glob.slice('GLOB:'.length);
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);
  return modules.filter((m) => re.test(m));
}

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
    else if (spec.startsWith('/src/')) base = join(SRC, spec.slice('/src/'.length));
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
  // Globs that pick up source modules become ordinary edges (the fighter kits, the fighter looks).
  for (const m of modules) {
    graph[m].edges = graph[m].edges.flatMap((e) =>
      e.to.startsWith('GLOB:') ? globTargets(e.to, modules).filter((t) => t !== m).map((to) => ({ to, kind: 'glob' })) : [e],
    ).filter((e) => !e.to.startsWith('UNRESOLVED:'));
  }

  const own = Object.fromEntries(modules.map((m) => [m, owner(m)]));
  const tally = (list) => ({ modules: list.length, lines: list.reduce((s, m) => s + graph[m].lines, 0) });
  const byPkg = {};
  for (const m of modules) {
    byPkg[own[m]] ??= { modules: 0, lines: 0 };
    byPkg[own[m]].modules++;
    byPkg[own[m]].lines += graph[m].lines;
  }

  // ---- Descent: delete the arena. Every import of an arena module from code Descent keeps is a cut. ----
  const arenaModules = modules.filter((m) => ARENA.includes(own[m]));
  const descentCuts = [];
  for (const m of modules) {
    if (ARENA.includes(own[m])) continue;
    for (const e of graph[m].edges) if (ARENA.includes(own[e.to])) descentCuts.push({ from: m, fromOwner: own[m], to: e.to, kind: e.kind });
  }
  const seam = modules
    .filter((m) => SEAM_OWNERS.includes(own[m]) && graph[m].seamRefs)
    .map((m) => ({ module: m, refs: graph[m].seamRefs }))
    .sort((a, b) => b.refs - a.refs);

  // ---- CLASHFORGED: delete the campaign. It keeps the arena and the shared code, and replaces the composition root
  // (game/Game.ts) and the entry (main.ts) with its own; whatever campaign module that kept code still reaches stays
  // until the code that imports it is trimmed. Measured twice: with the Builder (as it is kept today) and without.
  const reach = (roots) => {
    const seen = new Set(roots);
    const queue = [...roots];
    while (queue.length) {
      const m = queue.pop();
      for (const e of graph[m].edges) {
        if (seen.has(e.to) || !graph[e.to] || own[e.to] === 'kernel' || e.to === 'main.ts') continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    return seen;
  };
  const campaignModules = modules.filter((m) => CAMPAIGN.includes(own[m]));
  const keptRoots = modules.filter((m) => ARENA.includes(own[m]) || SHARED.includes(own[m]));
  const withBuilder = reach(keptRoots);
  const withoutBuilder = reach(keptRoots.filter((m) => own[m] !== 'authoring'));
  const campaignReached = campaignModules.filter((m) => withBuilder.has(m));
  const campaignReachedWithoutBuilder = campaignModules.filter((m) => withoutBuilder.has(m));
  // The first campaign module each kept module imports: where the trimming starts.
  const clashCuts = [];
  for (const m of keptRoots) {
    for (const e of graph[m].edges) if (CAMPAIGN.includes(own[e.to])) clashCuts.push({ from: m, fromOwner: own[m], to: e.to, kind: e.kind });
  }
  const countBy = (list, key) => Object.fromEntries(Object.entries(list.reduce((acc, x) => ({ ...acc, [x[key]]: (acc[x[key]] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]));

  // Tests: which side's modules each test imports.
  const tests = { descent: [], clashforged: [], both: [], shared: [] };
  for (const f of readdirSync(join(root, 'tests'))) {
    if (!/\.test\.ts$/.test(f)) continue;
    const owners = new Set();
    for (const m of readFileSync(join(root, 'tests', f), 'utf8').matchAll(TEST_IMPORT_RE)) {
      const spec = m[1].replace(/^@\//, '').replace(/^\.\.\/src\//, '').replace(/\.ts$/, '');
      const hit = [`${spec}.ts`, `${spec}/index.ts`].find((c) => graph[c]);
      if (hit) owners.add(own[hit]);
    }
    const arena = [...owners].some((o) => ARENA.includes(o));
    const campaign = [...owners].some((o) => CAMPAIGN.includes(o));
    tests[arena ? (campaign ? 'both' : 'clashforged') : campaign ? 'descent' : 'shared'].push(f);
  }
  const scriptNames = readdirSync(join(root, 'scripts')).filter((f) => /\.(mjs|cjs|js)$/.test(f));

  return {
    modules: modules.length,
    packages: byPkg,
    descent: {
      deletes: tally(arenaModules),
      cuts: descentCuts.length,
      cutsByOwner: countBy(descentCuts, 'fromOwner'),
      cutFiles: [...new Set(descentCuts.map((c) => c.from))].sort(),
      seam: { files: seam.length, refs: seam.reduce((s, x) => s + x.refs, 0), byModule: seam },
      cutList: descentCuts,
    },
    clashforged: {
      campaign: tally(campaignModules),
      deletesAtOnce: tally(campaignModules.filter((m) => !withBuilder.has(m))),
      keptUntilTrimmed: tally(campaignReached),
      keptUntilTrimmedWithoutBuilder: tally(campaignReachedWithoutBuilder),
      cuts: clashCuts.length,
      cutsByOwner: countBy(clashCuts, 'fromOwner'),
      keptList: campaignReached,
      cutList: clashCuts,
    },
    tests: Object.fromEntries(Object.entries(tests).map(([k, v]) => [k, v.length])),
    testFiles: tests,
    scripts: { clashforged: scriptNames.filter((f) => ARENA_SCRIPT.test(f)).length, other: scriptNames.filter((f) => !ARENA_SCRIPT.test(f)).length },
    ownership: own,
  };
}
