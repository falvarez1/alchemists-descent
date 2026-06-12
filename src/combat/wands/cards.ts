import type { CardDef, CardId } from '@/core/types';

/**
 * The spell card catalogue (DESIGN.md pillar 6): the 7 legacy spells reborn as
 * projectile cards, plus the modifier / multicast cards the cast compiler
 * understands. Pure data — balance lives here, semantics live in compiler.ts
 * and WandSystem.ts.
 */
export const CARD_DEFS: Record<CardId, CardDef> = {
  // ---------------- projectile cards ----------------
  spark: {
    id: 'spark',
    name: 'Spark Bolt',
    kind: 'projectile',
    manaCost: 10,
    blurb: 'A crackling bolt',
  },
  bomb: {
    id: 'bomb',
    name: 'Cast Bomb',
    kind: 'projectile',
    manaCost: 24,
    blurb: 'A lobbed charge on a short fuse',
  },
  lightning: {
    id: 'lightning',
    name: 'Chain Lightning',
    kind: 'projectile',
    manaCost: 26,
    blurb: 'A forked arc that hunts the first thing it touches',
  },
  flame: {
    id: 'flame',
    name: 'Flame Jet',
    kind: 'projectile',
    manaCost: 2,
    blurb: 'A streaming gout of fire — each cast burns a 4-frame burst',
  },
  dig: {
    id: 'dig',
    name: 'Excavate Ray',
    kind: 'projectile',
    manaCost: 2,
    blurb: 'Chews the first diggable face along the aim',
  },
  warp: {
    id: 'warp',
    name: 'Warp Bolt',
    kind: 'projectile',
    manaCost: 28,
    blurb: 'Blink to wherever the bolt strikes',
  },
  blackhole: {
    id: 'blackhole',
    name: 'Black Hole',
    kind: 'projectile',
    manaCost: 48,
    blurb: 'A singularity that eats the world, then collapses',
  },

  // ------- upgrade-port payload cards (noita-alchemists-descent.html) -------
  vitriol: {
    id: 'vitriol',
    name: 'Vitriol Spray',
    kind: 'projectile',
    manaCost: 2,
    blurb: 'A streaming spray of real acid — melts what it pools on',
  },
  frostshard: {
    id: 'frostshard',
    name: 'Frost Shard',
    kind: 'projectile',
    manaCost: 16,
    blurb: 'Shatters into a freezing splash that ices water and chills flesh',
  },
  icelance: {
    id: 'icelance',
    name: 'Ice Lance',
    kind: 'projectile',
    manaCost: 22,
    blurb: 'A piercing spear of ice — runs through whole packs, deep-freezing them',
  },
  wisp: {
    id: 'wisp',
    name: 'Seeking Wisp',
    kind: 'projectile',
    manaCost: 8,
    blurb: 'A slow mote that hunts the nearest hostile on its own',
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor Call',
    kind: 'projectile',
    manaCost: 70,
    blurb: 'Lob a burning boulder; the crater answers for you',
  },
  conjure: {
    id: 'conjure',
    name: 'Conjure Stone',
    kind: 'projectile',
    manaCost: 18,
    blurb: 'Raises a disc of real stone at the cursor — bridge, plug, or shield',
  },
  emberstorm: {
    id: 'emberstorm',
    name: 'Ember Storm',
    kind: 'projectile',
    manaCost: 18,
    blurb: 'A fountain of drifting embers that smoulder where they land',
  },

  // ---------------- modifier cards ----------------
  speed: {
    id: 'speed',
    name: 'Swift Charm',
    kind: 'modifier',
    manaCost: 4,
    blurb: 'Next projectile flies x1.6 faster',
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy Charm',
    kind: 'modifier',
    manaCost: 8,
    blurb: 'Next projectile hits x1.7 harder but flies x0.75 slower',
  },
  spread: {
    id: 'spread',
    name: 'Scatter Charm',
    kind: 'modifier',
    manaCost: 3,
    blurb: 'Next cast jitters +/-0.18 rad off the aim',
  },
  infuser: {
    id: 'infuser',
    name: 'Infuser',
    kind: 'modifier',
    manaCost: 6,
    blurb: "Next projectile trails the flask's stored material",
  },
  bounce: {
    id: 'bounce',
    name: 'Bouncing Charm',
    kind: 'modifier',
    manaCost: 5,
    blurb: 'Next projectile ricochets off terrain up to 2 times',
  },
  trigger: {
    id: 'trigger',
    name: 'Trigger',
    kind: 'modifier',
    manaCost: 8,
    blurb: 'Next projectile casts the following group where it lands',
  },

  // ---------------- multicast cards ----------------
  double: {
    id: 'double',
    name: 'Twin Cast',
    kind: 'multicast',
    manaCost: 6,
    blurb: 'Fires the next 2 projectiles as one cast',
  },
  triple: {
    id: 'triple',
    name: 'Triple Cast',
    kind: 'multicast',
    manaCost: 12,
    blurb: 'Fires the next 3 projectiles as one cast',
  },
};

/** Stable catalogue order for review kits, shops, and random grants. */
export const ALL_CARD_IDS = Object.keys(CARD_DEFS) as CardId[];

/** Multicast group sizes (how many following projectile casts get grouped). */
export const MULTICAST_SIZE: Partial<Record<CardId, number>> = {
  double: 2,
  triple: 3,
};
