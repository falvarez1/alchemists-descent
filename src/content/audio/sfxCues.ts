/**
 * THE sound-effect catalog: every sampled cue the game can play, with its
 * load pack, mix category and runtime overrides. Prompts and generation
 * settings live beside the generator (scripts/audio/sfx-prompts.mjs); the
 * files themselves are `src/assets/audio/{sfx,ambience}/<pack>/<id>-<n>.mp3`
 * (content/audio/sfxManifest.ts finds them; sfxCatalog.ts resolves the defaults).
 *
 * This module is plain data with type-only imports so the Node generator can
 * import it directly (type stripping) — keep it free of runtime imports.
 *
 * Adding a cue: add it here AND in sfx-prompts.mjs, run the generator, then
 * call `ctx.audio.sfx('<id>')` (tests/audio-sfx.test.ts checks both tables,
 * the files on disk, and every id used in src/).
 */
import type { EnemyKind } from '@/core/types';

/** The mix bus a cue is summed on (audio/mix.ts owns the buses). */
export type SfxBus = 'fx' | 'voices' | 'ambience' | 'ui';

export type SfxCategory =
  | 'ui' | 'stinger' | 'player' | 'step' | 'pickup' | 'spell' | 'impact' | 'explosion'
  | 'material' | 'loop' | 'mechanism' | 'tea' | 'creature' | 'boss' | 'critter' | 'bed';

export interface SfxCategoryDef {
  bus: SfxBus;
  /** Linear playback gain for a normalized file (files are all mastered to the same loudness). */
  gain: number;
  /** Placement range in cells when played at a world position; 0 = unplaced (centre). */
  range: number;
  /** Concurrent instances of one cue; a new one steals the oldest. */
  voices: number;
  /** A retrigger inside this window is dropped (no machine-gun stacking). */
  cooldownMs: number;
  /** Random pitch spread per play, ± cents. */
  pitchCents: number;
  /** Voice-stealing rank when the global pool is full: low yields to high. */
  priority: number;
}

/**
 * Category levels. Files are mastered to one loudness, so these ARE the mix:
 * explosions big, spells and creatures readable, footsteps subtle, UI quiet.
 */
export const SFX_CATEGORIES: Readonly<Record<SfxCategory, SfxCategoryDef>> = {
  ui: { bus: 'ui', gain: 0.143, range: 0, voices: 2, cooldownMs: 45, pitchCents: 20, priority: 4 },
  stinger: { bus: 'ui', gain: 0.475, range: 0, voices: 3, cooldownMs: 0, pitchCents: 0, priority: 5 },
  player: { bus: 'fx', gain: 0.237, range: 0, voices: 2, cooldownMs: 60, pitchCents: 60, priority: 3 },
  step: { bus: 'fx', gain: 0.07, range: 0, voices: 2, cooldownMs: 70, pitchCents: 110, priority: 1 },
  pickup: { bus: 'ui', gain: 0.249, range: 0, voices: 3, cooldownMs: 40, pitchCents: 25, priority: 4 },
  spell: { bus: 'fx', gain: 0.441, range: 450, voices: 4, cooldownMs: 35, pitchCents: 70, priority: 3 },
  impact: { bus: 'fx', gain: 0.38, range: 450, voices: 4, cooldownMs: 45, pitchCents: 90, priority: 2 },
  explosion: { bus: 'fx', gain: 1.121, range: 900, voices: 4, cooldownMs: 55, pitchCents: 80, priority: 5 },
  material: { bus: 'fx', gain: 0.295, range: 380, voices: 3, cooldownMs: 90, pitchCents: 90, priority: 2 },
  loop: { bus: 'fx', gain: 0.34, range: 420, voices: 1, cooldownMs: 0, pitchCents: 0, priority: 2 },
  mechanism: { bus: 'fx', gain: 0.347, range: 520, voices: 3, cooldownMs: 100, pitchCents: 45, priority: 3 },
  tea: { bus: 'fx', gain: 0.36, range: 760, voices: 2, cooldownMs: 120, pitchCents: 0, priority: 3 },
  creature: { bus: 'voices', gain: 0.207, range: 380, voices: 3, cooldownMs: 90, pitchCents: 100, priority: 3 },
  boss: { bus: 'voices', gain: 0.8, range: 720, voices: 2, cooldownMs: 120, pitchCents: 45, priority: 4 },
  critter: { bus: 'ambience', gain: 0.104, range: 260, voices: 3, cooldownMs: 260, pitchCents: 150, priority: 0 },
  bed: { bus: 'ambience', gain: 0.5, range: 0, voices: 1, cooldownMs: 0, pitchCents: 0, priority: 1 },
};

export interface SfxCueDef {
  /** Lazy-load group: `ui`, `player`, `spells`, `world`, `tea`, `flora`, `creature-<kind>`, `org-<kind>`, `amb-<floor>`. */
  pack: string;
  cat: SfxCategory;
  /** Multiplies the category gain. */
  gain?: number;
  range?: number;
  voices?: number;
  cooldownMs?: number;
  pitchCents?: number;
  priority?: number;
  bus?: SfxBus;
  /**
   * A seamless loop. Played through `sfx()` it SUSTAINS: the first call
   * fades it in, every later call keeps it alive, and it fades out once the
   * calls stop for `keepAliveMs`.
   */
  loop?: boolean;
  keepAliveMs?: number;
}

const c = (pack: string, cat: SfxCategory, o: Omit<SfxCueDef, 'pack' | 'cat'> = {}): SfxCueDef => ({ pack, cat, ...o });
const ui = (o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('ui', 'ui', o);
const pl = (cat: SfxCategory, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('player', cat, o);
const sp = (o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('spells', 'spell', o);
const loop = (pack: string, o: Omit<SfxCueDef, 'pack' | 'cat'> = {}): SfxCueDef => c(pack, 'loop', { loop: true, keepAliveMs: 220, ...o });
const wo = (cat: SfxCategory, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('world', cat, o);
const cr = (kind: EnemyKind, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c(`creature-${kind}`, 'creature', o);
const boss = (kind: EnemyKind, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c(`creature-${kind}`, 'boss', o);
const tea = (o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('tea', 'tea', o);
/** Ambient life with behaviour (game/organisms): one pack per kind, loaded with the floors it lives on. */
const org = (kind: string, cat: SfxCategory, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c(`org-${kind}`, cat, o);
/** Living plants (felling, seeds, brush fires, brushing past): the `flora` pack, loaded with every floor. */
const fl = (cat: SfxCategory, o?: Omit<SfxCueDef, 'pack' | 'cat'>): SfxCueDef => c('flora', cat, o);

export const SFX_CUES = {
  'arena.hit.light': c('arena', 'impact', { gain: 1.5, range: 1400, cooldownMs: 30, pitchCents: 35, priority: 5 }),
  'arena.hit.heavy': c('arena', 'impact', { gain: 2.1, range: 1400, cooldownMs: 45, pitchCents: 25, priority: 5 }),
  'arena.shield.block': c('arena', 'impact', { gain: 1.2, range: 1400, cooldownMs: 45, pitchCents: 25, priority: 5 }),
  'arena.shield.break': c('arena', 'impact', { gain: 2, range: 1400, cooldownMs: 150, pitchCents: 10, priority: 5 }),
  'arena.grab': c('arena', 'impact', { gain: 1.1, range: 1400, cooldownMs: 70, pitchCents: 35, priority: 4 }),
  'arena.throw': c('arena', 'impact', { gain: 1.8, range: 1400, cooldownMs: 70, pitchCents: 30, priority: 5 }),
  'arena.hurt.agile': c('arena', 'creature', { gain: 2, range: 1400, cooldownMs: 100, voices: 2, pitchCents: 25, priority: 5 }),
  'arena.hurt.armored': c('arena', 'creature', { gain: 2.15, range: 1400, cooldownMs: 100, voices: 2, pitchCents: 20, priority: 5 }),
  'arena.hurt.duelist': c('arena', 'creature', { gain: 2, range: 1400, cooldownMs: 100, voices: 2, pitchCents: 25, priority: 5 }),
  // The Duel's arcade cabinet (audio/DuelAnnouncer; audio/UiSounds swaps the brass menu ticks for these in the Duel).
  'duel.ui.move': c('arena', 'ui', { gain: 0.9, cooldownMs: 40, voices: 2, pitchCents: 0 }),
  'duel.ui.confirm': c('arena', 'ui', { gain: 1.2, cooldownMs: 60, pitchCents: 0 }),
  'duel.ui.back': c('arena', 'ui', { gain: 1, cooldownMs: 60, pitchCents: 0 }),
  'duel.ui.pause': c('arena', 'ui', { gain: 1.3, cooldownMs: 150, pitchCents: 0 }),
  'duel.ready': c('arena', 'stinger', { gain: 1, cooldownMs: 120 }),
  'duel.join': c('arena', 'stinger', { gain: 1, cooldownMs: 300 }),
  'duel.stage': c('arena', 'stinger', { gain: 0.8, cooldownMs: 120 }),
  'duel.count': c('arena', 'stinger', { gain: 1.1, cooldownMs: 300 }),
  'duel.fight': c('arena', 'stinger', { gain: 1.5, cooldownMs: 500 }),
  'duel.ko': c('arena', 'stinger', { gain: 1.7, cooldownMs: 300 }),
  'duel.game': c('arena', 'stinger', { gain: 1.6, cooldownMs: 800 }),
  'duel.results': c('arena', 'stinger', { gain: 1, cooldownMs: 800 }),
  'duel.super': c('arena', 'stinger', { gain: 1.3, cooldownMs: 250 }),
  // ------------------------------------------------------------------ UI
  'ui.hover': ui({ gain: 0.31, cooldownMs: 60, voices: 1 }),
  'ui.click': ui({ gain: 0.7 }),
  'ui.back': ui(),
  'ui.open': ui({ gain: 1.04 }),
  'ui.close': ui({ gain: 0.7 }),
  'ui.pause': ui({ gain: 1.49 }),
  'ui.resume': ui({ gain: 1.51 }),
  'ui.toast': ui({ gain: 1.3, cooldownMs: 400 }),
  'ui.objective': ui({ gain: 1.46, cooldownMs: 800 }),
  'ui.hint': ui({ cooldownMs: 600 }),
  'ui.grimoire': ui({ gain: 1.2, cooldownMs: 600 }),
  'ui.card.reveal': ui({ gain: 1.4 }),
  'ui.card.choose': ui({ gain: 1.4 }),
  // The Sanctum's two doors (wave 3): a stair chosen.
  'ui.door.choose': ui({ gain: 1.3 }),
  'ui.card.pick': ui({ gain: 0.74 }),
  'ui.card.slot': ui({ gain: 1.1 }),
  // The choice update: a devil's bargain taken (a refit already rings ui.learn through upgradeFrame).
  'ui.card.bargain': ui({ gain: 1.3 }),
  'ui.bench': ui({ gain: 1.1 }),
  'ui.coins': ui({ gain: 1.2 }),
  'ui.tally': ui({ gain: 0.35, cooldownMs: 30, voices: 3 }),
  'ui.learn': c('ui', 'stinger', { gain: 0.75 }),
  'ui.curtain': ui({ gain: 1.3, cooldownMs: 1500 }),
  'ui.phial.refill': c('ui', 'stinger', { gain: 0.5 }),
  'ui.phial.drain': c('ui', 'stinger', { gain: 0.5 }),
  'ui.run.over': c('ui', 'stinger', { gain: 0.55 }),
  'ui.summary.victory': c('ui', 'stinger', { gain: 0.5 }),
  'ui.summary.fallen': c('ui', 'stinger', { gain: 0.5 }),
  'stinger.alchemy': c('ui', 'stinger', { gain: 1.21, voices: 4 }),
  'stinger.phialCrack': c('ui', 'stinger', { gain: 0.68 }),
  'stinger.phialFill': c('ui', 'stinger', { gain: 0.69 }),
  'stinger.victory': c('ui', 'stinger', { gain: 1.1 }),
  'stinger.fallen': c('ui', 'stinger', { gain: 1.1 }),
  'stinger.shutter': c('ui', 'stinger', { gain: 0.8 }),

  // -------------------------------------------------------------- player
  'player.step.stone': pl('step', { gain: 1 }),
  'player.step.soft': pl('step', { gain: 0.96 }),
  'player.step.wet': pl('step', { gain: 1.05 }),
  'player.step.wood': pl('step', { gain: 1.04 }),
  'player.step.metal': pl('step', { gain: 0.9, range: 330 }),
  'player.gear': pl('step', { gain: 0.73, range: 330, cooldownMs: 160 }),
  'player.wade': pl('step', { gain: 1.4, range: 330, cooldownMs: 160 }),
  'player.crawl': pl('step', { gain: 0.74, cooldownMs: 120 }),
  'player.jump': pl('player', { gain: 0.46, cooldownMs: 110 }),
  'player.land.soft': pl('player', { gain: 0.47, cooldownMs: 140 }),
  'player.land.hard': pl('player', { gain: 0.94, cooldownMs: 140 }),
  'player.skid': pl('player', { gain: 0.6 }),
  'player.grab': pl('player', { gain: 0.6 }),
  'player.pullup': pl('player', { gain: 0.6 }),
  'player.cramped': pl('player', { gain: 0.5, cooldownMs: 280 }),
  'player.kick': pl('player', { gain: 1.34 }),
  'player.dive': pl('player', { gain: 0.9 }),
  'player.slam': pl('player', { gain: 2.4, priority: 4 }),
  'player.stomp': pl('player', { gain: 1.2 }),
  'player.hurt': pl('player', { gain: 2.15, cooldownMs: 190, priority: 5 }),
  'player.death': pl('player', { gain: 1.3, priority: 5 }),
  'player.corpse.wand': pl('player', { gain: 0.6 }),
  'player.corpse.knell': c('player', 'stinger', { gain: 0.45 }),
  'player.heartbeat': pl('player', { gain: 1.35, cooldownMs: 380, pitchCents: 0, priority: 5 }),
  'player.sputter': pl('player', { gain: 0.65, cooldownMs: 240 }),
  'player.levitate.loop': loop('player', { gain: 0.9, range: 0, keepAliveMs: 260 }),
  'player.vine': pl('player', { gain: 0.6 }),
  'player.teleport': pl('player', { gain: 1.1 }),
  'player.heal': pl('player', { gain: 0.6, cooldownMs: 140 }),
  'player.drink': pl('player', { gain: 0.8, cooldownMs: 150 }),
  'player.recharge': pl('player', { gain: 0.6, cooldownMs: 300, pitchCents: 0 }),
  'player.recharge.done': c('player', 'stinger', { gain: 0.6 }),
  'player.staff': pl('player', { gain: 0.8, cooldownMs: 80 }),
  'player.glowseed': pl('player', { gain: 0.6 }),
  'player.club.swing': pl('player', { gain: 0.8 }),
  'player.club.hit': pl('player', { gain: 1.1 }),
  'player.club.throw': pl('player', { gain: 0.8 }),
  // THE CHILL (game/Chill, via EventCues): frost taking, freezing solid, the
  // shell cracking and bursting, the thaw, a shivering breath; the wind and
  // the creak of ice rise under the body's cold as a loop the chill holds up.
  'player.chill.crackle': pl('player', { gain: 0.44, voices: 3, cooldownMs: 90, pitchCents: 180 }),
  'player.chill.wind': loop('player', { gain: 1.0, range: 0, bus: 'ambience', keepAliveMs: 400 }),
  'player.chill.shell': pl('player', { gain: 1.35, priority: 5 }),
  'player.chill.crack': pl('player', { gain: 0.66, voices: 3, cooldownMs: 70, pitchCents: 120 }),
  'player.chill.shatter': pl('player', { gain: 1.34, priority: 5 }),
  'player.chill.thaw': pl('player', { gain: 1.0, priority: 4 }),
  'player.chill.breath': pl('player', { gain: 0.5, cooldownMs: 2400 }),
  // The hooded lantern (light wave): the stealth verb is a brass hood.
  'light.lantern.hood': pl('player', { gain: 0.9, cooldownMs: 120, pitchCents: 30 }),
  'light.lantern.unhood': pl('player', { gain: 1.15, cooldownMs: 120, pitchCents: 30 }),
  'flask.siphon.loop': loop('player', { gain: 0.8, range: 0, keepAliveMs: 240 }),
  'flask.pour.loop': loop('player', { gain: 0.8, range: 0, keepAliveMs: 240 }),
  'flask.throw': pl('player', { gain: 0.6 }),
  'flask.shatter': c('player', 'impact', { gain: 1.2 }),
  'flask.dry': pl('player', { gain: 0.6, cooldownMs: 200 }),
  'wand.swap': pl('player', { gain: 0.54, cooldownMs: 110 }),
  'wand.dry': pl('player', { gain: 0.7, cooldownMs: 200 }),
  'pickup.gold': c('player', 'pickup', { gain: 0.93 }),
  'pickup.coin': c('player', 'pickup', { gain: 1.16, voices: 4, cooldownMs: 40, pitchCents: 0 }),
  'pickup.generic': c('player', 'pickup', { gain: 0.9 }),
  'pickup.leg': c('player', 'pickup'),
  'pickup.heart': c('player', 'pickup', { gain: 1.2 }),
  'pickup.chest': c('player', 'pickup', { gain: 1.01 }),
  'pickup.potion': c('player', 'pickup', { gain: 1.25 }),
  'pickup.key': c('player', 'pickup', { gain: 2.1 }),
  'pickup.bell': c('player', 'pickup', { gain: 1.2 }),

  // -------------------------------------------------------------- spells
  'spell.spark.cast': sp({ gain: 0.48, range: 0 }),
  'spell.spark.impact': sp({ gain: 0.52, range: 420, voices: 5 }),
  'spell.bomb.cast': sp({ range: 0 }),
  'spell.bomb.fuse.loop': loop('spells', { gain: 0.7, range: 380, keepAliveMs: 200 }),
  'spell.lightning': sp({ gain: 2.17, range: 800, priority: 4 }),
  'spell.flame.ignite': sp({ gain: 0.9, range: 0, cooldownMs: 250 }),
  'spell.flame.loop': loop('spells', { gain: 1.1, range: 0, keepAliveMs: 300 }),
  'spell.dig.loop': loop('spells', { gain: 0.8, range: 0, keepAliveMs: 200 }),
  'spell.warp.cast': sp({ range: 0 }),
  'spell.blackhole.loop': loop('spells', { gain: 1.1, range: 700, keepAliveMs: 200 }),
  'spell.blackhole.implode': sp({ gain: 1.81, range: 700, priority: 4 }),
  'spell.vitriol.loop': loop('spells', { gain: 0.9, range: 0, keepAliveMs: 220 }),
  'spell.cryojet.loop': loop('spells', { gain: 0.9, range: 0, keepAliveMs: 220 }),
  'spell.aquajet.loop': loop('spells', { gain: 0.9, range: 0, keepAliveMs: 220 }),
  'spell.frostshard.cast': sp({ gain: 1.28, range: 0 }),
  'spell.icelance.cast': sp({ range: 0 }),
  'spell.ice.impact': sp({ gain: 0.9, voices: 4 }),
  'spell.freeze': sp({ gain: 0.9 }),
  'spell.wisp.cast': sp({ range: 0 }),
  'spell.wisp.loop': loop('spells', { gain: 0.5, range: 300, keepAliveMs: 200 }),
  'spell.meteor.cast': sp({ gain: 1.1, range: 0 }),
  'spell.meteor.loop': loop('spells', { gain: 0.9, range: 600, keepAliveMs: 200 }),
  'spell.conjure': sp({ gain: 1.2 }),
  'spell.vitrify': sp({ gain: 1.1 }),
  'spell.emberstorm': sp({ gain: 1.1, range: 0 }),
  'spell.crit.wet': sp({ gain: 0.8 }),
  'spell.crit.shatter': sp({ gain: 0.9 }),
  'spell.crit.pyre': sp({ gain: 0.9 }),
  'spell.charge.electric': sp({ gain: 0.7 }),
  'spell.charge.frost': sp({ gain: 0.7 }),
  'trick.whip': sp({ gain: 0.75, range: 0 }),
  'trick.shellcrack': sp({ gain: 1.19, priority: 4 }),

  // --------------------------------------------------------------- world
  'boom.small': wo('explosion', { gain: 0.6 }),
  'boom.medium': wo('explosion', { gain: 0.85 }),
  'boom.large': wo('explosion', { gain: 1.13, voices: 3 }),
  'mat.zap': wo('material', { gain: 0.87, range: 450, cooldownMs: 70 }),
  'mat.shatter': wo('material', { gain: 1.4, range: 500, cooldownMs: 90 }),
  // Brine eating ice (sim/elements/brine): the salt's soft fizz — the Cold Store's puzzles, audible.
  'mat.brine.fizz': wo('material', { gain: 0.8, range: 320, cooldownMs: 260 }),
  'mat.steam': wo('material', { gain: 0.68, range: 360, cooldownMs: 150 }),
  'mat.sizzle': wo('material', { gain: 0.4, range: 300, cooldownMs: 240 }),
  'mat.ignite': wo('material', { gain: 1, range: 450, cooldownMs: 120 }),
  'mat.squelch': wo('material', { gain: 1.04, cooldownMs: 90 }),
  'mat.bubble': wo('material', { gain: 0.75, range: 260, cooldownMs: 90, bus: 'ambience' }),
  'mat.splash.small': wo('material', { gain: 0.33, cooldownMs: 120 }),
  'mat.splash.big': wo('material', { gain: 0.75, cooldownMs: 160 }),
  'mat.drip': c('world', 'critter', { gain: 1.4, cooldownMs: 400 }),
  'mat.hollow': wo('impact', { gain: 1.1, range: 420, cooldownMs: 160 }),
  'mat.fire.loop': loop('world', { range: 1400, gain: 0.8, bus: 'ambience', keepAliveMs: 700 }),
  'mat.lava.loop': loop('world', { range: 1400, gain: 0.8, bus: 'ambience', keepAliveMs: 700 }),
  'mat.water.loop': loop('world', { range: 1400, gain: 0.7, bus: 'ambience', keepAliveMs: 700 }),
  'mat.acid.loop': loop('world', { range: 1400, gain: 0.6, bus: 'ambience', keepAliveMs: 700 }),
  'mat.steam.loop': loop('world', { range: 1400, gain: 0.6, bus: 'ambience', keepAliveMs: 700 }),
  'mat.electric.loop': loop('world', { range: 1400, gain: 0.6, bus: 'ambience', keepAliveMs: 700 }),
  'mat.fuse.loop': loop('world', { gain: 0.8, range: 1400, keepAliveMs: 700 }),
  'body.impact.wood': wo('impact', { gain: 0.8, range: 380, cooldownMs: 60, voices: 5 }),
  'body.impact.stone': wo('impact', { gain: 0.9, range: 420, cooldownMs: 60, voices: 5 }),
  'body.impact.metal': wo('impact', { gain: 0.8, range: 420, cooldownMs: 60, voices: 5 }),
  'body.smash.wood': wo('impact', { gain: 1.1 }),
  'body.smash.stone': wo('impact', { gain: 1.1 }),
  'body.smash.metal': wo('impact', { gain: 1.0 }),
  'body.bash': wo('impact', { gain: 0.9 }),
  'body.grab': c('world', 'player', { gain: 0.6 }),
  'body.lift': c('world', 'player', { gain: 0.6 }),
  'body.throw': c('world', 'player', { gain: 0.7 }),
  'body.drop': c('world', 'player', { gain: 0.5 }),
  'body.rip': c('world', 'player', { gain: 0.45, cooldownMs: 50 }),
  'body.tear': c('world', 'player', { gain: 0.9 }),
  'body.burnout': wo('impact', { gain: 0.8 }),
  // TELEKINESIS (combat/Telekinesis, via audio/EventCues): the wand's grip is
  // the alchemist's own gesture (unplaced); the hum sits on the held body.
  'tk.grab': c('world', 'player', { gain: 0.95 }),
  'tk.hold.loop': loop('world', { gain: 0.55, range: 420, keepAliveMs: 220 }),
  'tk.hurl': c('world', 'player', { gain: 1.2, cooldownMs: 90 }),
  'tk.release': c('world', 'player', { gain: 0.6 }),
  'tk.fizzle': c('world', 'player', { gain: 0.8, cooldownMs: 200 }),
  'tk.strain': c('world', 'player', { gain: 0.9, cooldownMs: 300 }),
  // CORPSES (creatures/corpseWorld): the dead as mass, placed where it happens.
  'corpse.thud.light': wo('impact', { gain: 0.85, cooldownMs: 70 }),
  'corpse.thud.heavy': wo('impact', { gain: 1.1, cooldownMs: 90 }),
  'corpse.bowl': wo('impact', { gain: 1.3, cooldownMs: 60, priority: 3 }),
  'corpse.splash': wo('material', { gain: 1.1, cooldownMs: 160 }),
  'corpse.ignite': wo('material', { gain: 1.1, cooldownMs: 200 }),
  'corpse.consume': wo('material', { gain: 1.2, cooldownMs: 400 }),
  'corpse.dissolve': wo('material', { gain: 0.9, cooldownMs: 400 }),
  'corpse.freeze': wo('material', { gain: 1.0, cooldownMs: 300 }),
  'corpse.shatter': wo('impact', { gain: 1.3, cooldownMs: 80, priority: 3 }),
  'corpse.twitch': wo('material', { gain: 0.8, cooldownMs: 200 }),
  'world.portal': wo('mechanism', { gain: 2.01, range: 0, priority: 4 }),
  'world.gong': wo('mechanism', { gain: 2.59, range: 0, priority: 4 }),
  'world.waystone': c('world', 'stinger', { gain: 0.92 }),
  'mech.lever': wo('mechanism', { gain: 0.64 }),
  'mech.grip': wo('mechanism', { gain: 0.7 }),
  'mech.door': wo('mechanism', { gain: 1.1, cooldownMs: 200 }),
  'mech.groan': wo('mechanism', { gain: 0.93, range: 620, cooldownMs: 400 }),
  'mech.plate': wo('mechanism', { gain: 0.46 }),
  'mech.scale': wo('mechanism'),
  'mech.buoy': wo('mechanism'),
  'mech.latch': wo('mechanism'),
  'mech.sensor': wo('mechanism', { gain: 0.7 }),
  'mech.counterweight': wo('mechanism', { gain: 1.1 }),
  'mech.vault': wo('mechanism', { gain: 1.1 }),
  'mech.sequence.step': wo('mechanism', { pitchCents: 0 }),
  'mech.sequence.fail': wo('mechanism'),
  'mech.relay.arm': wo('mechanism', { gain: 0.7 }),
  'mech.relay.fire': wo('mechanism'),
  'mech.dispenser': wo('mechanism', { gain: 0.8 }),
  'mech.plug': wo('mechanism', { gain: 1.1 }),
  // THE LOCKS (world/locks): the Gas Bell's clapper (a vault's seal giving way is 'mech.vault').
  'lock.bell': wo('mechanism', { gain: 1.3, range: 520 }),
  'lock.slag': wo('mechanism', { gain: 1.2, range: 520 }),
  'mech.rune': wo('mechanism', { gain: 1.1, range: 0 }),
  'mech.shrine': wo('mechanism', { gain: 0.7, cooldownMs: 600 }),
  'mech.cauldron': wo('mechanism', { gain: 0.9 }),
  // The experiment (game/Brewing): a heated mix judged. Close to something undiscovered, or nothing at all.
  'brew.shimmer': wo('mechanism', { gain: 0.8, cooldownMs: 800 }),
  'brew.fizzle': wo('mechanism', { gain: 0.8, cooldownMs: 800 }),
  // Pell's camp life (the surveyor's idle acts): small, close and human. Rare, so they carry a long cooldown.
  'pell.sneeze': c('world', 'creature', { gain: 1.3, cooldownMs: 3000, pitchCents: 30 }),
  'pell.sip': c('world', 'creature', { gain: 0.9, cooldownMs: 3000, pitchCents: 30 }),
  'critter.chirp': c('world', 'critter', { gain: 1.5 }),
  'critter.skitter': c('world', 'critter', { gain: 0.77 }),
  'creature.hit': c('world', 'impact', { gain: 0.63, range: 380, bus: 'voices' }),
  'creature.gib': c('world', 'impact', { gain: 1.2, range: 420, bus: 'voices' }),
  'creature.dodge': c('world', 'creature', { gain: 0.5, range: 180 }),
  'creature.hop': c('world', 'creature', { gain: 0.38 }),
  'creature.generic.alert': c('world', 'creature', { gain: 1.38, cooldownMs: 300 }),
  'creature.generic.hurt': c('world', 'creature', { gain: 0.8 }),
  'creature.generic.death': c('world', 'creature', { gain: 1.0 }),
  'proj.fireball.loop': loop('world', { gain: 0.7, range: 360, keepAliveMs: 200 }),
  // Light and dark (light wave): the deep dark, eyes in the beam, photocells, lumen blooms.
  'light.dark': wo('material', { gain: 0.9, range: 0, bus: 'ambience', cooldownMs: 12000, pitchCents: 0, priority: 3 }),
  'light.eyeshine': wo('mechanism', { gain: 0.4, range: 380, cooldownMs: 300, pitchCents: 60 }),
  'light.photocell.loop': loop('world', { gain: 0.6, range: 420, keepAliveMs: 250 }),
  'light.photocell.latch': wo('mechanism', { gain: 1.5 }),
  'light.bloom.open': wo('mechanism', { gain: 1.2, cooldownMs: 300 }),
  'light.bloom.furl': wo('mechanism', { gain: 0.5, cooldownMs: 300 }),
  'light.bloom.petal': wo('mechanism', { gain: 0.35, cooldownMs: 60, pitchCents: 0 }),
  // Life on every floor with water or a light: fish schools, and moths at the lantern.
  'organism.fish.scatter': c('world', 'critter', { gain: 1.4, cooldownMs: 1500, voices: 1 }),
  'organism.fish.flop': c('world', 'critter', { gain: 1.0, cooldownMs: 200 }),
  'organism.moth.swarm.loop': loop('world', { gain: 0.5, range: 300, bus: 'ambience', keepAliveMs: 700 }),

  // ------------------------------------------------ Bell & Tea Engine (D1)
  'tea.striker': tea(),
  'tea.cap': tea({ gain: 1.1 }),
  'tea.fault': tea({ gain: 0.9 }),
  'tea.knocker': tea(),
  'tea.advance': tea({ gain: 0.7 }),
  'tea.pendulum': tea({ gain: 1.1 }),
  'tea.boulder': tea({ gain: 1.1 }),
  'tea.dominoes': tea({ gain: 1.1 }),
  'tea.spring': tea(),
  'tea.duck': tea({ gain: 0.9 }),
  'tea.marble': tea(),
  'tea.generator': tea({ gain: 1.1 }),
  'tea.magnet': tea(),
  'tea.counterweight': tea({ gain: 1.1 }),
  'tea.served': tea({ gain: 1.2, range: 0, priority: 5 }),

  // ------------------------------------------------------------- ambience
  'amb.bellows': c('amb-d1', 'bed', { loop: true }),
  'amb.rot': c('amb-d2', 'bed', { loop: true }),
  'amb.cisterns': c('amb-d3', 'bed', { loop: true }),
  'amb.kiln': c('amb-d4', 'bed', { loop: true }),
  // The second doors (wave 3): each floor's own bed, loaded with its floor.
  'amb.coldstore': c('amb-d2b', 'bed', { loop: true }),
  'amb.galleries': c('amb-d3b', 'bed', { loop: true }),
  'amb.breath.inhale': c('amb-d1', 'material', { gain: 1.3, range: 820, cooldownMs: 4000, bus: 'ambience', pitchCents: 0 }),
  'amb.breath.exhale': c('amb-d1', 'material', { gain: 1.4, range: 820, cooldownMs: 4000, bus: 'ambience', pitchCents: 0 }),
  'amb.breath.jet': loop('amb-d1', { gain: 1.0, range: 520, keepAliveMs: 260 }),

  // ------------------------------------------------ organisms (floors 2-4)
  // Snapjaw: an ambush plant. Its tell must be heard: it is the warning.
  'organism.snapjaw.tell': org('snapjaw', 'creature', { cooldownMs: 200 }),
  'organism.snapjaw.snap': org('snapjaw', 'creature', { gain: 1.3, priority: 4 }),
  'organism.snapjaw.gulp': org('snapjaw', 'creature', { gain: 0.9 }),
  'organism.snapjaw.chew': org('snapjaw', 'creature', { gain: 0.5, cooldownMs: 600 }),
  'organism.snapjaw.burn': org('snapjaw', 'creature', { gain: 1.5 }),
  'organism.snapjaw.tear': org('snapjaw', 'creature', { gain: 1.0 }),
  // Spore puffer: a bladder of bog gas.
  'organism.puffer.swell': org('puffer', 'creature', { gain: 0.6, cooldownMs: 800 }),
  'organism.puffer.burst': org('puffer', 'creature', { gain: 1.4, priority: 4 }),
  // Glow-worm: fishes with a beaded thread from the vaults.
  'organism.glowworm.lower': org('glowworm', 'critter', { gain: 1.2, cooldownMs: 600 }),
  'organism.glowworm.retract': org('glowworm', 'creature', { gain: 1.1, cooldownMs: 250 }),
  'organism.glowworm.snare': org('glowworm', 'critter', { gain: 1.4 }),
  // Leech: the Cisterns' small tax on wading (close to the ear: it is on you).
  'organism.leech.latch': org('leech', 'creature', { gain: 1.4, priority: 4 }),
  'organism.leech.drink': org('leech', 'creature', { gain: 0.6, cooldownMs: 300 }),
  'organism.leech.shed': org('leech', 'creature', { gain: 0.8 }),
  // Isopod: curls into an armoured ball and rolls.
  'organism.isopod.curl': org('isopod', 'creature', { gain: 0.6, voices: 2, cooldownMs: 150 }),
  'organism.isopod.roll': org('isopod', 'critter', { gain: 1.2, cooldownMs: 120 }),
  // Ember beetle and ash moth: the Kiln's small fire-eaters.
  'organism.emberbeetle.crunch': org('emberbeetle', 'critter', { gain: 1.0, cooldownMs: 300 }),
  'organism.emberbeetle.pop': org('emberbeetle', 'creature', { gain: 0.7 }),
  'organism.ashmoth.flare': org('ashmoth', 'critter', { gain: 2.0, cooldownMs: 120 }),
  // The second doors (wave 3): the Cold Store's and the Glass Galleries' small life.
  'organism.frostmite.curl': org('frostmite', 'creature', { gain: 0.6, voices: 2, cooldownMs: 150 }),
  'organism.frostmite.eat': org('frostmite', 'critter', { gain: 0.9, cooldownMs: 300 }),
  'organism.snowmoth.flare': org('snowmoth', 'critter', { gain: 1.6, cooldownMs: 120 }),
  'organism.brineskater.scatter': org('brineskater', 'critter', { gain: 1.2, cooldownMs: 700, voices: 1 }),
  'organism.glassbeetle.curl': org('glassbeetle', 'creature', { gain: 0.7, voices: 2, cooldownMs: 150 }),
  'organism.prismmoth.flare': org('prismmoth', 'critter', { gain: 1.6, cooldownMs: 120 }),
  'organism.lensmite.eat': org('lensmite', 'critter', { gain: 1.0, cooldownMs: 250 }),
  'organism.lensmite.curl': org('lensmite', 'creature', { gain: 0.6, voices: 2, cooldownMs: 150 }),

  // ---------------------------------------------------- flora (every floor)
  // Living plants (game/Flora, sim/elements/flora, audio/HabitatAudio): the
  // felling, the seeds, the fires and the brush underfoot. One pack, loaded
  // with any floor in play (they all grow them). Announced moments map in
  // audio/EventCues (floraMoment, treeLanded).
  'flora.creak': fl('material', { gain: 0.46, range: 420, voices: 2, cooldownMs: 220 }),
  'flora.lean': fl('impact', { gain: 0.77, range: 480, voices: 2, cooldownMs: 400, pitchCents: 60 }),
  'flora.crack': fl('impact', { gain: 2.12, range: 620, voices: 3, cooldownMs: 120, priority: 4 }),
  'flora.hinge': fl('impact', { gain: 0.9, range: 520, voices: 2 }),
  'flora.sapling': fl('impact', { gain: 0.36, range: 380 }),
  'flora.whoosh': fl('impact', { gain: 1.05, range: 560, voices: 2, cooldownMs: 200 }),
  // The fall, in the floor's own wood (world/floraPass plants its species): birch, a giant
  // mushroom's stem, a waterlogged mangrove, charred ember-bark.
  'flora.fall.birch': fl('impact', { gain: 1.58, range: 760, voices: 2, cooldownMs: 90, priority: 4 }),
  'flora.fall.mushroom': fl('impact', { gain: 1.63, range: 760, voices: 2, cooldownMs: 90, priority: 4 }),
  'flora.fall.mangrove': fl('impact', { gain: 1.46, range: 760, voices: 2, cooldownMs: 90, priority: 4 }),
  'flora.fall.emberbark': fl('impact', { gain: 2.23, range: 760, voices: 2, cooldownMs: 90, priority: 4 }),
  'flora.canopy': fl('material', { gain: 0.83, range: 560, voices: 2, cooldownMs: 200 }),
  'flora.settle': fl('impact', { gain: 0.3, range: 420, cooldownMs: 300 }),
  'flora.rustle': fl('material', { gain: 0.51, range: 380, cooldownMs: 180 }),
  'flora.pod.drop': fl('material', { gain: 0.3, range: 380, cooldownMs: 150 }),
  'flora.glowseed': fl('pickup', { gain: 1.46 }),
  'flora.seed.soak': fl('material', { gain: 0.26, range: 380, voices: 2, cooldownMs: 250 }),
  'flora.seed.sprout': fl('material', { gain: 0.55, range: 420, cooldownMs: 300 }),
  'flora.ladder.rung': fl('impact', { gain: 0.31, range: 420, voices: 3, cooldownMs: 90, pitchCents: 150 }),
  'flora.ladder.grow.loop': loop('flora', { gain: 0.8, range: 420, keepAliveMs: 450 }),
  'flora.ladder.bloom': fl('material', { gain: 0.89, range: 420, cooldownMs: 400 }),
  // Fire in the brush: the catch (in the Kiln, its blooms flare), then the crackle while it burns.
  'flora.catch': fl('material', { gain: 0.76, range: 480, cooldownMs: 1500 }),
  'flora.firelily.flare': fl('material', { gain: 0.65, range: 420, cooldownMs: 1200 }),
  'flora.burn.loop': loop('flora', { gain: 0.9, range: 480 }),
  // Underfoot: restrained on purpose (a sweep, never a machine-gun; audio/HabitatAudio paces it).
  'flora.brush.grass': fl('step', { gain: 1.57, cooldownMs: 300, voices: 1 }),
  'flora.brush.reeds': fl('step', { gain: 1.14, cooldownMs: 300, voices: 1 }),
  'flora.brush.kelp': fl('step', { gain: 1.06, cooldownMs: 300, voices: 1 }),

  // ------------------------------------------------------------ creatures
  'creature.weaver.step': cr('weaver', { gain: 0.45, voices: 4, cooldownMs: 60 }),
  'creature.weaver.idle': cr('weaver', { gain: 0.7, cooldownMs: 1500 }),
  'creature.weaver.alert': cr('weaver', { gain: 1.53 }),
  'creature.weaver.chirr': cr('weaver', { gain: 1.31 }),
  'creature.weaver.pounce': cr('weaver'),
  'creature.weaver.windup': cr('weaver'),
  'creature.weaver.strike': cr('weaver', { gain: 1.1 }),
  'creature.weaver.spit': cr('weaver'),
  'creature.weaver.silk': cr('weaver', { gain: 0.8 }),
  'creature.weaver.feed': cr('weaver'),
  'creature.weaver.hurt': cr('weaver'),
  'creature.weaver.death': cr('weaver', { gain: 1.99 }),
  'creature.weaver.sever': cr('weaver', { gain: 1.1 }),
  'creature.weaver.limbhit': cr('weaver', { gain: 0.7 }),
  'creature.rillback.move': cr('rillback', { gain: 0.5, cooldownMs: 160 }),
  'creature.rillback.idle': cr('rillback', { gain: 0.6, cooldownMs: 1500 }),
  'creature.rillback.alert': cr('rillback'),
  'creature.rillback.windup': cr('rillback'),
  'creature.rillback.lunge': cr('rillback'),
  'creature.rillback.charge': cr('rillback'),
  'creature.rillback.discharge': cr('rillback', { gain: 1.1 }),
  'creature.rillback.flop': cr('rillback', { gain: 0.8 }),
  'creature.rillback.hurt': cr('rillback'),
  'creature.rillback.death': cr('rillback', { gain: 1.1 }),
  'creature.rootloper.step': cr('rootloper', { gain: 0.41, cooldownMs: 120 }),
  'creature.rootloper.idle': cr('rootloper', { gain: 0.6, cooldownMs: 1500 }),
  'creature.rootloper.alert': cr('rootloper'),
  'creature.rootloper.windup': cr('rootloper'),
  'creature.rootloper.attack': cr('rootloper', { gain: 1.1 }),
  'creature.rootloper.hurt': cr('rootloper'),
  'creature.rootloper.death': cr('rootloper', { gain: 1.1 }),
  'creature.stonemaw.idle': cr('stonemaw', { gain: 0.6, cooldownMs: 1500 }),
  'creature.stonemaw.alert': cr('stonemaw'),
  'creature.stonemaw.windup': cr('stonemaw'),
  'creature.stonemaw.bite': cr('stonemaw', { gain: 1.2 }),
  'creature.stonemaw.chew': cr('stonemaw', { gain: 0.71, cooldownMs: 200 }),
  'creature.stonemaw.hurt': cr('stonemaw'),
  'creature.stonemaw.death': cr('stonemaw', { gain: 1.1 }),
  'creature.bat.idle': cr('bat', { gain: 0.5, cooldownMs: 1200 }),
  'creature.bat.wake': cr('bat'),
  'creature.bat.swoop': cr('bat'),
  'creature.bat.alert': cr('bat', { gain: 0.98 }),
  'creature.bat.slimed': cr('bat'),
  'creature.bat.hurt': cr('bat'),
  'creature.bat.death': cr('bat'),
  'creature.bat.scatter': cr('bat', { gain: 1.2, cooldownMs: 600 }),
  'creature.slime.idle': cr('slime', { gain: 0.5, cooldownMs: 1500 }),
  'creature.slime.hop': cr('slime', { gain: 0.6, cooldownMs: 120 }),
  'creature.slime.alert': cr('slime'),
  'creature.slime.attack': cr('slime'),
  'creature.slime.hurt': cr('slime'),
  'creature.slime.death': cr('slime'),
  'creature.acidslime.idle': cr('acidslime', { gain: 0.5, cooldownMs: 1500 }),
  'creature.acidslime.hop': cr('acidslime', { gain: 0.6, cooldownMs: 120 }),
  'creature.acidslime.alert': cr('acidslime'),
  'creature.acidslime.attack': cr('acidslime'),
  'creature.acidslime.hurt': cr('acidslime'),
  'creature.acidslime.death': cr('acidslime'),
  'creature.eggs.idle': cr('eggs', { gain: 0.5, cooldownMs: 2000 }),
  'creature.eggs.hatch': cr('eggs', { gain: 1.1 }),
  'creature.eggs.hurt': cr('eggs'),
  'creature.eggs.death': cr('eggs'),
  'creature.spitter.step': cr('spitter', { gain: 0.45, cooldownMs: 80 }),
  'creature.spitter.idle': cr('spitter', { gain: 0.6, cooldownMs: 1500 }),
  'creature.spitter.alert': cr('spitter'),
  'creature.spitter.spit': cr('spitter', { gain: 1.1 }),
  'creature.spitter.hurt': cr('spitter'),
  'creature.spitter.death': cr('spitter'),
  'creature.bomber.idle': cr('bomber', { gain: 0.6, cooldownMs: 1500 }),
  'creature.bomber.alert': cr('bomber'),
  'creature.bomber.fuse': cr('bomber', { gain: 1.2, priority: 4 }),
  'creature.bomber.hurt': cr('bomber'),
  'creature.bomber.death': cr('bomber'),
  'creature.imp.idle': cr('imp', { gain: 0.6, cooldownMs: 1500 }),
  'creature.imp.alert': cr('imp'),
  'creature.imp.cast': cr('imp', { gain: 1.1 }),
  'creature.imp.hurt': cr('imp'),
  'creature.imp.death': cr('imp'),
  'creature.golem.step': cr('golem', { gain: 0.8, range: 460, cooldownMs: 120 }),
  'creature.golem.alert': cr('golem'),
  'creature.golem.jet': cr('golem', { gain: 1.1 }),
  'creature.golem.punch': cr('golem', { gain: 1.2, range: 640 }),
  'creature.golem.throw': cr('golem', { gain: 1.1, range: 600 }),
  'creature.golem.hurt': cr('golem'),
  'creature.golem.death': cr('golem', { gain: 1.2 }),
  'creature.wisp.idle': cr('wisp', { gain: 0.5, cooldownMs: 1500 }),
  'creature.wisp.alert': cr('wisp'),
  'creature.wisp.cast': cr('wisp'),
  'creature.wisp.hurt': cr('wisp'),
  'creature.wisp.death': cr('wisp'),
  'creature.mage.alert': cr('mage'),
  'creature.mage.cast': cr('mage', { gain: 1.1 }),
  'creature.mage.shard': cr('mage'),
  'creature.mage.blink': cr('mage'),
  'creature.mage.hurt': cr('mage'),
  'creature.mage.death': cr('mage'),
  'creature.leviathan.idle': boss('leviathan', { gain: 0.8, cooldownMs: 3000 }),
  'creature.leviathan.alert': boss('leviathan', { priority: 5 }),
  'creature.leviathan.glance': boss('leviathan', { gain: 0.6, cooldownMs: 200 }),
  'creature.leviathan.spit': boss('leviathan'),
  'creature.leviathan.windup': boss('leviathan'),
  'creature.leviathan.lunge': boss('leviathan'),
  'creature.leviathan.flop': boss('leviathan', { gain: 0.8 }),
  'creature.leviathan.hurt': boss('leviathan', { gain: 0.8 }),
  'creature.leviathan.death': boss('leviathan', { gain: 1.1, range: 1000, priority: 5 }),
  // Its moves (creatures/bosses/leviathan): the lure goes dark, the tail throws the pool, it dives and surges.
  'creature.leviathan.dim': boss('leviathan', { gain: 0.5, cooldownMs: 400 }),
  'creature.leviathan.thrash': boss('leviathan', { gain: 1.0 }),
  'creature.leviathan.dive': boss('leviathan', { gain: 0.8 }),
  'creature.leviathan.surge': boss('leviathan', { gain: 1.1, priority: 5 }),
  'creature.leviathan.shock': boss('leviathan', { gain: 0.9, cooldownMs: 350 }),
  'creature.colossus.idle': boss('colossus', { gain: 0.8, cooldownMs: 3000 }),
  'creature.colossus.alert': boss('colossus', { gain: 1.1, priority: 5 }),
  'creature.colossus.step': boss('colossus', { gain: 0.9, cooldownMs: 150 }),
  'creature.colossus.volley': boss('colossus'),
  'creature.colossus.hurt': boss('colossus', { gain: 0.8 }),
  'creature.colossus.death': boss('colossus', { gain: 1.2, range: 1200, priority: 5 }),
  // Its moves (creatures/bosses/colossus): every tell sounds on the clock the blow fires on.
  'creature.colossus.heave': boss('colossus', { gain: 0.6 }),
  'creature.colossus.slam': boss('colossus', { gain: 1.0, priority: 5 }),
  'creature.colossus.stomp': boss('colossus', { gain: 1.25, priority: 5 }),
  'creature.colossus.wave.loop': loop('creature-colossus', { gain: 0.8, range: 600, keepAliveMs: 200 }),
  'creature.colossus.scoop': boss('colossus', { gain: 0.8 }),
  'creature.colossus.vent.tell': boss('colossus', { gain: 0.8 }),
  'creature.colossus.vent': boss('colossus', { gain: 1.1 }),
  'creature.colossus.roar': boss('colossus', { gain: 1.15, priority: 5 }),
  'creature.colossus.plates': boss('colossus', { gain: 1.1, priority: 5 }),
  'creature.colossus.quench': boss('colossus', { gain: 1.1, priority: 5 }),
  'creature.colossus.kneel': boss('colossus', { gain: 0.75 }),
  'creature.colossus.death.crack': boss('colossus', { gain: 1.0, range: 1000, priority: 5 }),
  'creature.colossus.death.rubble': boss('colossus', { gain: 1.2, range: 1200, priority: 5 }),
  // THE RIME WARDEN (creatures/bosses/rimeWarden): the Cold Store's guardian — ice
  // armour that glances blows, thaws or shatters; spikes, rime waves, hail, frost breath.
  'creature.rimewarden.idle': boss('rimewarden', { gain: 0.7, cooldownMs: 3200 }),
  'creature.rimewarden.alert': boss('rimewarden', { gain: 1.1, priority: 5 }),
  'creature.rimewarden.step': boss('rimewarden', { gain: 0.8, cooldownMs: 160 }),
  'creature.rimewarden.hurt': boss('rimewarden', { gain: 0.8 }),
  'creature.rimewarden.death': boss('rimewarden', { gain: 1.2, range: 1200, priority: 5 }),
  'creature.rimewarden.glance': boss('rimewarden', { gain: 0.6, cooldownMs: 180 }),
  'creature.rimewarden.creak': boss('rimewarden', { gain: 0.7 }),
  'creature.rimewarden.slam': boss('rimewarden', { gain: 1.0, priority: 5 }),
  'creature.rimewarden.stomp': boss('rimewarden', { gain: 1.1, priority: 5 }),
  'creature.rimewarden.hail': boss('rimewarden', { gain: 0.9 }),
  'creature.rimewarden.inhale': boss('rimewarden', { gain: 0.8 }),
  'creature.rimewarden.breath': boss('rimewarden', { gain: 1.0 }),
  'creature.rimewarden.roar': boss('rimewarden', { gain: 1.15, priority: 5 }),
  'creature.rimewarden.shatter': boss('rimewarden', { gain: 1.1, priority: 5 }),
  'creature.rimewarden.thaw': boss('rimewarden', { gain: 0.9, priority: 5 }),
  // THE LENSWRIGHT (creatures/bosses/lenswright): the Galleries' great lens — the
  // iris opening (the tell), the lock, the lance, the dazzle that drops it.
  'creature.lenswright.idle': boss('lenswright', { gain: 0.6, cooldownMs: 3400 }),
  'creature.lenswright.alert': boss('lenswright', { gain: 1.0, priority: 5 }),
  'creature.lenswright.hurt': boss('lenswright', { gain: 0.8 }),
  'creature.lenswright.death': boss('lenswright', { gain: 1.2, range: 1200, priority: 5 }),
  'creature.lenswright.glance': boss('lenswright', { gain: 0.55, cooldownMs: 180 }),
  'creature.lenswright.iris': boss('lenswright', { gain: 0.8 }),
  'creature.lenswright.lock': boss('lenswright', { gain: 0.9, priority: 5 }),
  'creature.lenswright.lance': boss('lenswright', { gain: 1.1, priority: 5 }),
  'creature.lenswright.dazzle': boss('lenswright', { gain: 1.1, priority: 5 }),
  'creature.lenswright.fall': boss('lenswright', { gain: 1.0 }),
  'creature.lenswright.flare': boss('lenswright', { gain: 0.9 }),
  'creature.lenswright.roar': boss('lenswright', { gain: 1.0, priority: 5 }),
} as const satisfies Record<string, SfxCueDef>;

export type SfxId = keyof typeof SFX_CUES;

/** What a creature can say through `ctx.audio.creature(kind, action)`. */
export type CreatureSfxAction = 'idle' | 'alert' | 'hurt' | 'death' | 'attack' | 'step' | 'hop';

/** The packs loaded right after the first user gesture (everything else waits for its floor). */
export const CORE_SFX_PACKS: readonly string[] = ['ui', 'player', 'spells', 'world'];

/**
 * Floor ambience bed per level. Campaign floors by id; anything else (test
 * arenas, Builder playtests) by biome.
 */
export const FLOOR_BEDS: Readonly<Record<string, SfxId>> = {
  d1: 'amb.bellows',
  d2: 'amb.rot',
  d3: 'amb.cisterns',
  d4: 'amb.kiln',
  d2b: 'amb.coldstore',
  d3b: 'amb.galleries',
};
export const BIOME_BEDS: Readonly<Record<string, SfxId>> = {
  earthen: 'amb.bellows',
  fungal: 'amb.rot',
  flooded: 'amb.cisterns',
  frozen: 'amb.coldstore',
  crystal: 'amb.galleries',
  volcanic: 'amb.kiln',
};

/**
 * The Bell & Tea Engine: what the director plays as it moves INTO each stage
 * (world/teaMachine.ts TEA_STAGE). The two fuses open with the striker's own
 * flint (`tea.striker`, from its spark), fault stages with `tea.fault`, and
 * the finale is `tea.served`; everything else gets a quiet ratchet.
 */
export const TEA_STAGE_SFX: Readonly<Record<number, SfxId>> = {
  3: 'tea.advance',
  4: 'tea.pendulum',
  5: 'tea.boulder',
  7: 'tea.dominoes',
  8: 'tea.spring',
  9: 'tea.duck',
  10: 'tea.marble',
  12: 'tea.advance',
  13: 'tea.generator',
  14: 'tea.magnet',
  15: 'tea.counterweight',
};

/** Resolve a stage's cue (a quiet ratchet for any stage without its own). */
export function teaStageSfx(stage: number): SfxId {
  return TEA_STAGE_SFX[stage] ?? 'tea.advance';
}

export function isSfxId(id: string): id is SfxId {
  return Object.prototype.hasOwnProperty.call(SFX_CUES, id);
}
