import type { CardId, CastAction } from '@/core/types';
import { CARD_DEFS, MULTICAST_SIZE, PROJECTILE_MOD_HOST_CARDS } from './cards';
export type { CastAction } from '@/core/types';

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

export interface CastGroup {
  actions: CastAction[];
  /** Sum of every card consumed building the group (payload included). */
  manaCost: number;
  /** Wand slot indices of every card consumed by this group — the HUD
   *  highlights these so the player can SEE what the next click casts. */
  slots: number[];
}

const MAX_DMG_MUL = 4;
const MAX_ACTIONS_PER_GROUP = 6;
const WATER_TRAIL_BUDGET = 18;
const OIL_TRAIL_BUDGET = 14;

/** Pending modifier pack, consumed (and reset) by the next projectile card. */
interface ModPack {
  speedMul: number;
  dmgMul: number;
  spreadAdd: number;
  infused: boolean;
  waterTrail: number;
  oilTrail: number;
  electricCharge: boolean;
  critWet: boolean;
  shortHoming: boolean;
  frostCharge: boolean;
  shatterCrit: boolean;
  bounces: number;
  trigger: boolean;
  /** Mana of the modifier cards in the pack, charged to the consuming group. */
  mana: number;
  /** Wand slot indices of the pack's modifier cards. */
  slots: number[];
}

function freshPack(): ModPack {
  return {
    speedMul: 1,
    dmgMul: 1,
    spreadAdd: 0,
    infused: false,
    waterTrail: 0,
    oilTrail: 0,
    electricCharge: false,
    critWet: false,
    shortHoming: false,
    frostCharge: false,
    shatterCrit: false,
    bounces: 0,
    trigger: false,
    mana: 0,
    slots: [],
  };
}

/** Pass-1 group: actions still carrying their compile-time trigger flags. */
interface RawGroup {
  actions: Array<{ action: CastAction; trig: boolean }>;
  mana: number;
  slots: number[];
}

export function compileWand(cards: (CardId | null)[]): CastGroup[] {
  const deck: Array<{ id: CardId; slot: number }> = [];
  cards.forEach((c, slot) => {
    if (c !== null) deck.push({ id: c, slot });
  });

  // ---- Pass 1: left-to-right walk into raw groups (mods + multicast + clamps)
  const raw: RawGroup[] = [];
  let cur: RawGroup | null = null;
  let owed = 0; // projectile casts still owed to the open group
  let pendingSize = 0; // multicast size waiting for its first projectile
  let pendingMana = 0; // multicast mana waiting for its group to open
  let pendingSlots: number[] = []; // multicast slots waiting likewise
  let pack = freshPack();

  for (const { id, slot } of deck) {
    const def = CARD_DEFS[id];
    // Defensive: an id not present in CARD_DEFS (a stale/renamed card from an
    // old or hand-edited save) would make `def` undefined and throw on every
    // cast. Skip it rather than soft-locking combat.
    if (!def) continue;
    if (def.kind === 'modifier') {
      pack.mana += def.manaCost;
      pack.slots.push(slot);
      if (id === 'speed') pack.speedMul *= 1.6;
      else if (id === 'heavy') {
        pack.dmgMul *= 1.7;
        pack.speedMul *= 0.75;
      } else if (id === 'spread') pack.spreadAdd += 0.18;
      else if (id === 'infuser') pack.infused = true;
      else if (id === 'watertrail') pack.waterTrail = Math.max(pack.waterTrail, WATER_TRAIL_BUDGET);
      else if (id === 'oiltrail') pack.oilTrail = Math.max(pack.oilTrail, OIL_TRAIL_BUDGET);
      else if (id === 'electriccharge') pack.electricCharge = true;
      else if (id === 'critwet') pack.critWet = true;
      else if (id === 'shorthoming') pack.shortHoming = true;
      else if (id === 'frostcharge') pack.frostCharge = true;
      else if (id === 'shattercrit') pack.shatterCrit = true;
      else if (id === 'bounce') pack.bounces = 2;
      else if (id === 'trigger') pack.trigger = true;
    } else if (def.kind === 'multicast') {
      const n = MULTICAST_SIZE[id] ?? 1;
      if (cur) {
        owed += n;
        cur.mana += def.manaCost;
        cur.slots.push(slot);
      } else {
        pendingSize += n;
        pendingMana += def.manaCost;
        pendingSlots.push(slot);
      }
    } else {
      // projectile card
      if (!cur) {
        cur = { actions: [], mana: pendingMana, slots: [...pendingSlots] };
        owed = Math.max(1, pendingSize);
        pendingSize = 0;
        pendingMana = 0;
        pendingSlots = [];
      }
      const supportsProjectileMods = PROJECTILE_MOD_HOST_CARDS.has(id);
      cur.actions.push({
        action: {
          card: id,
          speedMul: pack.speedMul,
          dmgMul: Math.min(MAX_DMG_MUL, pack.dmgMul),
          spreadAdd: pack.spreadAdd,
          infused: pack.infused,
          waterTrail: supportsProjectileMods ? pack.waterTrail : 0,
          oilTrail: supportsProjectileMods ? pack.oilTrail : 0,
          electricCharge: supportsProjectileMods ? pack.electricCharge : false,
          critWet: supportsProjectileMods ? pack.critWet : false,
          shortHoming: supportsProjectileMods ? pack.shortHoming : false,
          frostCharge: supportsProjectileMods ? pack.frostCharge : false,
          shatterCrit: supportsProjectileMods ? pack.shatterCrit : false,
          bounces: pack.bounces,
          triggered: null,
        },
        trig: pack.trigger,
      });
      cur.mana += pack.mana + def.manaCost;
      cur.slots.push(...pack.slots, slot);
      pack = freshPack();
      owed--;
      if (cur.actions.length >= MAX_ACTIONS_PER_GROUP && owed > 0) {
        // Group is full but the multicast still owes casts: spill onward.
        raw.push(cur);
        cur = { actions: [], mana: 0, slots: [] };
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
    const slots = [...g.slots];
    if (hosts.length > 0 && i + 1 < raw.length) {
      // The FOLLOWING group becomes the impact payload and leaves the program.
      // Its trig flags are dropped: triggers inside a payload are ignored.
      const payload = raw[i + 1];
      const payloadActions = payload.actions.map((a) => a.action);
      for (const h of hosts) h.action.triggered = payloadActions;
      mana += payload.mana;
      slots.push(...payload.slots);
      i++;
    }
    // Trigger armed with nothing after it: an honest dud (triggered stays null).
    groups.push({ actions: g.actions.map((a) => a.action), manaCost: mana, slots });
  }
  return groups;
}
