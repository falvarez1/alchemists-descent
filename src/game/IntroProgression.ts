import { START_LEVEL } from '@/config/worldgraph';
import type { CardId, Ctx, LevelRuntime } from '@/core/types';
import { INTRO_OBJECTIVE, INTRO_REWARD_CARD } from '@/game/introObjectives';
import { Cell } from '@/sim/CellType';

type IntroStage = 'surface' | 'movement' | 'spark' | 'dig' | 'flask' | 'spellLab' | 'bench' | 'complete';

interface IntroFlags {
  moved: boolean;
  jumpedOrLevitated: boolean;
  sparked: boolean;
  dug: boolean;
  flaskUsed: boolean;
  reachedLab: boolean;
  labDug: boolean;
  labWatered: boolean;
  labSparked: boolean;
}

const MOVE_DISTANCE = 20;
const JUMP_DISTANCE = 5;
const LAB_RADIUS = 54;

const STAGE_COPY: Record<IntroStage, { objective: string; title: string; body: string }> = {
  surface: {
    objective: INTRO_OBJECTIVE.surface,
    title: 'The Descent Begins',
    body: 'Welcome, alchemist. The cave mouth beside your cabin is the way down. Move with A and D, jump with SPACE, then drop into the shaft to begin.',
  },
  movement: {
    objective: INTRO_OBJECTIVE.movement,
    title: 'The Descent',
    body: 'Run, jump, and tap levitation until moving through uneven cave ground feels deliberate.',
  },
  spark: {
    objective: INTRO_OBJECTIVE.spark,
    title: 'Wand I',
    body: 'Your first wand is the fight-and-trigger wand. Aim it at the cave, then fire a Spark.',
  },
  dig: {
    objective: INTRO_OBJECTIVE.dig,
    title: 'Wand II',
    body: 'Swap to the excavation wand and cut real cells away. Sand, soft rock, and hidden seams all obey the grid.',
  },
  flask: {
    objective: INTRO_OBJECTIVE.flask,
    title: 'The Flask',
    body: 'The starter flask already carries water. Pour, throw, drink, or siphon materials to learn that carried cells stay real.',
  },
  spellLab: {
    objective: INTRO_OBJECTIVE.spellLab,
    title: 'Spell Lab',
    body: 'The D1 lab is a quiet annex of real-cell stations: dig sand, burn wood, test water, spark a latch, then claim the tome.',
  },
  bench: {
    objective: INTRO_OBJECTIVE.bench,
    title: 'Wand Bench',
    body: 'At the Refuge, slot Heavy into a wand to change how the next casts behave. Cards are progression; the bench turns them into verbs.',
  },
  complete: {
    objective: INTRO_OBJECTIVE.findKey,
    title: 'Into The Depths',
    body: 'You have the core verbs. Read the cave, solve with materials, find the Golden Key, and return to the portal.',
  },
};

function initialFlags(): IntroFlags {
  return {
    moved: false,
    jumpedOrLevitated: false,
    sparked: false,
    dug: false,
    flaskUsed: false,
    reachedLab: false,
    labDug: false,
    labWatered: false,
    labSparked: false,
  };
}

function hasCard(ctx: Ctx, id: CardId): boolean {
  return ctx.wands.collection.includes(id) || cardSlotted(ctx, id);
}

function cardSlotted(ctx: Ctx, id: CardId): boolean {
  return ctx.wands.wands.some((wand) => wand.cards.includes(id));
}

/**
 * D1 onboarding is not a modal tutorial. It is a light progression spine over
 * existing real-cell lessons: the controller only watches gameplay facts and
 * changes the HUD objective/teach card as the player demonstrates each verb.
 */
export class IntroProgression {
  private readonly disposers: Array<() => void> = [];
  private levelId: string | null = null;
  private startX = 0;
  private startY = 0;
  private startLevit = 0;
  private flags = initialFlags();
  private stage: IntroStage | null = null;
  private lastObjective = '';
  private taught = new Set<IntroStage>();

  constructor(private readonly ctx: Ctx) {
    this.disposers.push(ctx.events.on('cardCast', ({ id, origin, x, y }) => {
      if (origin !== 'wand' || !this.isActiveIntroRuntime()) return;
      if (id === 'spark') this.flags.sparked = true;
      if (id === 'dig') this.flags.dug = true;
      if (id === 'dig' && this.isPointInLab(x, y)) this.flags.labDug = true;
      if (id === 'spark' && this.isPointInLab(x, y)) this.flags.labSparked = true;
    }));
    this.disposers.push(ctx.events.on('flaskUsed', ({ verb, material, amount }) => {
      if (amount > 0 && this.isActiveIntroRuntime()) this.flags.flaskUsed = true;
      if (
        amount > 0 &&
        material === Cell.Water &&
        (verb === 'pour' || verb === 'throw' || verb === 'siphon') &&
        this.isPlayerInLab()
      ) {
        this.flags.labWatered = true;
      }
    }));
    this.disposers.push(ctx.events.on('cardGranted', ({ id }) => {
      if (id === INTRO_REWARD_CARD && this.isActiveIntroRuntime()) this.flags.reachedLab = true;
    }));
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  update(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!this.isIntroRuntime(ctx, runtime)) {
      this.levelId = null;
      this.stage = null;
      this.lastObjective = '';
      return;
    }

    if (runtime.def.id !== this.levelId) this.resetFor(runtime, ctx);
    this.updateFlags(ctx, runtime);

    const nextStage = this.resolveStage(ctx, runtime);
    const objective = this.objectiveFor(nextStage, runtime);
    if (objective !== this.lastObjective) {
      this.lastObjective = objective;
      ctx.events.emit('objectiveChanged', { text: objective });
    }
    if (nextStage !== this.stage) {
      this.stage = nextStage;
      this.teachStage(ctx, nextStage);
    }
  }

  private resetFor(runtime: LevelRuntime, ctx: Ctx): void {
    this.levelId = runtime.def.id;
    // Track movement from wherever the wizard actually starts — the surface on
    // first entry, the cave spawn otherwise.
    const start = runtime.surfaceSpawn && !runtime.surfaceDescended ? runtime.surfaceSpawn : runtime.spawn;
    this.startX = start.x;
    this.startY = start.y;
    this.startLevit = ctx.player.levit;
    this.flags = initialFlags();
    this.stage = null;
    this.lastObjective = '';
    this.taught.clear();
  }

  private updateFlags(ctx: Ctx, runtime: LevelRuntime): void {
    const dx = ctx.player.x - this.startX;
    const dy = ctx.player.y - this.startY;
    if (Math.hypot(dx, dy) >= MOVE_DISTANCE || Math.abs(ctx.player.vx) > 0.9) this.flags.moved = true;
    if (
      this.startY - ctx.player.y >= JUMP_DISTANCE ||
      ctx.player.levit < this.startLevit - 3 ||
      ctx.input.keys.jump ||
      ctx.input.keys.up
    ) {
      this.flags.jumpedOrLevitated = true;
    }

    const lab = runtime.spellLab;
    if (lab) {
      const lx = ctx.player.x - lab.x;
      const ly = ctx.player.y - lab.y;
      if (lx * lx + ly * ly <= LAB_RADIUS * LAB_RADIUS) this.flags.reachedLab = true;
    }
  }

  private resolveStage(ctx: Ctx, runtime: LevelRuntime): IntroStage {
    // Still up top in the daylight: the only lesson is to drop into the cave.
    if (runtime.surfaceSpawn && !runtime.surfaceDescended) return 'surface';
    if (runtime.spellLab && !cardSlotted(ctx, INTRO_REWARD_CARD)) {
      if (ctx.wands.collection.includes(INTRO_REWARD_CARD)) return 'bench';
      if (runtime.keyTaken || this.flags.reachedLab || this.flags.labDug || this.flags.labWatered || this.flags.labSparked) {
        return 'spellLab';
      }
    }
    if (runtime.keyTaken) return 'complete';
    if (runtime.spellLab && cardSlotted(ctx, INTRO_REWARD_CARD)) return 'complete';
    if (!this.flags.moved || !this.flags.jumpedOrLevitated) return 'movement';
    if (!this.flags.sparked) return 'spark';
    if (!this.flags.dug) return 'dig';
    if (!this.flags.flaskUsed) return 'flask';
    if (runtime.spellLab && !this.labRewardTaken(ctx, runtime)) return 'spellLab';
    return 'complete';
  }

  private objectiveFor(stage: IntroStage, runtime: LevelRuntime): string {
    if (stage === 'bench') return STAGE_COPY.bench.objective;
    if (stage === 'spellLab' && this.flags.reachedLab) return this.spellLabObjective();
    if (runtime.keyTaken) return INTRO_OBJECTIVE.returnPortal;
    return STAGE_COPY[stage].objective;
  }

  private spellLabObjective(): string {
    if (!this.flags.labDug) return INTRO_OBJECTIVE.labDig;
    if (!this.flags.labWatered) return INTRO_OBJECTIVE.labWater;
    if (!this.flags.labSparked) return INTRO_OBJECTIVE.labSpark;
    return INTRO_OBJECTIVE.labTome;
  }

  private labRewardTaken(ctx: Ctx, runtime: LevelRuntime): boolean {
    const lab = runtime.spellLab;
    if (!lab) return true;
    if (hasCard(ctx, INTRO_REWARD_CARD)) return true;
    return runtime.pickups.some((pickup) => {
      if (pickup.kind !== 'tome') return false;
      if (Math.abs(pickup.x - lab.rewardX) > 3 || Math.abs(pickup.y - lab.rewardY) > 3) return false;
      return pickup.taken === true;
    });
  }

  private teachStage(ctx: Ctx, stage: IntroStage): void {
    if (this.taught.has(stage)) return;
    this.taught.add(stage);
    const copy = STAGE_COPY[stage];
    ctx.events.emit('hintTeach', {
      key: `intro-${stage}`,
      title: copy.title,
      body: copy.body,
    });
  }

  private isActiveIntroRuntime(): boolean {
    return this.isIntroRuntime(this.ctx, this.ctx.levels.current);
  }

  private isPlayerInLab(): boolean {
    return this.isPointInLab(this.ctx.player.x, this.ctx.player.y);
  }

  private isPointInLab(x: number, y: number): boolean {
    const runtime = this.ctx.levels.current;
    const lab = runtime?.spellLab;
    if (!lab || !this.isIntroRuntime(this.ctx, runtime)) return false;
    const dx = x - lab.x;
    const dy = y - lab.y;
    return dx * dx + dy * dy <= LAB_RADIUS * LAB_RADIUS;
  }

  private isIntroRuntime(ctx: Ctx, runtime: LevelRuntime | null): runtime is LevelRuntime {
    if (!runtime || ctx.state.mode !== 'play' || ctx.player.dead) return false;
    if (runtime.def.id !== START_LEVEL && !runtime.spellLab) return false;
    if (runtime.def.depth !== 1 || runtime.def.branch) return false;
    return ctx.state.playtestSource !== 'builder' && runtime.def.id !== 'custom';
  }
}
