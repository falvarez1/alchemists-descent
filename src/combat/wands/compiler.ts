import type { CardId } from '@/core/types';
import { CARD_DEFS, MULTICAST_SIZE } from './cards';

/**
 * The deterministic cast compiler (DESIGN.md pillar 6, "restrained").
 *
 * Cards execute left-to-right, no shuffle:
 *  - modifier cards accumulate into a pending pack consumed by the NEXT
 *    projectile card;
 *  - multicast cards (double/triple) group the following N projectile casts
 *    into one cast group (stacking multicasts add their counts);
 *  - 'trigger' is itself a modifier on the next projectile P1: P1's impact
 *    casts the FOLLOWING program group (the next projectile P2 with ITS mods)
 *    at the impact point. The payload group is consumed by the host — it is
 *    NOT a separate step of the program, and its mana is folded into the
 *    host group (paid up front at cast time).
 *
 * Clamps, enforced HERE so no execution path can dodge them:
 *  - total damage multiplier <= x4 per action;
 *  - <= 6 projectile actions per group (excess spills into the next group);
 *  - 'trigger' nests at most depth 1: inside a triggered payload further
 *    triggers are IGNORED (the card's mana is still spent, but it casts
 *    nothing — an honest dud).
 *
 * Pure function of the slot list — unit-tested in tests/wands.test.ts.
 */

export interface CastAction {
  card: CardId;
  speedMul: number;
  dmgMul: number;
  /** Extra aim jitter amplitude in radians (added to the frame's spread). */
  spreadAdd: number;
  /** Trail the flask's stored material while flying. */
  infused: boolean;
  /** Terrain bounces remaining before the projectile detonates. */
  bounces: number;
  /** Cast at the impact point (depth-1 trigger payload), or null. */
  triggered: CastAction[] | null;
}

export interface CastGroup {
  actions: CastAction[];
  /** Sum of every card consumed building the group (payload included). */
  manaCost: number;
}

const MAX_DMG_MUL = 4;
const MAX_ACTIONS_PER_GROUP = 6;

/** Pending modifier pack, consumed (and reset) by the next projectile card. */
interface ModPack {
  speedMul: number;
  dmgMul: number;
  spreadAdd: number;
  infused: boolean;
  bounces: number;
  trigger: boolean;
  /** Mana of the modifier cards in the pack, charged to the consuming group. */
  mana: number;
}

function freshPack(): ModPack {
  return { speedMul: 1, dmgMul: 1, spreadAdd: 0, infused: false, bounces: 0, trigger: false, mana: 0 };
}

/** Pass-1 group: actions still carrying their compile-time trigger flags. */
interface RawGroup {
  actions: Array<{ action: CastAction; trig: boolean }>;
  mana: number;
}

export function compileWand(cards: (CardId | null)[]): CastGroup[] {
  const deck = cards.filter((c): c is CardId => c !== null);

  // ---- Pass 1: left-to-right walk into raw groups (mods + multicast + clamps)
  const raw: RawGroup[] = [];
  let cur: RawGroup | null = null;
  let owed = 0; // projectile casts still owed to the open group
  let pendingSize = 0; // multicast size waiting for its first projectile
  let pendingMana = 0; // multicast mana waiting for its group to open
  let pack = freshPack();

  for (const id of deck) {
    const def = CARD_DEFS[id];
    if (def.kind === 'modifier') {
      pack.mana += def.manaCost;
      if (id === 'speed') pack.speedMul *= 1.6;
      else if (id === 'heavy') {
        pack.dmgMul *= 1.7;
        pack.speedMul *= 0.75;
      } else if (id === 'spread') pack.spreadAdd += 0.18;
      else if (id === 'infuser') pack.infused = true;
      else if (id === 'bounce') pack.bounces = 2;
      else if (id === 'trigger') pack.trigger = true;
    } else if (def.kind === 'multicast') {
      const n = MULTICAST_SIZE[id] ?? 1;
      if (cur) {
        owed += n;
        cur.mana += def.manaCost;
      } else {
        pendingSize += n;
        pendingMana += def.manaCost;
      }
    } else {
      // projectile card
      if (!cur) {
        cur = { actions: [], mana: pendingMana };
        owed = Math.max(1, pendingSize);
        pendingSize = 0;
        pendingMana = 0;
      }
      cur.actions.push({
        action: {
          card: id,
          speedMul: pack.speedMul,
          dmgMul: Math.min(MAX_DMG_MUL, pack.dmgMul),
          spreadAdd: pack.spreadAdd,
          infused: pack.infused,
          bounces: pack.bounces,
          triggered: null,
        },
        trig: pack.trigger,
      });
      cur.mana += pack.mana + def.manaCost;
      pack = freshPack();
      owed--;
      if (cur.actions.length >= MAX_ACTIONS_PER_GROUP && owed > 0) {
        // Group is full but the multicast still owes casts: spill onward.
        raw.push(cur);
        cur = { actions: [], mana: 0 };
      }
      if (owed <= 0) {
        raw.push(cur);
        cur = null;
      }
    }
  }
  // Deck exhausted mid-multicast: ship what we have. Trailing mods/multicasts
  // with no projectile produce nothing (empty / no-projectile wand -> []).
  if (cur && cur.actions.length > 0) raw.push(cur);

  // ---- Pass 2: fold trigger payloads (depth-1 clamp lives here)
  const groups: CastGroup[] = [];
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    const hosts = g.actions.filter((a) => a.trig);
    let mana = g.mana;
    if (hosts.length > 0 && i + 1 < raw.length) {
      // The FOLLOWING group becomes the impact payload and leaves the program.
      // Its trig flags are dropped: triggers inside a payload are ignored.
      const payload = raw[i + 1];
      const payloadActions = payload.actions.map((a) => a.action);
      for (const h of hosts) h.action.triggered = payloadActions;
      mana += payload.mana;
      i++;
    }
    // Trigger armed with nothing after it: an honest dud (triggered stays null).
    groups.push({ actions: g.actions.map((a) => a.action), manaCost: mana });
  }
  return groups;
}
