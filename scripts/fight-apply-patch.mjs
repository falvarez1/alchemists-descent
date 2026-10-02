// APPLY A BALANCE PATCH (docs/arena/TELEMETRY-AND-BALANCE.md 3.6): write the `body.<id>.<field>` overrides of a balance-patch.json into
// src/content/fighterBodies.ts. A dry run by default (prints each change); --write edits the file. Only body fields are applied: a kit number
// or a loadout is a decision to make by hand, with the evidence in the pass document.
//
//   node scripts/fight-apply-patch.mjs <tune-dir>/balance-patch.json [--write]
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/fight-apply-patch.mjs <balance-patch.json> [--write]'); process.exit(2); }
const write = process.argv.includes('--write');
const patch = JSON.parse(readFileSync(file, 'utf8'));
const path = 'src/content/fighterBodies.ts';
let src = readFileSync(path, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
let changed = 0, skipped = 0;
for (const [key, value] of Object.entries(patch.overrides)) {
  const m = /^body\.([a-z-]+)\.([A-Za-z]+)$/.exec(key);
  if (!m) { console.log(`skip ${key}: not a body knob (apply by hand)`); skipped++; continue; }
  const [, id, field] = m;
  const entry = new RegExp(`('${id}': tunableBody\\(\\{)([\\s\\S]*?)(\\}\\))`);
  const hit = entry.exec(src);
  if (!hit) { console.log(`skip ${key}: no entry for ${id}`); skipped++; continue; }
  const inner = hit[2];
  const has = new RegExp(`\\b${field}: ([0-9.]+)`).exec(inner);
  const next = has
    ? inner.replace(new RegExp(`\\b${field}: [0-9.]+`), `${field}: ${value}`)
    : inner.replace(/\s*$/, '') + `, ${field}: ${value} `;
  console.log(`${id}.${field}: ${has ? has[1] : '(1)'} -> ${value}`);
  src = src.replace(entry, `$1${next}$3`);
  changed++;
}
if (write) { writeFileSync(path, src.replace(/\r?\n/g, eol)); console.log(`\n${changed} changes written to ${path}${skipped ? `, ${skipped} skipped` : ''}.`); }
else console.log(`\n${changed} changes (dry run: add --write to edit ${path})${skipped ? `, ${skipped} skipped` : ''}.`);
