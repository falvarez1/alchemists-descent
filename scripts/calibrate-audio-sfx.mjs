// Mix calibration for the sampled layer.
//
// Each cue below has a design target: the peak it should reach at the
// listener, after the real master chain (glue compressor, limiter, soft clip),
// at default volumes — explosions big, spells and creatures readable,
// footsteps subtle, UI quiet. The script renders every cue offline six times
// (random takes, as the game plays them), averages the peak in dB, and prints
// the effective gain each cue should have to hit its target, next to the
// procedural voice it replaced (for reference only: some procedural voices
// were barely audible by accident).
//
// --write updates src/content/audio/sfxCues.ts: each category's gain moves by
// the median of its measured cues (so unmeasured cues follow their family),
// and each measured cue gets the multiplier that lands it on its target.
//
// Usage (dev server running): node scripts/calibrate-audio-sfx.mjs [--write] [url]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';

const write = process.argv.includes('--write');
const url = process.argv.slice(2).find((a) => a.startsWith('http')) || 'http://localhost:5210/';

/** Target peak per cue (linear, post-chain, source at the listener). */
const TARGETS = {
  'boom.small': 0.24, 'boom.medium': 0.3, 'boom.large': 0.4, 'spell.lightning': 0.25, 'spell.blackhole.implode': 0.21,
  'mat.hollow': 0.13, 'mat.bubble': 0.022, 'mat.shatter': 0.12, 'mat.zap': 0.07, 'mat.ignite': 0.09, 'mat.sizzle': 0.04,
  'mat.steam': 0.045, 'mat.squelch': 0.12, 'mat.splash.small': 0.04, 'mat.splash.big': 0.075, 'mat.drip': 0.025,
  'critter.chirp': 0.015, 'critter.skitter': 0.016,
  'pickup.generic': 0.06, 'pickup.gold': 0.065, 'pickup.chest': 0.09, 'pickup.key': 0.065, 'pickup.potion': 0.07, 'pickup.coin': 0.06,
  'pickup.heart': 0.08, 'ui.learn': 0.085, 'ui.card.pick': 0.035, 'ui.card.slot': 0.05, 'ui.click': 0.035, 'ui.hover': 0.015,
  'ui.toast': 0.03, 'ui.objective': 0.05, 'ui.open': 0.045, 'ui.close': 0.04, 'ui.pause': 0.04, 'ui.resume': 0.04,
  'world.portal': 0.2, 'world.gong': 0.22, 'world.waystone': 0.09, 'mech.lever': 0.07, 'mech.door': 0.1, 'mech.groan': 0.1,
  'mech.plate': 0.07, 'wand.dry': 0.06, 'wand.swap': 0.05,
  'player.sputter': 0.05, 'player.heartbeat': 0.12, 'player.step.stone': 0.03, 'player.step.soft': 0.025, 'player.step.wet': 0.03,
  'player.step.wood': 0.03, 'player.crawl': 0.02, 'player.cramped': 0.05, 'player.land.soft': 0.05, 'player.land.hard': 0.1,
  'player.hurt': 0.13, 'player.jump': 0.045, 'player.kick': 0.09, 'player.slam': 0.2, 'player.gear': 0.012,
  'spell.spark.cast': 0.085, 'spell.spark.impact': 0.08, 'spell.frostshard.cast': 0.08, 'spell.meteor.cast': 0.12,
  'trick.whip': 0.07, 'trick.shellcrack': 0.23,
  'creature.generic.alert': 0.04, 'creature.hit': 0.07, 'creature.hop': 0.03, 'creature.weaver.step': 0.03,
  'creature.weaver.chirr': 0.05, 'creature.weaver.alert': 0.07, 'creature.weaver.death': 0.12, 'creature.rillback.move': 0.035,
  'creature.rootloper.step': 0.035, 'creature.stonemaw.chew': 0.06, 'creature.bat.alert': 0.04,
  'stinger.alchemy': 0.12, 'stinger.phialCrack': 0.12, 'stinger.phialFill': 0.1,
  // Wave 2 (the light wave, organisms, the rebuilt bosses), as landed: a tell reads like an alert,
  // a snap like a bite, the lantern like the alchemist's other small verbs, a boss blow under a blast.
  'light.lantern.hood': 0.066, 'light.eyeshine': 0.037, 'light.photocell.latch': 0.11, 'light.bloom.open': 0.085,
  'organism.snapjaw.tell': 0.073, 'organism.snapjaw.snap': 0.095, 'organism.puffer.burst': 0.098, 'organism.leech.latch': 0.076,
  'organism.isopod.curl': 0.035, 'creature.bat.scatter': 0.076, 'creature.colossus.stomp': 0.29, 'creature.colossus.roar': 0.265,
  'creature.leviathan.surge': 0.216,
  // Flora: a notch's strain reads like a tell, the crack like a hard hit, the fall under a medium
  // blast; leaves and seeds sit with the drips and splashes; brushing past is a footstep's weight.
  'flora.creak': 0.06, 'flora.lean': 0.08, 'flora.crack': 0.16, 'flora.hinge': 0.1, 'flora.sapling': 0.06, 'flora.whoosh': 0.08,
  'flora.fall.birch': 0.22, 'flora.fall.mushroom': 0.22, 'flora.fall.mangrove': 0.22, 'flora.fall.emberbark': 0.22,
  'flora.canopy': 0.08, 'flora.settle': 0.05, 'flora.rustle': 0.04, 'flora.pod.drop': 0.04, 'flora.glowseed': 0.065,
  'flora.seed.soak': 0.03, 'flora.seed.sprout': 0.07, 'flora.ladder.rung': 0.05, 'flora.ladder.bloom': 0.07,
  'flora.catch': 0.09, 'flora.firelily.flare': 0.08, 'flora.brush.grass': 0.03, 'flora.brush.reeds': 0.035, 'flora.brush.kelp': 0.03,
};

const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
let rows;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.ctx && document.body.classList.contains('entry-active'), null, { timeout: 60000 });
  const box = await page.locator('#expedition-entry [data-entry="begin"]').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__game.ctx.state.mode === 'play' && window.__game.ctx.levels.current, null, { timeout: 60000 });
  const packs = ['ui', 'player', 'spells', 'world', 'creature-weaver', 'creature-rillback', 'creature-rootloper', 'creature-stonemaw', 'creature-bat',
    'creature-colossus', 'creature-leviathan', 'org-snapjaw', 'org-puffer', 'org-leech', 'org-isopod', 'flora'];
  await page.evaluate((p) => window.__game.ctx.audio.requestPacks(p), packs);
  await page.waitForFunction((p) => p.every((k) => window.__game.ctx.audio.debugSamples().packs[k] === 'ready'), packs, { timeout: 60000, polling: 250 });
  rows = await page.evaluate(async (targets) => {
    const a = window.__game.ctx.audio;
    const out = [];
    for (const [id, target] of Object.entries(targets)) {
      let sumDb = 0;
      const N = 6;
      for (let i = 0; i < N; i++) {
        const r = await a.debugRenderOffline(4, () => a.sfx(id));
        sumDb += 20 * Math.log10(Math.max(1e-6, r.peak));
      }
      out.push({ id, target, peak: 10 ** (sumDb / N / 20) });
    }
    return out;
  }, TARGETS);
} finally {
  await browser.close();
}

// Current effective gains straight from the catalog.
const { SFX_CUES, SFX_CATEGORIES } = await import('../src/content/audio/sfxCues.ts');
const effective = (id) => SFX_CATEGORIES[SFX_CUES[id].cat].gain * (SFX_CUES[id].gain ?? 1);
// 1. The effective gain each measured cue should have.
const wanted = {};
for (const r of rows) {
  const d = 20 * Math.log10(r.target / r.peak);
  // The chain compresses loud cues: move them 80% of the way per pass.
  wanted[r.id] = { d, now: effective(r.id), next: effective(r.id) * 10 ** ((d * (r.target > 0.18 ? 0.8 : 1)) / 20) };
}
// 2. Each category moves by the median of its measured cues, so the cues
//    nobody measured (other creatures, other mechanisms) follow their family.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const catGain = {};
for (const cat of Object.keys(SFX_CATEGORIES)) {
  const ratios = Object.entries(wanted).filter(([id]) => SFX_CUES[id].cat === cat).map(([, w]) => w.next / w.now);
  catGain[cat] = +(SFX_CATEGORIES[cat].gain * (ratios.length ? median(ratios) : 1)).toFixed(3);
}
console.log('category gains:', Object.entries(catGain).map(([c, g]) => `${c} ${SFX_CATEGORIES[c].gain}→${g}`).join(', '));
// 3. Per-cue multipliers against the new category gains.
console.log('cue'.padEnd(26), 'peak', '  target', '  Δ dB', '  gain now', ' gain new', ' multiplier');
const updates = {};
for (const r of rows) {
  const w = wanted[r.id];
  const mult = w.next / catGain[SFX_CUES[r.id].cat];
  updates[r.id] = +mult.toFixed(2);
  console.log(r.id.padEnd(26), r.peak.toFixed(3), r.target.toFixed(3).padStart(7), w.d.toFixed(1).padStart(6), w.now.toFixed(3).padStart(9), w.next.toFixed(3).padStart(9), mult.toFixed(2).padStart(10));
}

if (write) {
  const file = fileURLToPath(new URL('../src/content/audio/sfxCues.ts', import.meta.url));
  let src = readFileSync(file, 'utf8');
  for (const [cat, gain] of Object.entries(catGain)) {
    src = src.replace(new RegExp(`(\n  ${cat}: \{ bus: '[a-z]+', gain: )[0-9.]+`), `$1${gain}`);
  }
  for (const [id, mult] of Object.entries(updates)) {
    const esc = id.replace(/\./g, '\\.');
    const line = new RegExp(`(  '${esc}': [a-z]+\\((?:[^()]|\\([^()]*\\))*?)\\)(,\\r?\\n)`);
    const m = line.exec(src);
    if (!m) { console.warn('no catalog line for', id); continue; }
    let entry = m[1];
    if (/gain: [0-9.]+/.test(entry)) entry = entry.replace(/gain: [0-9.]+/, `gain: ${mult}`);
    else if (/\{ /.test(entry)) entry = entry.replace(/\{ /, `{ gain: ${mult}, `);
    else entry = entry.replace(/\(([^()]*)$/, (all, args) => `(${args}${args.trim() ? ', ' : ''}{ gain: ${mult} }`);
    src = src.replace(m[0], `${entry})${m[2]}`);
  }
  writeFileSync(file, src);
  console.log(`\nwrote ${Object.keys(updates).length} gain multipliers to sfxCues.ts`);
}
