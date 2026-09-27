import type { SfxOptions } from '@/core/types';
import type { SfxCategory, SfxId } from '@/content/audio/sfxCues';

/**
 * The procedural voices a cue falls back to while its samples are still
 * loading (or if a file failed to decode): loading is never silence and never
 * an error. For cues that replaced an ad-hoc `ctx.audio.tone/noiseBurst` call
 * site, the recipe here IS that call site's original sound, kept verbatim.
 *
 * Recipes play at the placement and on the bus the cue itself would use.
 */
export interface ProceduralKit {
  tone(freq: number, endFreq: number, dur: number, type: OscillatorType, vol: number): void;
  noiseBurst(dur: number, filterFreq: number, vol: number, highpass?: boolean): void;
  /** setTimeout that keeps the current placement. */
  later(ms: number, fn: () => void): void;
  chitin(intensity?: number): void;
  chirr(dur?: number, pitch?: number, vol?: number): void;
  slither(intensity?: number): void;
  creak(intensity?: number): void;
  grind(intensity?: number): void;
  squeak(): void;
  hop(size?: number): void;
  skitter(): void;
  squelch(): void;
  zap(): void;
  hollowKnock(): void;
  bubble(): void;
  shatter(): void;
  groan(): void;
  flame(): void;
  sizzle(): void;
  steam(): void;
  boom(size: number): void;
  landThud(intensity: number): void;
  splash(intensity: number): void;
  lever(): void;
  brazier(): void;
  chest(): void;
  pickup(): void;
  gong(): void;
  portalWhoosh(): void;
  dig(): void;
  alert(): void;
  learn(): void;
  coin(streak?: number): void;
  keyJingle(): void;
  dryFire(): void;
}

export type SfxFallback = (p: ProceduralKit, opts: SfxOptions) => void;

const semis = (opts: SfxOptions): number => 2 ** ((opts.pitch ?? 0) / 12);

export const SFX_FALLBACKS: Partial<Record<SfxId, SfxFallback>> = {
  // ---- UI (RunHud, RunSummary, DeathCinema) ----
  'ui.phial.refill': (p) => {
    p.tone(784, 1175, 0.22, 'sine', 0.045);
    p.later(110, () => p.tone(1175, 1568, 0.3, 'triangle', 0.03));
    p.later(240, () => p.tone(1568, 1568, 0.45, 'sine', 0.018));
  },
  'ui.phial.drain': (p) => { p.tone(1760, 1320, 0.12, 'triangle', 0.035); p.later(90, () => p.tone(660, 330, 0.5, 'sine', 0.04)); },
  'ui.run.over': (p) => p.tone(110, 55, 1.4, 'sine', 0.06),
  'ui.summary.victory': (p) => {
    p.tone(392, 392, 1.4, 'sine', 0.05);
    p.later(140, () => p.tone(494, 494, 1.2, 'sine', 0.04));
    p.later(300, () => p.tone(587, 587, 1.4, 'triangle', 0.035));
  },
  'ui.summary.fallen': (p) => { p.tone(147, 147, 1.6, 'sine', 0.05); p.later(220, () => p.tone(220, 196, 1.4, 'sine', 0.03)); },
  'ui.tally': (p) => p.tone(1480, 1320, 0.04, 'triangle', 0.012),
  'ui.coins': (p) => p.coin(),
  'ui.learn': (p) => p.learn(),
  'ui.curtain': (p) => p.tone(98, 49, 1.6, 'sine', 0.08),
  'ui.card.choose': (p) => p.learn(),
  // ---- player ----
  'player.pullup': (p) => p.noiseBurst(0.05, 300, 0.08, true),
  'player.grab': (p) => p.noiseBurst(0.04, 420, 0.06, true),
  'player.stomp': (p) => p.landThud(0.85),
  'player.slam': (p) => p.landThud(1),
  'player.kick': (p) => { p.tone(150, 90, 0.14, 'square', 0.09); p.noiseBurst(0.12, 220, 0.09); },
  'player.dive': (p) => p.noiseBurst(0.12, 320, 0.1),
  'player.skid': (p) => p.noiseBurst(0.05, 700, 0.07, true),
  'player.vine': (p) => p.tone(260, 160, 0.06, 'sine', 0.06),
  'player.death': (p) => p.squelch(),
  'player.corpse.wand': (p) => p.tone(1600, 900, 0.05, 'triangle', 0.05),
  'player.corpse.knell': (p) => p.tone(150, 320, 0.32, 'sine', 0.09),
  'player.recharge': (p, o) => p.tone(520 * semis(o), 660, 0.1, 'sine', 0.05),
  'player.recharge.done': (p) => p.chest(),
  'player.heal': (p) => p.tone(700, 70, 0.08, 'sine', 0.05),
  'player.drink': (p) => p.tone(300, 180, 0.08, 'sine', 0.12),
  'player.teleport': (p) => p.tone(660, 1320, 0.18, 'sine', 0.18),
  'player.staff': (p) => p.dig(),
  'player.glowseed': (p) => p.tone(720, 380, 0.11, 'sine', 0.035),
  'player.club.swing': (p) => p.noiseBurst(0.06, 680, 0.065, true),
  'player.club.hit': (p) => { p.noiseBurst(0.07, 420, 0.12, true); p.tone(120, 42, 0.1, 'triangle', 0.08); },
  'player.club.throw': (p) => p.noiseBurst(0.09, 850, 0.09, true),
  'player.gear': (p) => { p.noiseBurst(0.035, 780, 0.06); p.tone(100, 52, 0.045, 'triangle', 0.028); },
  'player.step.metal': (p) => { p.tone(370, 240, 0.09, 'sine', 0.045); p.noiseBurst(0.025, 1600, 0.03); },
  'player.wade': (p) => { p.noiseBurst(0.13, 850, 0.045); p.tone(320, 120, 0.08, 'sine', 0.018); },
  'flask.throw': (p) => p.tone(520, 320, 0.08, 'sine', 0.06),
  'flask.dry': (p) => p.dryFire(),
  'flask.siphon.loop': (p) => p.noiseBurst(0.08, 900, 0.05, true),
  'flask.pour.loop': (p) => p.noiseBurst(0.06, 600, 0.035),
  'flask.shatter': (p) => { p.tone(1400, 300, 0.12, 'triangle', 0.18); p.noiseBurst(0.12, 2600, 0.12, true); },
  'pickup.gold': (p) => p.pickup(),
  'pickup.generic': (p) => p.pickup(),
  'pickup.leg': (p) => p.pickup(),
  'pickup.heart': (p) => p.chest(),
  'pickup.bell': (p) => p.keyJingle(),
  // ---- spells ----
  'spell.spark.cast': (p) => p.zap(),
  'spell.spark.impact': (p, o) => {
    const g = o.gain ?? 1;
    p.noiseBurst(0.035, 3400, 0.06 * g, true);
    p.tone(2100, 760, 0.05, 'square', 0.045 * g);
  },
  'spell.bomb.cast': (p) => p.noiseBurst(0.06, 700, 0.05),
  'spell.warp.cast': (p) => p.zap(),
  'spell.vitriol.loop': (p) => p.noiseBurst(0.1, 1400, 0.07, true),
  'spell.cryojet.loop': (p) => p.noiseBurst(0.08, 1900, 0.06, true),
  'spell.aquajet.loop': (p) => p.splash(0.5),
  'spell.frostshard.cast': (p) => p.tone(1100, 500, 0.08, 'sine', 0.09),
  'spell.icelance.cast': (p) => p.tone(1500, 700, 0.1, 'triangle', 0.1),
  'spell.wisp.cast': (p) => p.tone(700, 1200, 0.1, 'sine', 0.07),
  'spell.meteor.cast': (p) => p.tone(120, 40, 0.4, 'sawtooth', 0.18),
  'spell.conjure': (p) => p.tone(180, 60, 0.18, 'triangle', 0.2),
  'spell.vitrify': (p) => { p.tone(1250, 300, 0.14, 'triangle', 0.14); p.tone(640, 90, 0.2, 'sine', 0.1); },
  'spell.emberstorm': (p) => p.flame(),
  'spell.freeze': (p) => p.tone(900, 400, 0.1, 'sine', 0.1),
  'spell.ice.impact': (p) => p.tone(1600, 160, 0.14, 'triangle', 0.1),
  'spell.crit.wet': (p) => p.tone(1180, 120, 0.14, 'triangle', 0.08),
  'spell.crit.shatter': (p) => p.tone(1640, 100, 0.16, 'triangle', 0.1),
  'spell.crit.pyre': (p) => p.tone(380, 170, 0.13, 'sawtooth', 0.09),
  'spell.charge.electric': (p) => p.tone(1500, 300, 0.08, 'square', 0.06),
  'spell.charge.frost': (p) => p.tone(940, 180, 0.1, 'sine', 0.07),
  // ---- world ----
  'mat.ignite': (p) => p.brazier(),
  'world.waystone': (p) => { p.tone(660, 660, 0.22, 'sine', 0.18); p.later(130, () => p.tone(990, 990, 0.3, 'sine', 0.16)); },
  'body.grab': (p) => p.tone(320, 220, 0.06, 'square', 0.08),
  'body.lift': (p) => p.tone(440, 200, 0.08, 'sine', 0.07),
  'body.throw': (p) => p.tone(210, 90, 0.1, 'square', 0.09),
  'body.drop': (p) => p.tone(180, 80, 0.07, 'sine', 0.06),
  'body.rip': (p) => p.tone(140, 45, 0.04, 'square', 0.05),
  'body.tear': (p) => p.tone(90, 170, 0.12, 'sawtooth', 0.1),
  'body.bash': (p) => p.tone(150, 130, 0.08, 'square', 0.12),
  'body.smash.wood': (p) => p.noiseBurst(0.16, 250, 0.12),
  'body.smash.stone': (p) => p.noiseBurst(0.16, 250, 0.12),
  'body.smash.metal': (p) => p.noiseBurst(0.14, 300, 0.1),
  'body.burnout': (p) => p.noiseBurst(0.14, 220, 0.08),
  'mech.plate': (p) => p.tone(140, 90, 0.1, 'square', 0.14),
  'mech.scale': (p) => p.tone(180, 120, 0.14, 'square', 0.15),
  'mech.buoy': (p) => p.bubble(),
  'mech.latch': (p) => p.zap(),
  'mech.sensor': (p) => p.tone(220, 110, 0.1, 'triangle', 0.12),
  'mech.counterweight': (p) => p.tone(150, 200, 0.18, 'square', 0.16),
  'mech.vault': (p) => p.tone(520, 300, 0.3, 'triangle', 0.12),
  'mech.sequence.step': (p, o) => p.tone(390 * semis(o), 110, 0.1, 'triangle', 0.12),
  'mech.sequence.fail': (p) => p.tone(120, 200, 0.14, 'sawtooth', 0.1),
  'mech.relay.arm': (p) => p.tone(260, 90, 0.08, 'triangle', 0.1),
  'mech.relay.fire': (p) => p.tone(420, 140, 0.12, 'triangle', 0.14),
  'mech.dispenser': (p) => p.tone(190, 130, 0.07, 'square', 0.1),
  'mech.plug': (p) => p.tone(140, 220, 0.16, 'sawtooth', 0.14),
  'mech.rune': (p) => { p.tone(220, 500, 0.5, 'sine', 0.18); p.later(240, () => p.tone(330, 400, 0.4, 'sine', 0.14)); },
  'mech.grip': (p) => p.tone(180, 140, 0.08, 'square', 0.08),
  'mech.shrine': (p) => p.tone(660, 220, 0.18, 'triangle', 0.1),
  'mech.cauldron': (p) => p.tone(360, 720, 0.22, 'sine', 0.1),
  'amb.breath.inhale': (p) => p.tone(63, 94, 2.5, 'sine', 0.08),
  'amb.breath.jet': (p) => { p.noiseBurst(0.7, 400, 0.055); p.tone(60, 82, 1.2, 'sine', 0.045); },
  // ---- the Bell & Tea Engine ----
  'tea.striker': (p) => p.zap(),
  'tea.cap': (p) => p.zap(),
  'tea.fault': (p) => p.hollowKnock(),
  'tea.knocker': (p) => p.lever(),
  'tea.advance': (p) => p.lever(),
  'tea.pendulum': (p) => p.lever(),
  'tea.boulder': (p) => p.lever(),
  'tea.dominoes': (p) => p.lever(),
  'tea.spring': (p) => p.lever(),
  'tea.duck': (p) => p.lever(),
  'tea.marble': (p) => p.lever(),
  'tea.generator': (p) => p.lever(),
  'tea.magnet': (p) => p.lever(),
  'tea.counterweight': (p) => p.lever(),
  'tea.served': (p) => p.gong(),
  // ---- creatures ----
  'creature.hit': (p) => { p.noiseBurst(0.035, 1400, 0.035, true); p.tone(145, 65, 0.055, 'triangle', 0.035); },
  'creature.gib': (p) => { p.noiseBurst(0.12, 170, 0.13); p.tone(120, 70, 0.12, 'square', 0.08); },
  'creature.dodge': (p) => p.noiseBurst(0.05, 1500, 0.045, true),
  'creature.hop': (p) => p.hop(1),
  'creature.generic.alert': (p) => p.alert(),
  'creature.generic.death': (p) => p.squelch(),
  'creature.weaver.step': (p, o) => p.chitin(o.gain ?? 0.18),
  'creature.weaver.chirr': (p, o) => p.chirr(0.28, o.rate ?? 1, 0.07),
  'creature.weaver.alert': (p) => p.chirr(0.22, 1.1, 0.06),
  'creature.weaver.pounce': (p) => p.chirr(0.22, 0.85, 0.08),
  'creature.weaver.windup': (p) => p.chitin(1.3),
  'creature.weaver.strike': (p) => p.hollowKnock(),
  'creature.weaver.spit': (p) => p.noiseBurst(0.08, 1300, 0.08, true),
  'creature.weaver.silk': (p) => { p.noiseBurst(0.07, 1100, 0.07, true); p.tone(320, 140, 0.08, 'triangle', 0.04); },
  'creature.weaver.feed': (p) => { p.chitin(1.2); p.noiseBurst(0.08, 420, 0.06); },
  'creature.weaver.sever': (p) => { p.noiseBurst(0.06, 1700, 0.09, true); p.tone(270, 65, 0.12, 'triangle', 0.065); },
  'creature.weaver.limbhit': (p) => p.tone(480, 230, 0.05, 'triangle', 0.04),
  'creature.rillback.move': (p, o) => p.slither(o.gain ?? 1),
  'creature.rillback.alert': (p) => p.slither(1.2),
  'creature.rillback.windup': (p) => p.slither(1.4),
  'creature.rillback.lunge': (p) => p.noiseBurst(0.08, 850, 0.08, true),
  'creature.rillback.charge': (p) => p.tone(280, 520, 0.18, 'sine', 0.07),
  'creature.rillback.discharge': (p) => p.zap(),
  'creature.rillback.flop': (p) => p.hop(0.9),
  'creature.rootloper.step': (p, o) => p.creak(o.gain ?? 0.35),
  'creature.rootloper.alert': (p) => p.creak(1),
  'creature.rootloper.windup': (p) => p.creak(1.2),
  'creature.stonemaw.alert': (p) => p.grind(1),
  'creature.stonemaw.chew': (p, o) => p.grind(o.gain ?? 0.9),
  'creature.stonemaw.bite': (p) => p.grind(1.3),
  'creature.stonemaw.windup': (p) => p.grind(0.8),
  'creature.bat.alert': (p) => p.squeak(),
  'creature.bat.wake': (p) => p.squeak(),
  'creature.bat.swoop': (p) => p.squeak(),
  'creature.bat.slimed': (p) => p.squelch(),
  'creature.eggs.hatch': (p) => p.squelch(),
  'creature.spitter.step': (p) => p.skitter(),
  'creature.spitter.spit': (p) => p.flame(),
  'creature.bomber.fuse': (p) => p.tone(900, 60, 0.3, 'square', 0.1),
  'creature.imp.cast': (p) => p.zap(),
  'creature.golem.step': (p) => p.landThud(0.35),
  'creature.golem.jet': (p) => p.tone(110 + Math.random() * 30, 260, 0.35, 'sawtooth', 0.11),
  'creature.golem.punch': (p) => p.tone(60 + Math.random() * 25, 90, 0.2, 'square', 0.16),
  'creature.golem.throw': (p) => p.boom(4),
  'creature.wisp.cast': (p) => p.tone(820, 1300, 0.12, 'sine', 0.09),
  'creature.mage.cast': (p) => p.tone(240, 70, 0.3, 'sawtooth', 0.12),
  'creature.mage.shard': (p) => p.tone(180, 90, 0.22, 'sawtooth', 0.1),
  'creature.mage.blink': (p) => p.tone(660, 1320, 0.14, 'sine', 0.12),
  'creature.leviathan.alert': (p) => { p.tone(58, 30, 0.8, 'sine', 0.2); p.groan(); },
  'creature.leviathan.glance': (p) => p.tone(820, 520, 0.05, 'triangle', 0.07),
  'creature.leviathan.spit': (p) => p.noiseBurst(0.14, 900, 0.1, true),
  'creature.leviathan.windup': (p) => p.tone(70, 160, 0.5, 'sawtooth', 0.14),
  'creature.leviathan.lunge': (p) => p.noiseBurst(0.18, 700, 0.12, true),
  'creature.leviathan.flop': (p) => p.hop(1.6),
  'creature.leviathan.death': (p) => { p.groan(); p.squelch(); },
  'creature.colossus.alert': (p) => { p.tone(46, 110, 0.9, 'sawtooth', 0.22); p.groan(); },
  'creature.colossus.step': (p) => { p.landThud(0.8); p.hollowKnock(); },
  'creature.colossus.volley': (p) => p.tone(90, 220, 0.4, 'sawtooth', 0.16),
  'creature.colossus.death': (p) => p.portalWhoosh(),
  // ---- wave 2: what each new cue's call site played before it had a sample ----
  'creature.bat.scatter': (p) => p.squeak(),
  'creature.colossus.heave': (p) => p.grind(1.2),
  'creature.colossus.slam': (p) => p.hollowKnock(),
  'creature.colossus.stomp': (p) => { p.boom(14); p.hollowKnock(); },
  'creature.colossus.scoop': (p) => p.flame(),
  'creature.colossus.vent.tell': (p) => p.steam(),
  'creature.colossus.vent': (p) => p.flame(),
  'creature.colossus.roar': (p) => { p.groan(); p.grind(1.3); },
  'creature.colossus.plates': (p) => p.boom(6),
  'creature.colossus.quench': (p) => p.steam(),
  'creature.colossus.kneel': (p) => p.landThud(0.8),
  'creature.colossus.death.crack': (p) => { p.groan(); p.grind(1.6); },
  'creature.colossus.death.rubble': (p) => p.grind(1.6),
  'creature.leviathan.thrash': (p) => { p.splash(1.6); p.boom(8); },
  'creature.leviathan.surge': (p) => p.splash(1.4),
  'creature.leviathan.shock': (p) => { p.zap(); p.groan(); },
  'creature.leviathan.dive': (p) => p.bubble(),
  'organism.snapjaw.tell': (p) => p.creak(0.35),
  'organism.snapjaw.snap': (p) => p.chitin(1.4),
  'organism.snapjaw.gulp': (p) => p.squelch(),
  'organism.snapjaw.chew': (p) => p.squelch(),
  'organism.snapjaw.burn': (p) => p.sizzle(),
  'organism.snapjaw.tear': (p) => p.squelch(),
  'organism.puffer.burst': (p) => { p.squelch(); p.steam(); },
  'organism.leech.latch': (p) => p.squelch(),
  'organism.isopod.curl': (p) => p.skitter(),
  'organism.isopod.roll': (p) => p.skitter(),
  'organism.emberbeetle.pop': (p) => p.sizzle(),
  'organism.fish.flop': (p) => p.hop(0.5),
  'light.lantern.hood': (p) => p.lever(),
  'light.lantern.unhood': (p) => p.lever(),
  'light.eyeshine': (p) => p.tone(2200, 2640, 0.06, 'sine', 0.018),
  'light.photocell.latch': (p) => { p.lever(); p.tone(1318, 1318, 0.35, 'sine', 0.035); },
  'light.bloom.open': (p) => { p.tone(880, 1760, 0.4, 'sine', 0.03); p.later(120, () => p.tone(1320, 2093, 0.4, 'triangle', 0.02)); },
  'light.bloom.furl': (p) => p.tone(1400, 700, 0.35, 'triangle', 0.02),
  'light.bloom.petal': (p, o) => p.tone(1568 * semis(o), 1568 * semis(o), 0.12, 'sine', 0.02),
  // ---- flora (game/Flora, sim/elements/flora): the stand-ins the flora wave played at each call site ----
  'flora.creak': (p, o) => p.creak(0.8 * (o.gain ?? 1)),
  'flora.lean': (p) => p.creak(1),
  'flora.crack': (p) => { p.tone(90, 170, 0.12, 'sawtooth', 0.1); p.noiseBurst(0.16, 250, 0.066); p.creak(1.2); },
  'flora.hinge': (p) => p.tone(140, 45, 0.04, 'square', 0.07),
  'flora.sapling': (p) => p.tone(140, 45, 0.04, 'square', 0.05),
  'flora.whoosh': (p) => p.noiseBurst(0.35, 900, 0.04),
  'flora.fall.birch': (p, o) => { p.boom(4 + 8 * (o.gain ?? 1)); p.landThud(Math.min(1, 0.4 + (o.gain ?? 1))); },
  'flora.fall.mushroom': (p, o) => { p.boom(4 + 8 * (o.gain ?? 1)); p.landThud(Math.min(1, 0.4 + (o.gain ?? 1))); p.squelch(); },
  'flora.fall.mangrove': (p, o) => { p.boom(4 + 8 * (o.gain ?? 1)); p.landThud(Math.min(1, 0.4 + (o.gain ?? 1))); p.splash(0.8); },
  'flora.fall.emberbark': (p, o) => { p.boom(4 + 8 * (o.gain ?? 1)); p.landThud(Math.min(1, 0.4 + (o.gain ?? 1))); p.sizzle(); },
  'flora.canopy': (p) => p.noiseBurst(0.3, 2600, 0.035, true),
  'flora.settle': (p) => p.creak(0.35),
  'flora.rustle': (p) => p.noiseBurst(0.18, 3000, 0.03, true),
  'flora.pod.drop': (p) => p.tone(1200, 900, 0.05, 'sine', 0.025),
  'flora.glowseed': (p) => p.pickup(),
  'flora.seed.soak': (p) => p.bubble(),
  'flora.seed.sprout': (p) => p.bubble(),
  'flora.ladder.rung': (p) => p.noiseBurst(0.04, 600, 0.03),
  'flora.ladder.bloom': (p) => p.tone(260, 160, 0.06, 'sine', 0.05),
  'flora.catch': (p) => p.brazier(),
  'flora.firelily.flare': (p) => p.sizzle(),
};

/**
 * Cues that had no sound before this layer (UI hovers, body impacts, idles…)
 * fall back to a small generic voice of their family rather than nothing.
 */
export const CATEGORY_FALLBACKS: Partial<Record<SfxCategory, SfxFallback>> = {
  ui: (p) => p.noiseBurst(0.02, 3200, 0.03, true),
  pickup: (p) => p.pickup(),
  impact: (p, o) => p.noiseBurst(0.04, 600, 0.05 * (o.gain ?? 1)),
  mechanism: (p) => p.lever(),
  critter: (p) => p.noiseBurst(0.02, 4200, 0.03, true),
};
