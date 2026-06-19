import type { Ctx } from '@/core/types';
import { recordRecipeDiscovery } from '@/game/GrimoireStore';
import { Cell, isLiquid } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';

/**
 * Cauldron brewing (DESIGN.md pillar 7): the basin's contents are read as a
 * literal grid histogram — you physically pour reagents in and physically keep
 * a fire burning under the stone base. Nothing is abstracted: a brew is a
 * transmutation of the real cells sitting in the bowl, so spillage is loss and
 * an explosion mid-brew is a ruined batch.
 *
 * First-time brews are recorded in the Grimoire (localStorage) for a one-time
 * gold bounty — recipe knowledge is the part that persists across expeditions.
 */

export interface Recipe {
  /** Stable Grimoire/telemetry key. */
  id: string;
  /** Banner name, upper case to match the banner voice. */
  name: string;
  elixir: Cell;
  /** Basin histogram requirements: minimum cell counts that must all be met. */
  needs: Array<{ cell: Cell; min: number }>;
}

interface BasinSample {
  counts: Record<number, number>;
  brewableMass: number;
}

/*
 * Thresholds are sized to the STAMPED bowl: the generator builds a 7-wide
 * interior with 2-tall walls (cauldron.y is the bottom interior row), so the
 * bowl reliably holds ~14 cells before overflowing the rim. Requirements must
 * be pourable by a player with one 600-cell flask and an honest aim.
 */
export const RECIPES: Recipe[] = [
  {
    id: 'life',
    name: 'ELIXIR OF LIFE',
    elixir: Cell.ElixirLife,
    needs: [
      { cell: Cell.Water, min: 10 },
      { cell: Cell.Gold, min: 3 },
    ],
  },
  {
    id: 'levity',
    name: 'ELIXIR OF LEVITY',
    elixir: Cell.ElixirLevity,
    needs: [
      { cell: Cell.Water, min: 9 },
      { cell: Cell.Slime, min: 4 },
    ],
  },
  {
    id: 'stone',
    name: 'ELIXIR OF STONE',
    elixir: Cell.ElixirStone,
    needs: [
      { cell: Cell.Blood, min: 8 },
      { cell: Cell.Sand, min: 4 },
    ],
  },
];

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

/** Sustained heat+ingredient sampler ticks (1 tick per 4 frames) to finish a brew. */
const BREW_TICKS_REQUIRED = 90;
export { GRIMOIRE_KEY, loadDiscoveredRecipes } from '@/game/GrimoireStore';
const DISCOVERY_BOUNTY = 100;

/** Loose powders count as brewable mass alongside liquids (they sink into the bowl). */
function isBrewable(t: number): boolean {
  return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
}

// ===================== Cauldron Brewing =====================
export class Brewing {
  private brewTicks = 0;
  private activeBrewKey: string | null = null;
  private lastHintFrame = -9999;
  private lastHintText = '';

  /** Play-mode only; samples the basin every 4th frame. */
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') {
      this.resetProgress();
      return;
    }
    const cauldron = ctx.levels.current?.cauldron;
    if (!cauldron) {
      this.resetProgress();
      return;
    }
    if (ctx.state.frameCount % 4 !== 0) return;

    const sample = this.sampleBasin(ctx, cauldron);
    const recipe = this.matchRecipe(sample);
    const heated = this.hasHeat(ctx, cauldron);
    if (!recipe) {
      if (sample.brewableMass > 0) {
        this.emitHint(ctx, heated ? 'CAULDRON: WRONG MIX' : 'CAULDRON: NEEDS HEAT');
      }
      this.resetProgress();
      return;
    }
    const key = this.brewKey(ctx, cauldron, recipe);
    if (this.activeBrewKey !== key) {
      this.activeBrewKey = key;
      this.brewTicks = 0;
    }
    if (!heated) {
      this.emitHint(ctx, 'CAULDRON: NEEDS HEAT');
      if (this.brewTicks > 0) this.brewTicks--;
      if (this.brewTicks === 0) this.activeBrewKey = null;
      return;
    }

    if (this.brewTicks === 0) this.emitHint(ctx, `CAULDRON: BREWING ${recipe.name}`);
    this.brewTicks++;
    // Simmer ambience: blub + a wisp or two of recipe-colored vapor rising off the bowl.
    if (ctx.state.frameCount % 8 === 0) {
      ctx.audio.bubble();
      const colorFn = COLOR_FN[recipe.elixir];
      const wisps = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let j = 0; j < wisps; j++) {
        const px = cauldron.x + Math.floor(Math.random() * (BASIN_HALF_W * 2 + 1)) - BASIN_HALF_W;
        const py = cauldron.y + BASIN_TOP - 1;
        ctx.particles.spawn(px, py, (Math.random() - 0.5) * 0.3, -0.3 - Math.random() * 0.4,
          null, colorFn(), 25 + Math.floor(Math.random() * 15), { grav: -0.04, glow: 1.3 });
      }
    }

    if (this.brewTicks >= BREW_TICKS_REQUIRED) {
      this.finishBrew(ctx, cauldron, recipe);
      this.resetProgress();
    }
  }

  private resetProgress(): void {
    this.brewTicks = 0;
    this.activeBrewKey = null;
  }

  private emitHint(ctx: Ctx, text: string): void {
    if (this.lastHintText === text && ctx.state.frameCount - this.lastHintFrame < 120) return;
    this.lastHintText = text;
    this.lastHintFrame = ctx.state.frameCount;
    ctx.events.emit('toast', { text });
  }

  private brewKey(ctx: Ctx, cauldron: { x: number; y: number }, recipe: Recipe): string {
    return `${ctx.levels.current?.def.id ?? 'sandbox'}:${cauldron.x},${cauldron.y}:${recipe.id}`;
  }

  private sampleBasin(ctx: Ctx, cauldron: { x: number; y: number }): BasinSample {
    const world = ctx.world;
    const counts: Record<number, number> = {};
    let brewableMass = 0;
    for (let dy = BASIN_TOP; dy <= BASIN_BOTTOM; dy++) {
      for (let dx = -BASIN_HALF_W; dx <= BASIN_HALF_W; dx++) {
        const x = cauldron.x + dx, y = cauldron.y + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.types[world.idx(x, y)];
        counts[t] = (counts[t] ?? 0) + 1;
        if (isBrewable(t)) brewableMass++;
      }
    }
    return { counts, brewableMass };
  }

  /** Return the first recipe satisfied by the sampled basin histogram. */
  private matchRecipe(sample: BasinSample): Recipe | null {
    for (const recipe of RECIPES) {
      if (recipe.needs.every((n) => (sample.counts[n.cell] ?? 0) >= n.min)) return recipe;
    }
    return null;
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

  /** Transmute every brewable cell in the basin into the recipe's elixir. */
  private finishBrew(ctx: Ctx, cauldron: { x: number; y: number }, recipe: Recipe): void {
    const world = ctx.world;
    const colorFn = COLOR_FN[recipe.elixir];
    for (let dy = BASIN_TOP; dy <= BASIN_BOTTOM; dy++) {
      for (let dx = -BASIN_HALF_W; dx <= BASIN_HALF_W; dx++) {
        const x = cauldron.x + dx, y = cauldron.y + dy;
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y);
        if (!isBrewable(world.types[i])) continue;
        world.types[i] = recipe.elixir;
        world.colors[i] = colorFn();
        world.life[i] = 0;
        world.charge[i] = 0;
      }
    }
    ctx.particles.burst(cauldron.x, cauldron.y + BASIN_TOP, 24, null, colorFn, 2.0, {
      glow: 2.0,
      grav: -0.02,
    });
    ctx.audio.bubble();
    ctx.audio.tone(360, 720, 0.22, 'sine', 0.10);
    const firstDiscovery = this.recordDiscovery(ctx, recipe);
    ctx.events.emit('recipeBrewed', { id: recipe.id, name: recipe.name, firstDiscovery });
  }

  /** Grimoire: first-ever brew of a recipe pays a one-time gold bounty. */
  private recordDiscovery(ctx: Ctx, recipe: Recipe): boolean {
    if (!recordRecipeDiscovery(ctx, recipe.id, recipe.name)) return false;
    ctx.state.score += DISCOVERY_BOUNTY;
    ctx.events.emit('scoreChanged', { score: ctx.state.score });
    ctx.events.emit('recipeDiscovered', { name: recipe.name, bounty: DISCOVERY_BOUNTY });
    ctx.telemetry.count('brew.' + recipe.id);
    return true;
  }
}
