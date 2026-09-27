// The narrator's lines, gathered from the game's own source — never re-typed.
//
// Exported constants and pure functions are imported for real (an esbuild
// bundle of src/, the same code the game runs). Copy that lives only as a
// literal inside a system (the Tea Engine's acts, a boss's last toast) is read
// out of the TypeScript AST, so an edit to the copy changes the catalog. The
// narrator keys clips by src/audio/narrationText.narrationKey — bundled from
// the same module — so the game can voice exactly the text it shows.
//
//   node scripts/audio/voice-lines.mjs            # print the catalog and its size
//
// Each line: { key, text (as shown, the key's source), say (what the voice
// actor reads, with sparing eleven_v3 audio tags), group, takes, captioned }.

import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

async function loadGameModules() {
  const entry = `
export { GAME_TAGLINE } from '@/config/brand';
export { FLOOR_LOOKS } from '@/config/floorLooks';
export { LEVELS, CAMPAIGN_FLOORS, floorDisplayName } from '@/config/worldgraph';
export { FLOOR_LORE } from '@/content/floorLore';
export { knownDeathCauseSources, deathTitle, deathCauseLine } from '@/ui/deathCauses';
export { runHeadline, buildRunSummary, VICTORY_EPITAPH } from '@/game/runRules';
export { KIT_DEFS, KIT_ORDER, DEFAULT_KIT } from '@/content/kits';
export { narrationKey, normalizeNarration, arrivalLine } from '@/audio/narrationText';
`;
  const tmp = await mkdtemp(join(tmpdir(), 'bw-voice-'));
  try {
    const entryPath = join(tmp, 'entry.ts');
    await writeFile(entryPath, entry, 'utf8');
    const out = join(tmp, 'bundle.mjs');
    await build({
      entryPoints: [entryPath], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent',
      alias: { '@': SRC }, define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' },
    });
    return await import(pathToFileURL(out).href);
  } finally {
    // The module is already evaluated; the temp dir can go.
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ---------------- AST helpers: string literals where they live ---------------- */

async function parse(rel) {
  const file = join(SRC, rel);
  return ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);

/** The initializer of `const NAME = …` at any depth. */
function constInitializer(sf, name) {
  let found = null;
  walk(sf, (n) => { if (!found && ts.isVariableDeclaration(n) && n.name.getText(sf) === name) found = n.initializer; });
  if (!found) throw new Error(`${sf.fileName}: no const ${name}`);
  return found;
}

/** A class method or function body by name. */
function member(sf, name) {
  let found = null;
  walk(sf, (n) => {
    if (found) return;
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(sf) === name) found = n;
  });
  if (!found) throw new Error(`${sf.fileName}: no method ${name}`);
  return found;
}

/** Every `emit('toast', { text: X })` in a file: literals as strings, templates as their source. */
function toasts(sf) {
  const out = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !n.expression.getText(sf).endsWith('.emit') || literal(n.arguments[0]) !== 'toast') return;
    const obj = n.arguments[1];
    if (!obj || !ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p) || p.name.getText(sf) !== 'text') continue;
      const lit = literal(p.initializer);
      if (lit !== null) out.push({ text: lit });
      else if (ts.isTemplateExpression(p.initializer)) out.push({ template: p.initializer.getText(sf) });
    }
  });
  return out;
}

/** Every literal `emit('combatCallout', { text: '…' })` in a file (a boss's phase beats). */
function callouts(sf) {
  const out = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !n.expression.getText(sf).endsWith('.emit') || literal(n.arguments[0]) !== 'combatCallout') return;
    const obj = n.arguments[1];
    if (!obj || !ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'text' && literal(p.initializer) !== null) out.push(literal(p.initializer));
    }
  });
  return out;
}

/** String literal first arguments of calls to `this.<method>(…)` (both arms of a `cond ? 'a' : 'b'` count). */
function callArgs(sf, method) {
  const out = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || n.expression.getText(sf) !== `this.${method}`) return;
    const arg = n.arguments[0];
    const options = arg && ts.isConditionalExpression(arg) ? [arg.whenTrue, arg.whenFalse] : [arg];
    for (const o of options) { const lit = literal(o); if (lit) out.push(lit); }
  });
  return out;
}

/** Fill a template literal's source with named values (`${KIT_DEFS[kit].name}` with { KIT_DEFS, kit }). */
function expand(templateSource, scope) {
  return new Function(...Object.keys(scope), `return ${templateSource};`)(...Object.values(scope));
}

/* ---------------- delivery: sparing eleven_v3 tags ---------------- */

/** What the actor reads. Shouted toasts become sentences; a few lines get a tag. */
function delivery(text, tag) {
  let say = text.trim();
  if (say === say.toUpperCase() && /[A-Z]/.test(say)) say = say.charAt(0) + say.slice(1).toLowerCase();
  if (!/[.!?…]$/.test(say)) say += '.';
  say = say.replace(/ & /g, ' and ');
  return tag ? `[${tag}] ${say}` : say;
}

/** The few lines that earn a performance note. Everything else is read plainly — the voice carries the dryness. */
const TAGS = [
  [/^Please mind the duck/, 'dryly'],
  [/^This is probably enough heat/, 'dryly'],
  [/^A slight technical difficulty/, 'sighs'],
  [/Classic wizard candle behavior/, 'dryly'],
  [/Zero stars, no refund/, 'dryly'],
  [/The glob was smug about it/, 'dryly'],
  [/humiliating, but documented/, 'dryly'],
  [/Victory explosion\. Timing could improve/, 'dryly'],
  [/^Copied\./, 'dryly'],
  [/The Leviathan surfaced for a snack/, 'dryly'],
  [/^The Kiln is quiet/, 'softly'],
  [/kettle is finally allowed to boil/, 'warmly'],
  [/^Something is alive in the old refinery/, 'softly'],
  [/^The Sunken Leviathan\. It drains poorly/, 'whispers'],
  [/The Rot Gardens are not decorative/, 'dryly'],
  [/You were standing in the chimney/, 'dryly'],
  [/^Timber\. The creak was/, 'dryly'],
];
const tagFor = (text) => TAGS.find(([re]) => re.test(text))?.[1];

/* ---------------- the catalog ---------------- */

export async function buildCatalog() {
  const g = await loadGameModules();
  const lines = new Map();
  const add = (text, group, { takes = 1, captioned = false, say } = {}) => {
    const clean = String(text).trim();
    if (!clean) return;
    const key = g.narrationKey(clean);
    const prior = lines.get(key);
    if (prior) { prior.takes = Math.max(prior.takes, takes); return; }
    lines.set(key, { key, text: clean, say: say ?? delivery(clean, tagFor(clean)), group, takes, captioned });
  };

  // The title card on the entrance.
  add(g.GAME_TAGLINE, 'Title', { takes: 2 });

  // Arrivals: the floor's name and its epigraph, as the title card shows them.
  for (const id of g.CAMPAIGN_FLOORS) {
    const look = g.FLOOR_LOOKS[g.LEVELS[id].biome];
    add(g.arrivalLine(g.floorDisplayName(id), look.epigraph), 'Floor arrivals', { takes: 2 });
  }

  // The Sanctum's look at the floor below (floor 1 is never "below").
  for (const id of g.CAMPAIGN_FLOORS.slice(1)) add(g.FLOOR_LORE[id].line, 'Sanctum');

  // Boss name beats: the resident line as the boss wakes (no on-screen text, so captioned),
  // the boss objective, and the toast each one leaves behind.
  for (const [id, boss] of [['d3', 'leviathan'], ['d4', 'colossus']]) add(g.FLOOR_LORE[id].resident, `Bosses · ${boss}`, { captioned: true });
  const levels = await parse('game/Levels.ts');
  walk(member(levels, 'bossObjective'), (n) => { if (ts.isReturnStatement(n) && literal(n.expression)) add(literal(n.expression), 'Bosses'); });
  for (const t of toasts(await parse('entities/Enemies.ts'))) if (t.text && /SUMP|KILN/.test(t.text)) add(t.text, 'Bosses');
  // A boss's phase beats, as the callouts over its body name them (the armour bursts, the pool shorts, the kiln cracks).
  for (const rel of ['creatures/bosses/colossus.ts', 'creatures/bosses/leviathan.ts', 'entities/kilnQuench.ts']) {
    for (const text of callouts(await parse(rel))) add(text, 'Bosses · phases');
  }

  // The Unreasonable Bell & Tea Engine: every act's title, the first and last acts' instructions,
  // the stall, the three faults' prompts, and its toasts.
  const tea = await parse('game/TeaMachine.ts');
  const acts = constInitializer(tea, 'ACTS').elements.map((pair) => pair.elements.map(literal));
  acts.forEach(([title]) => add(title, 'Tea Engine · acts'));
  add(acts[0][1], 'Tea Engine · acts');
  add(acts[acts.length - 1][1], 'Tea Engine · acts');
  walk(member(tea, 'publish'), (n) => { const s = literal(n); if (s && s.includes(' ') && s.length > 12) add(s, 'Tea Engine · faults'); });
  walk(member(tea, 'faultView'), (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(tea) === 'prompt' && literal(n.initializer)) add(literal(n.initializer), 'Tea Engine · faults');
  });
  const faults = callArgs(tea, 'fault');
  for (const s of callArgs(tea, 'primePan')) add(s, 'Tea Engine · toasts');
  for (const t of toasts(tea)) {
    if (t.text) add(t.text, 'Tea Engine · toasts');
    else if (/\$\{text\}/.test(t.template)) for (const text of faults) add(expand(t.template, { text }), 'Tea Engine · toasts');
  }

  // The death screen: every cause's title and every variant of its line.
  for (const source of g.knownDeathCauseSources()) {
    if (source === 'probe') continue; // a debug tool's own death, never a player's
    add(g.deathTitle(source), 'Death · titles');
    for (let i = 0, first = null; i < 12; i++) {
      const line = g.deathCauseLine(source, i);
      if (i > 0 && line === first) break;
      first ??= line;
      add(line, 'Death · causes');
    }
  }
  add(g.deathTitle(null), 'Death · titles');

  // The ledger: headlines for every way a run ends, and the epitaphs that are not a cause line.
  const summary = (outcome, extra = {}) => g.buildRunSummary({ outcome, seed: 1, daily: null, kit: g.DEFAULT_KIT, floor: 1, floorName: 'The Bellows',
    floorsTotal: g.CAMPAIGN_FLOORS.length, timeMs: 0, kills: 0, alchemicalKills: 0, bestChain: 0, deaths: 0, gold: 0, cardsFound: 0, ...extra });
  add(g.runHeadline({ outcome: 'victory', floorName: g.floorDisplayName('d4') }), 'Ledger', { takes: 2 });
  add(g.VICTORY_EPITAPH, 'Ledger', { takes: 2 });
  for (const id of g.CAMPAIGN_FLOORS) {
    add(g.runHeadline({ outcome: 'fallen', floorName: g.floorDisplayName(id) }), 'Ledger');
    add(g.runHeadline({ outcome: 'abandoned', floorName: g.floorDisplayName(id) }), 'Ledger');
  }
  add(summary('abandoned', { deaths: 0 }).epitaph, 'Ledger');
  add(summary('abandoned', { deaths: 1 }).epitaph, 'Ledger');
  add(summary('fallen', { causeLine: '' }).epitaph, 'Ledger');

  // Kit unlocks: the toast the run director raises, filled with each unlockable case.
  for (const t of toasts(await parse('game/RunDirector.ts'))) {
    if (!t.template || !/KIT_DEFS\[kit\]/.test(t.template)) continue;
    for (const kit of g.KIT_ORDER) if (kit !== g.DEFAULT_KIT) add(expand(t.template, { KIT_DEFS: g.KIT_DEFS, kit }), 'Kit unlocks');
  }

  // The Workshop: its note on the entrance, spoken (captioned) on arrival in the sandbox.
  const entry = await readFile(join(SRC, 'ui', 'ExpeditionEntry.ts'), 'utf8');
  const note = entry.match(/data-entry="workshop"[^>]*>The Workshop<span class="entry-note">([^<]+)<\/span>/)?.[1];
  if (!note) throw new Error('ExpeditionEntry: the Workshop note moved');
  add(note, 'Workshop', { captioned: true });

  return { lines: [...lines.values()], narrationKey: g.narrationKey };
}

/** A short line every narrator candidate reads, so the audition compares like with like. */
export const SAMPLE_LINE = 'The Bellows. The Works draw breath. Mind the pressure. And please, do mind the duck: it has been here longer than you have, and it knows where the tea is kept.';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { lines } = await buildCatalog();
  const groups = new Map();
  for (const l of lines) groups.set(l.group, (groups.get(l.group) ?? 0) + 1);
  for (const l of lines) console.log(`${l.key}  ${l.group.padEnd(22)} ${l.takes > 1 ? `x${l.takes}` : '  '} ${l.captioned ? 'cc' : '  '} ${l.say}`);
  const chars = lines.reduce((s, l) => s + l.say.length * l.takes, 0);
  console.log(`\n${lines.length} lines (${[...groups].map(([k, v]) => `${k} ${v}`).join(', ')}); ${chars} characters with takes.`);
}
