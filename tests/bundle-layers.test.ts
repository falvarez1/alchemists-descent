import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { WORLD_LAYER, WORLD_LAYER_EXCLUDED } from '../vite.config';

/**
 * THE BOOT BUNDLE'S SHAPE (vite.config.ts, game/playSystems).
 *
 * A static import is all it takes to undo a code split: one `import { Grimoire }`
 * back in Game.ts and the play systems chunk quietly rejoins the boot download.
 * And the `world` chunk is only safe while the world layer imports nothing
 * from the game above it — one import upward and the two boot chunks import
 * each other, which is how circular-chunk evaluation-order bugs start. This
 * reads the source's static import graph (type-only imports excluded) and
 * holds both lines.
 */
const SRC = join(__dirname, '..', 'src');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });

const rel = (file: string): string => relative(SRC, file).split('\\').join('/');

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = join(dirname(from), spec);
  else return null;
  base = base.replace(/\?.*$/, '');
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return rel(candidate);
  }
  return null;
}

/** Static VALUE imports (and side-effect imports) per module, as src-relative paths. */
function staticGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const file of walk(SRC)) {
    const out = new Set<string>();
    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[1]) continue; // import type / export type
      const spec = m[4] ?? m[3];
      const clause = m[2] ?? '';
      const braces = /^\{([\s\S]*)\}$/.exec(clause);
      if (braces && braces[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
      const target = resolveSpec(file, spec);
      if (target) out.add(target);
    }
    graph.set(rel(file), out);
  }
  return graph;
}

const inWorldLayer = (path: string): boolean => WORLD_LAYER.test(path) && !WORLD_LAYER_EXCLUDED.test(path);

describe('the boot bundle', () => {
  const graph = staticGraph();

  it('keeps the world layer closed: it never imports the game, UI or render layers', () => {
    const upward: string[] = [];
    for (const [from, targets] of graph) {
      if (!inWorldLayer(from)) continue;
      for (const to of targets) if (!inWorldLayer(to) && !/\.css$/.test(to)) upward.push(`${from} -> ${to}`);
    }
    expect(upward).toEqual([]);
  });

  it('leaves the lazy chunks out of the boot graph', () => {
    const reach = new Set<string>(['main.ts']);
    const stack = ['main.ts'];
    while (stack.length) {
      for (const next of graph.get(stack.pop()!) ?? []) {
        if (!reach.has(next)) { reach.add(next); stack.push(next); }
      }
    }
    expect(reach.has('game/Game.ts')).toBe(true);
    const lazy = [
      'game/playSystems.ts',
      'game/story/StoryDirector.ts',
      'audio/MusicDirector.ts',
      'audio/Narrator.ts',
      'ui/Grimoire.ts',
      'ui/Sanctum.ts',
      'ui/HelpOverlay.ts',
      'game/console/commands.ts',
      'app/AuthorLink.ts',
      'render/WebGpuRenderBackend.ts',
      'render/WebGpuComposeBridge.ts',
      'world/virtual/index.ts',
    ];
    expect(lazy.filter((path) => reach.has(path))).toEqual([]);
  });

  it('names real modules (a renamed file must not silently drop out of these checks)', () => {
    for (const path of ['game/playSystems.ts', 'game/console/commands.ts', 'render/WebGpuRenderBackend.ts', 'world/virtual/index.ts']) {
      expect(graph.has(path), path).toBe(true);
    }
    expect(inWorldLayer('world/CaveGenerator.ts')).toBe(true);
    expect(inWorldLayer('game/Game.ts')).toBe(false);
  });
});
