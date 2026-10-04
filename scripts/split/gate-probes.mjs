#!/usr/bin/env node
// THE SPLIT'S GATE PROBES (docs/split/SPLIT-PLAN.md, section 3): the runtime probes each game must keep green through
// every phase (after the copy, each repository runs its own list). Runs them one at a time (they are CPU-heavy and
// some time out under load) and summarises.
//
//   node scripts/split/gate-probes.mjs [descent|clashforged|all] [url] [--only verify-x,verify-y]
//
// url defaults to http://localhost:5173/. Use a FROZEN worktree's dev server (a src edit hot-reloads a probe's page
// mid-run and the failure looks real). Output of every probe goes to verify-out/split/gates/<probe>.log, the
// summary to verify-out/split/gates/summary.json.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './surveyCore.mjs';

export const GATES = {
  descent: [
    ['verify-runtime-ui'],
    ['verify-tea-machine'],
    ['verify-living-progression'],
    ['verify-run-lifecycle'],
    ['verify-findability-suite'], // npm run verify:findability
    ['verify-builder-expedition'],
    ['verify-authorlink'], // npm run verify:authorlink
    ['verify-title-menu'],
  ],
  clashforged: [
    ['verify-stock-match'],
    ['verify-duel-ui'],
    ['verify-local-versus'],
    ['verify-duel-lan'],
    ['verify-fighter-arena'],
    ['verify-fighter-roster-play'],
    ['verify-duel-audio'],
  ],
};

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--only'));
const which = positional.find((a) => ['descent', 'clashforged', 'all'].includes(a)) ?? 'all';
const url = positional.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5173/';
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const OUT = join(ROOT, 'verify-out', 'split', 'gates');
mkdirSync(OUT, { recursive: true });

const list = (which === 'all' ? [...GATES.descent, ...GATES.clashforged] : GATES[which]).filter(([n]) => !only || only.includes(n));
const results = [];
for (const [name, ...extra] of list) {
  const t0 = Date.now();
  const log = createWriteStream(join(OUT, `${name}.log`));
  let tail = '';
  const code = await new Promise((resolve) => {
    // Probes that save evidence into docs/ by default (the Duel's) write it here instead: a gate run changes no
    // tracked file.
    const env = { ...process.env, PROBE_EVIDENCE_DIR: join(OUT, 'evidence') };
    const child = spawn(process.execPath, [`scripts/${name}.mjs`, url, ...extra], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (b) => { log.write(b); tail = (tail + b.toString()).slice(-4000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (c, sig) => resolve(c ?? (sig ? 1 : 0)));
  });
  log.end();
  const secs = Math.round((Date.now() - t0) / 1000);
  const fails = tail.split('\n').filter((l) => /\bFAIL\b|Error|failed/i.test(l) && !/0 failed/.test(l)).slice(-4);
  results.push({ name, ok: code === 0, code, secs, fails });
  console.log(`${code === 0 ? ' ok ' : 'FAIL'}  ${name.padEnd(28)} ${String(secs).padStart(4)} s${code === 0 ? '' : `  exit ${code}\n        ${fails.join('\n        ')}`}`);
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ url, at: new Date().toISOString(), results }, null, 2));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} gate probes green${bad.length ? `; red: ${bad.map((r) => r.name).join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
