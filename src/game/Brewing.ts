import type { Ctx } from '@/core/types';
import type { Recipe } from '@/content/recipes';
import { RECIPES } from '@/content/recipes';
export { RECIPES, type Recipe } from '@/content/recipes';
import { isElixirCell } from '@/content/elixirs';
import type { BrewAttemptInfo, BrewingApi, CauldronView, MixFeel } from '@/core/alchemy';
import { loadDiscoveredRecipes, recordExperiment, recordRecipeDiscovery } from '@/core/grimoireStore';
import { assessMix, ATTEMPT_MIN_MASS, consumedBy, isReagent, matchMix, mixMass, mixSignature, type Histogram } from '@/game/alchemy/mix';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';

/**
 * Cauldron brewing (DESIGN.md pillar 7): the basin's contents are read as a
 * literal grid histogram — you physically pour reagents in and physically keep
 * a fire burning under the stone base. Nothing is abstracted: a brew is a
 * transmutation of the real cells sitting in the bowl, so spillage is loss and
 * an explosion mid-brew is a ruined batch.
 *
 * It is also a DISCOVERY game (THE EXPERIMENT): which recipe a mix is, and how
 * close a failed one came, are judged by game/alchemy/mix. A mix that is heated
 * and answers nothing is an ATTEMPT: after a moment the cauldron says what it
 * made of it (nothing stirs / it shimmers / it clouds), the experiment log in the
 * Grimoire keeps it, and the bowl panel shows each reagent's temperature. Nothing
 * names a recipe before it is discovered.
 *
 * First-time brews are recorded in the Grimoire (localStorage) for a small
 * one-time gold bounty — recipe knowledge is the part that persists across
 * expeditions.
 */

interface BasinSample {
  /** Reagent cell id -> cells in the bowl (the cells a mix is judged by). */
  counts: Record<number, number>;
  mass: number;
  /** The potion already in the bowl, waiting to be siphoned. */
  elixir: { cell: number; n: number } | null;
}

/** Basin interior + rim overflow: cauldron.x ± BASIN_HALF_W, rows y-2 .. y. */
const BASIN_HALF_W = 3;
const BASIN_TOP = -2;
const BASIN_BOTTOM = 0;
/**
 * Heat: any flame hugging the cauldron counts — beside the walls, on the rim,
 * or in a pit dug under the base. The basin interior itself is excluded so
 * lava poured INTO the bowl is an ingredient hazard, not a burner.
 */
const HEAT_HALF_W = 6;
const HEAT_TOP = -2;
const HEAT_BOTTOM = 4;

/** The cauldron's notices speak to someone standing at it (QA: settling drips
 *  into an untended basin toasted "NEEDS HEAT" every 2 s from across the floor). */
const HINT_RADIUS = 90;
/** The bowl panel shows to anyone this close (cells). */
const VIEW_RADIUS = 90;
/** The same notice again only after this long (frames); a new one at once. */
const HINT_REPEAT_FRAMES = 720;

/** Sustained heat+ingredient sampler ticks (1 tick per 4 frames) to finish a brew. */
const BREW_TICKS_REQUIRED = 90;
/** Sampler ticks a heated, unmatched mix must stand unchanged before the cauldron judges it (~1.6 s). */
const ATTEMPT_TICKS = 24;
/** Frames between two judgments (a bowl still settling never writes a line a second). */
const ATTEMPT_GAP_FRAMES = 240;
export { GRIMOIRE_KEY, loadDiscoveredRecipes } from '@/core/grimoireStore';
/**
 * Oz for a recipe's first brew: a small flat 5 (was 100, then 30). A dozen
 * recipes at 30 oz is more lifetime gold than a whole run earns; the reward for a
 * discovery is the Grimoire page and the effect, not the purse.
 */
const DISCOVERY_BOUNTY = 5;

const HIDDEN_VIEW: CauldronView = {
  visible: false, x: 0, y: 0, reagents: [], mass: 0, heated: false, progress: 0,
  matched: false, verdict: null, missing: 0, elixir: null,
};

// ===================== Cauldron Brewing =====================
export class Brewing implements BrewingApi {
  private brewTicks = 0;
  private activeBrewKey: string | null = null;
  private lastHintFrame = -9999;
  private lastHintText = '';
  /** The mix under judgment: its signature, how long it has been heated, and what was made of it. */
  private attemptSig = '';
  private attemptTicks = 0;
  private lastJudgeFrame = -9999;
  private judged: { sig: string; feel: Record<number, MixFeel>; verdict: BrewAttemptInfo['verdict']; missing: number } | null = null;
  private current: CauldronView = HIDDEN_VIEW;
  private viewKey = '';

  view(): CauldronView {
    return this.current;
  }

  /** Play-mode only; samples the basin every 4th frame. */
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') {
      this.resetProgress();
      this.hideView(ctx);
      return;
    }
    const cauldron = ctx.levels.current?.cauldron;
    if (!cauldron) {
      this.resetProgress();
      this.hideView(ctx);
      return;
    }
    if (ctx.state.frameCount % 4 !== 0) return;

    const sample = this.sampleBasin(ctx, cauldron);
    const heated = this.hasHeat(ctx, cauldron);
    const recipe = matchMix(sample.counts);
    const sig = mixSignature(sample.counts);
    if (!recipe) {
      this.noMatch(ctx, cauldron, sample, sig, heated);
      this.publish(ctx, cauldron, sample, heated, null);
      this.resetProgress();
      return;
    }
    this.attemptSig = '';
    this.attemptTicks = 0;
    this.judged = null;
    const known = loadDiscoveredRecipes();
    const key = this.brewKey(ctx, cauldron, recipe);
    if (this.activeBrewKey !== key) {
      this.activeBrewKey = key;
      this.brewTicks = 0;
    }
    if (!heated) {
      this.emitHint(ctx, 'CAULDRON: NEEDS HEAT');
      if (this.brewTicks > 0) this.brewTicks--;
      if (this.brewTicks === 0) this.activeBrewKey = null;
      this.publish(ctx, cauldron, sample, heated, recipe);
      return;
    }

    // A recipe nobody has written down is not named until it is: the cauldron only says it is simmering.
    if (this.brewTicks === 0) this.emitHint(ctx, known[recipe.id] ? `CAULDRON: BREWING ${recipe.name}` : 'CAULDRON: SIMMERING');
    this.brewTicks++;
    // Simmer ambience: blub + a wisp or two of vapor rising off the bowl, in the colour of what is IN it
    // (never of the recipe: that is the spoiler this used to leak).
    if (ctx.state.frameCount % 8 === 0) {
      ctx.audio.bubble(cauldron.x, cauldron.y);
      const colorFn = this.bowlColor(sample);
      const wisps = 1 + (entityRandom() < 0.5 ? 1 : 0);
      for (let j = 0; j < wisps; j++) {
        const px = cauldron.x + Math.floor(entityRandom() * (BASIN_HALF_W * 2 + 1)) - BASIN_HALF_W;
        const py = cauldron.y + BASIN_TOP - 1;
        ctx.particles.spawn(px, py, (entityRandom() - 0.5) * 0.3, -0.3 - entityRandom() * 0.4,
          null, colorFn(), 25 + Math.floor(entityRandom() * 15), { grav: -0.04, glow: 1.3 });
      }
    }

    if (this.brewTicks >= BREW_TICKS_REQUIRED) {
      this.finishBrew(ctx, cauldron, recipe);
      this.resetProgress();
      this.publish(ctx, cauldron, this.sampleBasin(ctx, cauldron), heated, null);
      return;
    }
    this.publish(ctx, cauldron, sample, heated, recipe);
  }

  private resetProgress(): void {
    this.brewTicks = 0;
    this.activeBrewKey = null;
  }

  private emitHint(ctx: Ctx, text: string): void {
    const cauldron = ctx.levels.current?.cauldron;
    if (cauldron && Math.hypot(ctx.player.x - cauldron.x, ctx.player.y - cauldron.y) > HINT_RADIUS) return;
    if (this.lastHintText === text && ctx.state.frameCount - this.lastHintFrame < HINT_REPEAT_FRAMES) return;
    this.lastHintText = text;
    this.lastHintFrame = ctx.state.frameCount;
    ctx.events.emit('toast', { text });
  }

  private brewKey(ctx: Ctx, cauldron: { x: number; y: number }, recipe: Recipe): string {
    return `${ctx.levels.current?.def.id ?? 'sandbox'}:${cauldron.x},${cauldron.y}:${recipe.id}`;
  }

  /** Reagent histogram of the basin, plus whatever finished potion already sits in it. */
  private sampleBasin(ctx: Ctx, cauldron: { x: number; y: number }): BasinSample {
    const world = ctx.world;
    const counts: Record<number, number> = {};
    const potions: Record<number, number> = {};
    let mass = 0;
    for (let dy = BASIN_TOP; dy <= BASIN_BOTTOM; dy++) {
      for (let dx = -BASIN_HALF_W; dx <= BASIN_HALF_W; dx++) {
        const x = cauldron.x + dx, y = cauldron.y + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (isElixirCell(t)) potions[t] = (potions[t] ?? 0) + 1;
        else if (isReagent(t)) {
          counts[t] = (counts[t] ?? 0) + 1;
          mass++;
        }
      }
    }
    let elixir: BasinSample['elixir'] = null;
    for (const k in potions) if (!elixir || potions[k] > elixir.n) elixir = { cell: Number(k), n: potions[k] };
    return { counts, mass, elixir };
  }

  /** A paint for vapor and sparks that is the bowl's own: the colour of its most plentiful reagent. */
  private bowlColor(sample: BasinSample): () => number {
    let best = -1, bestN = 0;
    for (const k in sample.counts) if (sample.counts[k] > bestN) { best = Number(k); bestN = sample.counts[k]; }
    return COLOR_FN[best] ?? (() => packRGB(200, 200, 200));
  }

  /** True if real fire/lava/embers hug the cauldron (excluding the bowl itself). */
  private hasHeat(ctx: Ctx, cauldron: { x: number; y: number }): boolean {
    const world = ctx.world;
    for (let dy = HEAT_TOP; dy <= HEAT_BOTTOM; dy++) {
      for (let dx = -HEAT_HALF_W; dx <= HEAT_HALF_W; dx++) {
        // The basin interior is an ingredient space, not a burner.
        if (Math.abs(dx) <= BASIN_HALF_W && dy >= BASIN_TOP && dy <= BASIN_BOTTOM) continue;
        const x = cauldron.x + dx, y = cauldron.y + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) return true;
      }
    }
    return false;
  }

  /** Transmute every cell the recipe consumes (every brewable cell, and the solids it named) into its elixir. */
  private finishBrew(ctx: Ctx, cauldron: { x: number; y: number }, recipe: Recipe): void {
    const world = ctx.world;
    const colorFn = COLOR_FN[recipe.elixir];
    for (let dy = BASIN_TOP; dy <= BASIN_BOTTOM; dy++) {
      for (let dx = -BASIN_HALF_W; dx <= BASIN_HALF_W; dx++) {
        const x = cauldron.x + dx, y = cauldron.y + dy;
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        if (!consumedBy(recipe, world.types[i])) continue;
        world.replaceCellAt(i, recipe.elixir, colorFn());
      }
    }
    ctx.particles.burst(cauldron.x, cauldron.y + BASIN_TOP, 24, null, colorFn, 2.0, {
      glow: 2.0,
      grav: -0.02,
    });
    ctx.audio.bubble(cauldron.x, cauldron.y);
    ctx.audio.sfx('mech.cauldron', cauldron.x, cauldron.y);
    const firstDiscovery = this.recordDiscovery(ctx, recipe);
    ctx.events.emit('recipeBrewed', { id: recipe.id, name: recipe.name, firstDiscovery });
  }

  /** Grimoire: first-ever brew of a recipe pays a small one-time gold bounty. */
  private recordDiscovery(ctx: Ctx, recipe: Recipe): boolean {
    if (!recordRecipeDiscovery(ctx, recipe.id, recipe.name)) return false;
    ctx.state.score += DISCOVERY_BOUNTY;
    ctx.events.emit('scoreChanged', { score: ctx.state.score });
    ctx.events.emit('recipeDiscovered', { name: recipe.name, bounty: DISCOVERY_BOUNTY });
    ctx.telemetry.count('brew.' + recipe.id);
    return true;
  }

  // ===================== The experiment =====================

  /**
   * A bowl that matches no recipe. Heated, with enough in it to be a real try, and left alone
   * for a moment, it is an ATTEMPT: judged once per mix, written into the Grimoire's log, answered
   * with a sound and a few motes. Cold, it only says it needs fire.
   */
  private noMatch(ctx: Ctx, cauldron: { x: number; y: number }, sample: BasinSample, sig: string, heated: boolean): void {
    // A bowl nobody is tending is not an experiment (settling drips over a forgotten fire).
    const tended = Math.hypot(ctx.player.x - cauldron.x, ctx.player.y - cauldron.y) <= HINT_RADIUS;
    if (!tended || sample.mass < ATTEMPT_MIN_MASS) {
      this.attemptSig = '';
      this.attemptTicks = 0;
      this.judged = null;
      return;
    }
    if (!heated) {
      this.emitHint(ctx, 'CAULDRON: NEEDS HEAT');
      this.attemptTicks = Math.max(0, this.attemptTicks - 1);
      return;
    }
    if (sig !== this.attemptSig) {
      this.attemptSig = sig;
      this.attemptTicks = 0;
      this.judged = null;
    }
    if (this.judged) return;
    this.attemptTicks++;
    if (this.attemptTicks < ATTEMPT_TICKS || ctx.state.frameCount - this.lastJudgeFrame < ATTEMPT_GAP_FRAMES) return;
    this.judge(ctx, cauldron, sample, sig);
  }

  private judge(ctx: Ctx, cauldron: { x: number; y: number }, sample: BasinSample, sig: string): void {
    const known = loadDiscoveredRecipes();
    const a = assessMix(sample.counts as Histogram, RECIPES, known);
    this.lastJudgeFrame = ctx.state.frameCount;
    this.judged = { sig, feel: a.feel, verdict: a.verdict, missing: a.missing };
    const counts: Record<string, number> = {};
    for (const k in sample.counts) counts[k] = sample.counts[k];
    const feel: Record<string, MixFeel> = {};
    for (const k in a.feel) feel[k] = a.feel[k];
    const logged = recordExperiment({
      sig, counts, verdict: a.verdict,
      ...(a.closeTo ? { closeTo: a.closeTo.id } : {}),
      ...(Object.keys(feel).length > 0 ? { feel } : {}),
    });
    const info: BrewAttemptInfo = {
      counts: { ...sample.counts },
      verdict: a.verdict,
      closeTo: a.closeTo?.id ?? null,
      closeToKnown: a.closeTo ? known[a.closeTo.id] === true : false,
      feel: a.feel,
      missing: a.missing,
      first: logged.first,
      tries: logged.tries,
    };
    ctx.telemetry.count('brew.attempt.' + a.verdict);
    this.answer(ctx, cauldron, sample, info, a.closeTo?.name ?? null);
    ctx.events.emit('brewAttempt', info);
  }

  /** The cauldron's answer to a judged mix: a line, a sound, a few motes of the right kind. */
  private answer(ctx: Ctx, cauldron: { x: number; y: number }, sample: BasinSample, info: BrewAttemptInfo, name: string | null): void {
    const x = cauldron.x, y = cauldron.y + BASIN_TOP;
    if (info.verdict === 'close') {
      this.emitHint(ctx, info.closeToKnown && name ? `CAULDRON: SHORT OF ${name}` : 'CAULDRON: THE BREW SHIMMERS. YOU ARE CLOSE TO SOMETHING');
      ctx.audio.sfx('brew.shimmer', cauldron.x, cauldron.y);
      ctx.particles.burst(x, y, 14, null, () => packRGB(255, 232, 150), 1.4, { glow: 2.2, grav: -0.03 });
    } else if (info.verdict === 'muddy') {
      this.emitHint(ctx, 'CAULDRON: THE BREW CLOUDS. SOMETHING DOES NOT BELONG');
      ctx.audio.sfx('brew.fizzle', cauldron.x, cauldron.y);
      ctx.particles.burst(x, y, 12, null, () => packRGB(110, 92, 70), 1.2, { glow: 0.2, grav: -0.02 });
    } else {
      this.emitHint(ctx, 'CAULDRON: NOTHING STIRS');
      ctx.audio.sfx('brew.fizzle', cauldron.x, cauldron.y);
      ctx.particles.burst(x, y, 8, null, this.bowlColor(sample), 0.9, { glow: 0.3, grav: -0.02 });
    }
  }

  // ===================== The panel's view =====================

  private hideView(ctx: Ctx): void {
    if (!this.current.visible) return;
    this.current = HIDDEN_VIEW;
    this.viewKey = '';
    ctx.events.emit('cauldronView', this.current);
  }

  /** Build the bowl panel's view and emit it when it changed (or when the player walked away). */
  private publish(ctx: Ctx, cauldron: { x: number; y: number }, sample: BasinSample, heated: boolean, recipe: Recipe | null): void {
    if (Math.hypot(ctx.player.x - cauldron.x, ctx.player.y - cauldron.y) > VIEW_RADIUS) {
      this.hideView(ctx);
      return;
    }
    const sig = mixSignature(sample.counts);
    const judged = this.judged && this.judged.sig === sig ? this.judged : null;
    const reagents = Object.keys(sample.counts)
      .map(Number)
      .sort((a, b) => sample.counts[b] - sample.counts[a] || a - b)
      .map((cell) => ({ cell, n: sample.counts[cell], feel: judged ? judged.feel[cell] ?? null : null }));
    const progress = recipe && heated ? Math.min(1, this.brewTicks / BREW_TICKS_REQUIRED) : 0;
    const view: CauldronView = {
      visible: true,
      x: cauldron.x,
      y: cauldron.y,
      reagents,
      mass: mixMass(sample.counts),
      heated,
      progress,
      matched: recipe !== null && heated,
      verdict: judged ? judged.verdict : null,
      missing: judged ? judged.missing : 0,
      elixir: sample.elixir,
    };
    const key = `${sig}|${heated ? 1 : 0}|${Math.round(progress * 30)}|${view.matched ? 1 : 0}|${view.verdict ?? ''}|${view.missing}|${reagents.map((r) => r.feel ?? '-').join('')}|${sample.elixir ? `${sample.elixir.cell}:${sample.elixir.n}` : ''}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.current = view;
    ctx.events.emit('cauldronView', view);
  }
}
