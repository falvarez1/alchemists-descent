// The developer console's travel commands must not exist in the public player build.
//
// `goto`, `skip`, `boss`, `key`, `seq` and the rest register only under `__AUTHORING__` (a compile-time
// constant: dev and `npm run build:authoring` are true, `npm run build` is false), so the player bundle
// must not contain their registrations or their text. This scans the built chunks for strings that only
// those modules carry and says which build it found:
//   play build      (no builder.html)  every marker must be ABSENT from every chunk;
//   authoring build (builder.html)     every marker must be PRESENT (a probe that finds none is checking nothing).
//
// Usage: npm run build && node scripts/verify-console-bundle.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = join(dist, 'assets');
if (!existsSync(assets)) {
  console.error('Console bundle check failed: no dist/assets; run npm run build first');
  process.exit(1);
}

// Strings only the authoring-only console modules (game/console/travel, travelTargets, travelHelp, seq) carry.
const MARKERS = [
  'this run is now a test run',
  'travel to a level; the run is kept',
  'finish this floor the way the exit portal does',
  'seq cannot run another seq',
  'Teleport beside this floor',
  'goto needs a level',
];
// What the player build's console chunk legitimately keeps: the help system and the older commands.
const PLAYER_KEEPS = ['Developer console:', 'Test runs ("taint")'];

const chunks = readdirSync(assets).filter((f) => f.endsWith('.js'));
const sources = new Map(chunks.map((f) => [f, readFileSync(join(assets, f), 'utf8')]));
const authoring = existsSync(join(dist, 'builder.html'));
const where = (needle) => [...sources].filter(([, text]) => text.includes(needle)).map(([file]) => file);

const problems = [];
for (const marker of MARKERS) {
  const found = where(marker);
  if (authoring && found.length === 0) problems.push(`authoring build lacks "${marker}"`);
  if (!authoring && found.length > 0) problems.push(`play build ships "${marker}" in ${found.join(', ')}`);
}
if (!authoring) {
  for (const keep of PLAYER_KEEPS) {
    if (where(keep).length === 0) problems.push(`play build lost "${keep}" (the help system should still ship with the older commands)`);
  }
}

if (problems.length > 0) {
  console.error(`Console bundle check failed (${authoring ? 'authoring' : 'play'} build):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  authoring
    ? `Console bundle check passed: authoring build, the travel commands are present (${chunks.length} chunks scanned)`
    : `Console bundle check passed: play build, none of the travel commands' text or registrations ship (${chunks.length} chunks scanned)`,
);
