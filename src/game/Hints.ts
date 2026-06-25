import type { Ctx, HintApi, HintInfo } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { INTRO_REWARD_CARD } from '@/game/introObjectives';
import { getSeenHints, markHintSeen } from '@/game/hints/seenHints';

/** A teach-once popover body, paired with a contextual hint line. */
interface Teach {
  title: string;
  body: string;
}

/** A scored candidate hint: highest priority wins, nearest breaks ties. */
interface Candidate {
  priority: number;
  dist2: number;
  info: HintInfo;
  teach: Teach | null;
}

interface CellHit {
  x: number;
  y: number;
  d2: number;
}

/** Reach (cells, squared) at which each kind of interactable starts hinting. */
const R_OBJECT = 24 * 24;
const R_GOAL = 32 * 32;
const FLASK_SCAN = 10; // half-box (cells) swept around the player for siphonables

/**
 * Surfaces the single most relevant "what do I do here" hint for whatever the
 * player is standing near, so the early game stops being a guessing game. Three
 * tiers cooperate: the HUD shows `current.line` (tier 2), FrameComposer pulses a
 * marker over `current.world` (tier 1), and the FIRST time a category is seen we
 * emit `hintTeach` for a one-time popover (tier 3). Recomputed every 4th frame;
 * `current` holds steady in between.
 */
export class HintSystem implements HintApi {
  private _current: HintInfo | null = null;
  private readonly taught: Set<string>;

  constructor(_ctx: Ctx) {
    this.taught = new Set<string>(getSeenHints());
  }

  get current(): HintInfo | null {
    return this._current;
  }

  update(ctx: Ctx): void {
    if (ctx.state.frameCount % 4 !== 0) return;
    if (ctx.state.mode !== 'play' || ctx.state.paused || ctx.player.dead || !ctx.levels.current) {
      this._current = null;
      return;
    }
    const runtime = ctx.levels.current;
    const px = ctx.player.x;
    const py = ctx.player.y;
    const w = ctx.world;
    const pcx = Math.floor(px);
    const pcy = Math.floor(py);
    const candidates: Candidate[] = [];
    const consider = (c: Candidate): void => {
      candidates.push(c);
    };
    const nearestCell = (radius: number, accepts: (type: number) => boolean): CellHit | null => {
      let best: CellHit | null = null;
      const r2 = radius * radius;
      for (let yy = pcy - radius; yy <= pcy + radius; yy++) {
        for (let xx = pcx - radius; xx <= pcx + radius; xx++) {
          const d2 = (xx - px) ** 2 + (yy - py) ** 2;
          if (d2 > r2 || !w.inBounds(xx, yy)) continue;
          if (!accepts(w.types[w.idx(xx, yy)])) continue;
          if (!best || d2 < best.d2) best = { x: xx, y: yy, d2 };
        }
      }
      return best;
    };

    // --- the level goal loop: key + portal (highest priority) ---
    const portal = runtime.portal;
    if (portal) {
      const d2 = (portal.x - px) ** 2 + (portal.y - py) ** 2;
      if (d2 <= R_GOAL) {
        const heavySlotted = ctx.wands.wands.some((wand) => wand.cards.includes(INTRO_REWARD_CARD));
        const benchBlocked = runtime.def.depth === 1 && !runtime.def.branch && runtime.keyTaken && !heavySlotted;
        let line = 'The portal is sealed — bring it the Golden Key';
        if (benchBlocked) {
          if (ctx.wands.collection.includes(INTRO_REWARD_CARD)) {
            line = 'The portal rejects you — slot Heavy at the Wand Bench';
          } else {
            line = 'The portal rejects you — claim Heavy from the Spell Lab';
          }
        } else if (portal.open || runtime.keyTaken) {
          line = 'The portal is open — step in to descend';
        }
        consider({
          priority: 3,
          dist2: d2,
          info: { key: 'portal', line, world: { x: portal.x, y: portal.y } },
          teach: { title: 'The Portal', body: 'The way down. It opens once you carry the Golden Key to it.' },
        });
      }
    }
    if (!runtime.keyTaken) {
      for (const pk of runtime.pickups) {
        if (pk.taken || pk.kind !== 'key') continue;
        const d2 = (pk.x - px) ** 2 + (pk.y - py) ** 2;
        if (d2 <= R_GOAL) {
          consider({
            priority: 3,
            dist2: d2,
            info: { key: 'key', line: 'Grab the Golden Key — it unseals the portal', world: { x: Math.round(pk.x), y: Math.round(pk.y) } },
            teach: { title: 'The Golden Key', body: 'Take the key, then reach the portal to descend. No key, no exit.' },
          });
        }
      }
    }

    // --- D1 teaching spine: real-cell stations, not abstract tutorial triggers ---
    if (runtime.spellLab) {
      const lab = runtime.spellLab;
      const d2 = (lab.x - px) ** 2 + (lab.y - py) ** 2;
      if (d2 <= 44 * 44) {
        const rewardTaken =
          ctx.wands.collection.includes(INTRO_REWARD_CARD) ||
          ctx.wands.wands.some((wand) => wand.cards.includes(INTRO_REWARD_CARD)) ||
          runtime.pickups.some(
            (pickup) =>
              pickup.kind === 'tome' &&
              pickup.taken &&
              Math.abs(pickup.x - lab.rewardX) <= 3 &&
              Math.abs(pickup.y - lab.rewardY) <= 3,
          );
        consider({
          priority: 2.05,
          dist2: d2,
          info: {
            key: 'spell-lab',
            line: rewardTaken
              ? 'Spell Lab cleared — press B to slot the new card at the wand bench'
              : 'Spell Lab: dig sand, burn wood, use water, spark the coil, claim the tome',
            world: { x: lab.x, y: lab.y },
          },
          teach: {
            title: 'Spell Lab',
            body: 'A safe annex for practicing the starter verbs on real cells. The tome is the reward for speaking the cave language.',
          },
        });
      }
    }

    // --- the cauldron: brewing ---
    const cauldron = runtime.cauldron;
    if (cauldron) {
      const d2 = (cauldron.x - px) ** 2 + (cauldron.y - py) ** 2;
      if (d2 <= R_OBJECT) {
        consider({
          priority: 2,
          dist2: d2,
          info: { key: 'cauldron', line: 'Fill the bowl with materials, then heat it — Q pours from your flask', world: { x: cauldron.x, y: cauldron.y } },
          teach: { title: 'Brewing', body: 'Drop real materials into the cauldron bowl (or pour them from your flask) and add heat — it brews an elixir you can drink.' },
        });
      }
    }

    // --- mechanisms the player actuates: levers, plates, dispensers ---
    for (const m of runtime.mechanisms) {
      const spec = MECHANISM_HINTS[m.kind];
      if (!spec) continue;
      const d2 = (m.x - px) ** 2 + (m.y - py) ** 2;
      if (d2 <= R_OBJECT) {
        consider({ priority: 2, dist2: d2, info: { key: spec.key, line: spec.line, world: { x: m.x, y: m.y } }, teach: spec.teach });
      }
    }

    if (runtime.def.depth === 1 && !runtime.keyTaken) {
      // One hot-cell scan serves both the burn-wood and carried-cells hints.
      const hot = nearestCell(18, (type) => type === Cell.Fire || type === Cell.Ember || type === Cell.Lava);
      const wood = nearestCell(14, (type) => type === Cell.Wood);
      if (wood && hot) {
        consider({
          priority: 1.7,
          dist2: Math.min(wood.d2, hot.d2),
          info: { key: 'burn-wood', line: 'Fire eats wood — lead flame into wooden seals and braziers', world: { x: wood.x, y: wood.y } },
          teach: { title: 'Burning Seals', body: 'Wood is a real cell, not a scripted lock. Bring fire to it and the cave opens honestly.' },
        });
      }

      const sand = nearestCell(12, (type) => type === Cell.Sand);
      if (sand) {
        consider({
          priority: 1.6,
          dist2: sand.d2,
          info: { key: 'dig-sand', line: 'Loose sand falls — excavate it, siphon it, or let gravity reveal what is below', world: { x: sand.x, y: sand.y } },
          teach: { title: 'Loose Materials', body: 'Sand, gold dust, and powders are movable cells. Cut support away and the sim does the rest.' },
        });
      }

      const flask = ctx.flask.state;
      const carried = flask.count > 0 && flask.material !== null;
      if (carried && hot) {
        consider({
          priority: 1.8,
          dist2: hot.d2,
          info: { key: 'carried-cells', line: 'Flask: Q pours carried cells · RMB throws the bottle', world: { x: hot.x, y: hot.y } },
          teach: { title: 'Carried Cells', body: 'A flask stores exact cells from the world. Pour or throw them back out to douse, flood, weigh, or conduct.' },
        });
      }
    }

    // --- the flask (fallback): any siphonable liquid within reach ---
    // Grid scans MUST use integer cell coords: player.x/y are continuous floats,
    // and World.idx doesn't floor, so a fractional index reads undefined and the
    // hint (plus its one-time teach popover) would silently never fire.
    let liquid: { x: number; y: number; d2: number } | null = null;
    for (let yy = pcy - FLASK_SCAN; yy <= pcy + 2; yy++) {
      for (let xx = pcx - FLASK_SCAN; xx <= pcx + FLASK_SCAN; xx++) {
        if (!w.inBounds(xx, yy)) continue;
        if (!isLiquid(w.types[w.idx(xx, yy)])) continue;
        const d2 = (xx - px) ** 2 + (yy - py) ** 2;
        if (!liquid || d2 < liquid.d2) liquid = { x: xx, y: yy, d2 };
      }
    }
    if (liquid) {
      consider({
        priority: 1,
        dist2: liquid.d2,
        info: { key: 'flask', line: 'Flask: hold E siphon · Q pour · X drink · RMB throw', world: { x: liquid.x, y: liquid.y } },
        teach: { title: 'The Flask', body: 'Hold E to siphon liquid or loose powder into the flask, Q to pour it back out, X to drink it, right-click to hurl the bottle.' },
      });
    }

    let best: Candidate | null = null;
    for (const c of candidates) {
      if (!best || c.priority > best.priority || (c.priority === best.priority && c.dist2 < best.dist2)) best = c;
    }
    this._current = best ? best.info : null;
    if (best && best.teach && !this.taught.has(best.info.key)) {
      this.taught.add(best.info.key);
      markHintSeen(best.info.key);
      ctx.events.emit('hintTeach', { key: best.info.key, title: best.teach.title, body: best.teach.body });
    }
  }
}

/** Per-mechanism-kind hint copy (only the kinds the player directly actuates). */
const MECHANISM_HINTS: Partial<Record<string, { key: string; line: string; teach: Teach }>> = {
  lever: {
    key: 'lever',
    line: 'Press E to pull the lever',
    teach: { title: 'Levers', body: 'Pull a lever with E. It drives a linked door, gate, or dispenser somewhere nearby.' },
  },
  plate: {
    key: 'plate',
    line: 'Stand on the plate to trigger it',
    teach: { title: 'Pressure Plates', body: 'Step on a plate to trigger whatever it is wired to. Some need weight kept on them to stay down.' },
  },
  dispenser: {
    key: 'dispenser',
    line: 'A dispenser — it drops its cargo when powered',
    teach: { title: 'Dispensers', body: 'A dispenser spits out its cargo when a lever or plate powers it. Find the trigger.' },
  },
  chargelatch: {
    key: 'chargelatch',
    line: 'Spark the coil — any charged cell in its mouth latches it',
    teach: { title: 'Charge Latches', body: 'Coils read charge from real cells. Spark, lightning, or charged water can all satisfy the same latch.' },
  },
};
