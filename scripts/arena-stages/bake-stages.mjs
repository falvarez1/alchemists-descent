// Bake every Duel stage slab from its source in docs/arena/platform-fighter/stage-sources/ with the parameters below,
// then regenerate src/content/arena/stageSlabs.generated.ts. The parameters ARE the stage's proportions: --depth sets the
// hull depth in cells (the concept's, measured against a 19-cell fighter in concepts/stages.png and foundry-match.png),
// --width the platform's width, and --repeat the plain mid-span column ranges (source px) tiled to get from one to the
// other. --lamps boxes name warm lanterns (their glass shares a hue with lit copper and gilt). See STAGES.md.
// Usage: node scripts/arena-stages/bake-stages.mjs [stage ...] [--preview <dir>]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SLABS = [
  // The Foundry (foundry-match.png): hull ~2.3 fighters deep; the side is a thin beam on a small truss.
  ['foundry', 'main', ['--width', '480', '--depth', '44', '--repeat', '575,845;980,1075;980,1075;2765,2860;2765,2860;2995,3265']],
  ['foundry', 'side', ['--width', '160', '--depth', '13', '--repeat', '470,735;2338,2603']],
  // The Kiln: a thick brick-and-iron body band over a squat X-truss (a post-and-bay each side of the centre repeats with
  // the plain band); its ledges are thick bands (already concept-deep).
  ['kiln', 'main', ['--width', '420', '--depth', '38', '--repeat', '300,580;1597,1845;1993,2241;3260,3540', '--glass', '#f0a020', '--glass-tol', '140', '--glass-lum', '120', '--lamps', '780,780,950,1040;2890,780,3060,1040']],
  ['kiln', 'side', ['--width', '150', '--glass', '#f0a020', '--glass-tol', '140', '--glass-lum', '120', '--lamps', '1470,640,1650,880']],
  // The Cistern: a brass walkway over a shallow undercarriage and the ship's wheel.
  ['cistern', 'main', ['--width', '460', '--depth', '38', '--repeat', '436,795;3045,3404']],
  ['cistern', 'side', ['--width', '160', '--depth', '18', '--repeat', '375,674;2364,2663']],
  // The Gallery: pale stone (toned under the bloom threshold), corbel-and-arch modules, amber lanterns, a violet bell jar.
  ['gallery', 'main', ['--width', '440', '--depth', '40', '--repeat', '250,779;3031,3560', '--edge', '#c9ad78', '--max-lum', '0.58', '--glass', '#f0b850', '--glass-tol', '120', '--glass-lum', '150', '--lamps', '950,730,1080,950;2760,730,2890,950']],
  ['gallery', 'side', ['--width', '130', '--edge', '#c9ad78', '--max-lum', '0.58', '--glass', '#f0b850', '--glass-tol', '120', '--glass-lum', '150', '--lamps', '1440,640,1630,880']],
  ['gallery', 'top', ['--width', '120', '--edge', '#c9ad78', '--max-lum', '0.58', '--glass', '#c890d0', '--glass-tol', '120', '--glass-lum', '120', '--lamps', '1440,600,1630,880']],
];

const args = process.argv.slice(2);
const pi = args.indexOf('--preview'), previewDir = pi >= 0 ? args[pi + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && (pi < 0 || i !== pi + 1));
if (previewDir) mkdirSync(previewDir, { recursive: true });
for (const [stage, slab, opts] of SLABS) {
  if (only.length && !only.includes(stage)) continue;
  const src = join('docs/arena/platform-fighter/stage-sources', `${stage}-${slab}.webp`);
  const extra = previewDir ? ['--preview', join(previewDir, `${stage}-${slab}.png`)] : [];
  process.stdout.write(execFileSync('node', ['scripts/arena-stages/bake-slab.mjs', src, '--stage', stage, '--slab', slab, ...opts, ...extra], { encoding: 'utf8' }));
}
process.stdout.write(execFileSync('node', ['scripts/arena-stages/gen-stage-slabs.mjs'], { encoding: 'utf8' }));
