import type { CardId } from '@/core/types';
import { CARD_DEFS, MULTICAST_SIZE, PROJECTILE_MOD_HOST_CARDS } from './cards';
import { compileWand, MAX_ACTIONS_PER_GROUP, type CastGroup } from './compiler';

export interface WandSentenceLine {
  label: string;
  detail: string;
  manaCost: number;
  slots: number[];
}

export type WandSlotLinkKind = 'modifier' | 'multicast' | 'trigger-host' | 'trigger-payload';

export interface WandSlotLink {
  kind: WandSlotLinkKind;
  from: number;
  to: number;
}

export interface WandSentenceView {
  lines: WandSentenceLine[];
  warnings: string[];
  slotRelations: Partial<Record<number, number[]>>;
  slotLinks: Partial<Record<number, WandSlotLink[]>>;
  slotWarnings: Partial<Record<number, string[]>>;
}

function cardName(id: CardId): string {
  return CARD_DEFS[id].name;
}

function slotLabel(slot: number): string {
  return String(slot + 1);
}

function isProjectile(id: CardId): boolean {
  return CARD_DEFS[id].kind === 'projectile';
}

const SPEED_EFFECT_CARDS = new Set<CardId>([
  'spark',
  'bomb',
  'flame',
  'warp',
  'vitriol',
  'cryojet',
  'frostshard',
  'icelance',
  'wisp',
  'meteor',
  'emberstorm',
]);

const DAMAGE_EFFECT_CARDS = new Set<CardId>([
  'spark',
  'bomb',
  'lightning',
  'flame',
  'dig',
  'vitriol',
  'cryojet',
  'frostshard',
  'icelance',
  'wisp',
  'meteor',
  'emberstorm',
  'vitrify',
]);

const SPREAD_EFFECT_CARDS = new Set<CardId>([
  'spark',
  'bomb',
  'lightning',
  'flame',
  'dig',
  'warp',
  'vitriol',
  'cryojet',
  'frostshard',
  'icelance',
  'wisp',
  'meteor',
]);

function modifierHasEffect(modifier: CardId, host: CardId): boolean {
  if (modifier === 'speed') return SPEED_EFFECT_CARDS.has(host);
  if (modifier === 'heavy') return DAMAGE_EFFECT_CARDS.has(host);
  if (modifier === 'spread') return SPREAD_EFFECT_CARDS.has(host);
  return true;
}

function modifierEffectWarning(modifier: CardId, modifierSlot: number, host: CardId, hostSlot: number): string {
  const effect = modifier === 'speed' ? 'speed' : modifier === 'heavy' ? 'damage' : 'spread';
  return `${cardName(modifier)} in slot ${slotLabel(modifierSlot)} has no ${effect} effect on ${cardName(host)} in slot ${slotLabel(hostSlot)}`;
}

function nextProjectileSlot(cards: (CardId | null)[], fromSlot: number): number | null {
  for (let slot = fromSlot + 1; slot < cards.length; slot++) {
    const id = cards[slot];
    if (id && isProjectile(id)) return slot;
  }
  return null;
}

function addOneWayRelation(map: Partial<Record<number, number[]>>, from: number, to: number): void {
  const list = (map[from] ??= []);
  if (!list.includes(to)) list.push(to);
}

function addRelation(map: Partial<Record<number, number[]>>, a: number, b: number): void {
  addOneWayRelation(map, a, b);
  addOneWayRelation(map, b, a);
}

function addSlotLink(map: Partial<Record<number, WandSlotLink[]>>, link: WandSlotLink): void {
  const add = (slot: number): void => {
    const list = (map[slot] ??= []);
    if (!list.some((existing) =>
      existing.kind === link.kind && existing.from === link.from && existing.to === link.to
    )) {
      list.push(link);
    }
  };
  add(link.from);
  add(link.to);
}

function addWarning(map: Partial<Record<number, string[]>>, slot: number, warning: string): void {
  (map[slot] ??= []).push(warning);
}

function actionPhrase(action: CastGroup['actions'][number]): string {
  const parts: string[] = [];
  if (action.infused) parts.push('Infused');
  if (action.waterTrail > 0) parts.push('Water-Trail');
  if (action.oilTrail > 0) parts.push('Oil-Wick');
  if (action.electricCharge) parts.push('Electric');
  if (action.critWet) parts.push('Wet-Crit');
  if (action.shortHoming) parts.push('Short-Homing');
  if (action.frostCharge) parts.push('Frost-Charged');
  if (action.shatterCrit) parts.push('Shatter-Crit');
  if (action.pyreCrit) parts.push('Pyre-Crit');
  if (action.bounces > 0) parts.push('Bouncing');
  if (action.speedMul > 1.05 && SPEED_EFFECT_CARDS.has(action.card)) parts.push('Swift');
  if (action.dmgMul > 1.05 && DAMAGE_EFFECT_CARDS.has(action.card)) parts.push('Heavy');
  if (action.spreadAdd > 0.01 && SPREAD_EFFECT_CARDS.has(action.card)) parts.push('Scatter');
  parts.push(cardName(action.card));
  return parts.join(' ');
}

function groupPhrase(group: CastGroup): string {
  const actions = group.actions.map((action) => {
    const host = actionPhrase(action);
    if (!action.triggered || action.triggered.length === 0) return host;
    return `${host} -> ${action.triggered.map(actionPhrase).join(' + ')} at impact`;
  });
  if (actions.length === 0) return 'No projectile';
  if (actions.length === 1) return actions[0];
  return `${actions.length} casts: ${actions.join(' + ')}`;
}

function slotList(slots: number[]): string {
  if (slots.length === 0) return 'no slots';
  return `slots ${slots.map(slotLabel).join(', ')}`;
}

function addMulticastWarning(
  cards: (CardId | null)[],
  warnings: string[],
  slotWarnings: Partial<Record<number, string[]>>,
  multicastSlots: number[],
  owed: number,
  found: number,
): void {
  if (multicastSlots.length === 0 || found >= owed) return;
  const firstSlot = multicastSlots[0];
  const firstId = cards[firstSlot];
  const firstName = firstId ? cardName(firstId) : 'Multicast';
  const warning =
    multicastSlots.length === 1
      ? `${firstName} in slot ${slotLabel(firstSlot)} wants ${owed} projectiles, found ${found}`
      : `Stacked multicasts starting slot ${slotLabel(firstSlot)} want ${owed} projectiles, found ${found}`;
  warnings.push(warning);
  for (const slot of multicastSlots) addWarning(slotWarnings, slot, warning);
}

function analyzeMulticastDebt(
  cards: (CardId | null)[],
  warnings: string[],
  slotRelations: Partial<Record<number, number[]>>,
  slotLinks: Partial<Record<number, WandSlotLink[]>>,
  slotWarnings: Partial<Record<number, string[]>>,
): void {
  let pendingOwed = 0;
  let pendingSlots: number[] = [];
  let active: { owed: number; found: number; slots: number[]; actionsInChunk: number } | null = null;

  const warnActive = (): void => {
    if (!active) return;
    addMulticastWarning(cards, warnings, slotWarnings, active.slots, active.owed, active.found);
  };

  for (let slot = 0; slot < cards.length; slot++) {
    const id = cards[slot];
    if (!id) continue;
    const def = CARD_DEFS[id];
    if (def.kind === 'multicast') {
      const owed = MULTICAST_SIZE[id] ?? 1;
      if (active) {
        active.owed += owed;
        active.slots.push(slot);
      } else {
        pendingOwed += owed;
        pendingSlots.push(slot);
      }
      continue;
    }
    if (def.kind !== 'projectile') continue;

    if (!active) {
      active = {
        owed: Math.max(1, pendingOwed),
        found: 0,
        slots: [...pendingSlots],
        actionsInChunk: 0,
      };
      pendingOwed = 0;
      pendingSlots = [];
    }

    active.found++;
    active.actionsInChunk++;
    for (const multicastSlot of active.slots) {
      addRelation(slotRelations, multicastSlot, slot);
      addSlotLink(slotLinks, { kind: 'multicast', from: multicastSlot, to: slot });
    }
    if (active.found >= active.owed) active = null;
    else if (active.actionsInChunk >= 6) active.actionsInChunk = 0;
  }

  warnActive();
  if (pendingSlots.length > 0) addMulticastWarning(cards, warnings, slotWarnings, pendingSlots, pendingOwed, 0);
}

// This re-walks the raw card list with the SAME grouping rules as compiler.ts
// pass-1/pass-2 (multicast debt, the shared MAX_ACTIONS_PER_GROUP cap, trigger
// host = preceding projectile, payload = the next group). It can't read them off
// the compiled CastGroup[] because compileWand folds each trigger host and its
// payload into ONE group (slots merged, host action.triggered set), discarding
// the slot-level boundary the bench badges need. Keep this walk in lockstep with
// compiler.ts — the shared cap constant removes the easiest drift.
function analyzeTriggerLinks(
  cards: (CardId | null)[],
  slotLinks: Partial<Record<number, WandSlotLink[]>>,
): void {
  const rawGroups: Array<{ projectileSlots: number[]; triggerSlots: number[] }> = [];
  const triggerHosts = new Map<number, number>();
  let pendingSize = 0;
  let pendingTriggerSlots: number[] = [];
  let owed = 0;
  let actionsInGroup = 0;
  let cur: { projectileSlots: number[]; triggerSlots: number[] } | null = null;

  const finishCur = (): void => {
    if (!cur || cur.projectileSlots.length === 0) return;
    rawGroups.push({
      projectileSlots: [...cur.projectileSlots],
      triggerSlots: [...cur.triggerSlots],
    });
    cur = null;
    actionsInGroup = 0;
  };

  for (let slot = 0; slot < cards.length; slot++) {
    const id = cards[slot];
    if (!id) continue;
    const def = CARD_DEFS[id];
    if (def.kind === 'modifier') {
      if (id === 'trigger') pendingTriggerSlots.push(slot);
      continue;
    }
    if (def.kind === 'multicast') {
      const size = MULTICAST_SIZE[id] ?? 1;
      if (cur) owed += size;
      else pendingSize += size;
      continue;
    }

    if (!cur) {
      cur = {
        projectileSlots: [],
        triggerSlots: [],
      };
      owed = Math.max(1, pendingSize);
      pendingSize = 0;
    }

    cur.projectileSlots.push(slot);
    actionsInGroup++;
    cur.triggerSlots.push(...pendingTriggerSlots);
    for (const triggerSlot of pendingTriggerSlots) triggerHosts.set(triggerSlot, slot);
    pendingTriggerSlots = [];
    owed--;

    if (actionsInGroup >= MAX_ACTIONS_PER_GROUP && owed > 0) {
      finishCur();
      cur = { projectileSlots: [], triggerSlots: [] };
    }
    if (owed <= 0) finishCur();
  }
  finishCur();

  for (let groupIndex = 0; groupIndex < rawGroups.length; groupIndex++) {
    const group = rawGroups[groupIndex];
    if (group.triggerSlots.length === 0) continue;
    const payload = rawGroups[groupIndex + 1] ?? null;
    // A trigger with no following payload group arms nothing — compileWand leaves
    // the host's `triggered` null and a "no payload group" warning fires — so emit
    // no links rather than badge the host as wired.
    if (!payload) continue;
    for (const triggerSlot of group.triggerSlots) {
      const host = triggerHosts.get(triggerSlot);
      if (host !== undefined) addSlotLink(slotLinks, { kind: 'trigger-host', from: triggerSlot, to: host });
      for (const projectileSlot of payload.projectileSlots) {
        addSlotLink(slotLinks, { kind: 'trigger-payload', from: triggerSlot, to: projectileSlot });
      }
    }
    groupIndex++;
  }
}

function analyzeSlots(
  cards: (CardId | null)[],
  program: CastGroup[],
): Pick<WandSentenceView, 'warnings' | 'slotRelations' | 'slotLinks' | 'slotWarnings'> {
  const warnings: string[] = [];
  const slotRelations: Partial<Record<number, number[]>> = {};
  const slotLinks: Partial<Record<number, WandSlotLink[]>> = {};
  const slotWarnings: Partial<Record<number, string[]>> = {};
  const pendingModifierSlots: number[] = [];

  for (let slot = 0; slot < cards.length; slot++) {
    const id = cards[slot];
    if (!id) continue;
    const def = CARD_DEFS[id];
    if (def.kind === 'modifier') {
      pendingModifierSlots.push(slot);
      const host = nextProjectileSlot(cards, slot);
      if (host === null) {
        const warning = `${def.name} in slot ${slotLabel(slot)} has no projectile after it`;
        warnings.push(warning);
        addWarning(slotWarnings, slot, warning);
      } else {
        addRelation(slotRelations, slot, host);
        if (id !== 'trigger') addSlotLink(slotLinks, { kind: 'modifier', from: slot, to: host });
        const hostId = cards[host];
        const projectileBodyMod =
          id === 'watertrail' ||
          id === 'oiltrail' ||
          id === 'electriccharge' ||
          id === 'critwet' ||
          id === 'shorthoming' ||
          id === 'frostcharge' ||
          id === 'shattercrit' ||
          id === 'pyrecrit';
        if (projectileBodyMod && hostId && !PROJECTILE_MOD_HOST_CARDS.has(hostId)) {
          const warning = `${def.name} in slot ${slotLabel(slot)} needs a projectile body; ${cardName(hostId)} in slot ${slotLabel(host)} cannot carry it`;
          warnings.push(warning);
          addWarning(slotWarnings, slot, warning);
          addWarning(slotWarnings, host, warning);
        } else if ((id === 'speed' || id === 'heavy' || id === 'spread') && hostId && !modifierHasEffect(id, hostId)) {
          const warning = modifierEffectWarning(id, slot, hostId, host);
          warnings.push(warning);
          addWarning(slotWarnings, slot, warning);
          addWarning(slotWarnings, host, warning);
        }
      }
      continue;
    }

    if (def.kind === 'multicast') continue;

    for (const modSlot of pendingModifierSlots) addRelation(slotRelations, slot, modSlot);
    pendingModifierSlots.length = 0;
  }

  analyzeMulticastDebt(cards, warnings, slotRelations, slotLinks, slotWarnings);
  analyzeTriggerLinks(cards, slotLinks);

  for (const group of program) {
    const slots = Array.from(new Set(group.slots));
    const triggerSlots = slots.filter((slot) => cards[slot] === 'trigger');
    const multicastSlots = slots.filter((slot) => {
      const id = cards[slot];
      return id !== null && CARD_DEFS[id].kind === 'multicast';
    });
    const hasTriggerPayload = group.actions.some((action) => action.triggered && action.triggered.length > 0);

    for (const triggerSlot of triggerSlots) {
      for (const slot of slots) {
        if (slot !== triggerSlot) addRelation(slotRelations, triggerSlot, slot);
      }
      const relatedTriggerSlots = slots.filter((slot) => slot !== triggerSlot);
      for (let a = 0; a < relatedTriggerSlots.length; a++) {
        for (let b = a + 1; b < relatedTriggerSlots.length; b++) {
          addRelation(slotRelations, relatedTriggerSlots[a], relatedTriggerSlots[b]);
        }
      }
      if (!hasTriggerPayload) {
        const warning = `Trigger in slot ${slotLabel(triggerSlot)} has no payload group after its host`;
        warnings.push(warning);
        addWarning(slotWarnings, triggerSlot, warning);
        const host = nextProjectileSlot(cards, triggerSlot);
        if (host !== null) addWarning(slotWarnings, host, warning);
      }
    }

    for (const multicastSlot of multicastSlots) {
      for (const slot of slots) {
        if (slot !== multicastSlot) addRelation(slotRelations, multicastSlot, slot);
      }
    }
  }

  return { warnings, slotRelations, slotLinks, slotWarnings };
}

function normalizedCastIndex(castIndex: number, programLength: number): number {
  if (programLength <= 0) return 0;
  const index = Math.floor(castIndex);
  return Number.isFinite(index) && index >= 0 ? index % programLength : 0;
}

export function buildWandSentenceView(cards: (CardId | null)[], castIndex = 0): WandSentenceView {
  const program = compileWand(cards);
  const slotAnalysis = analyzeSlots(cards, program);
  const start = normalizedCastIndex(castIndex, program.length);
  const ordered = program.map((_, offset) => program[(start + offset) % program.length]);
  const lines = ordered.map((group, index) => ({
    label: `${index === 0 ? 'Next' : 'Then'}: ${groupPhrase(group)}`,
    detail: `${group.manaCost} mana - ${slotList(group.slots)}`,
    manaCost: group.manaCost,
    slots: [...group.slots],
  }));
  if (lines.length === 0) {
    lines.push({
      label: 'No spell ready',
      detail: 'Slot at least one projectile card',
      manaCost: 0,
      slots: [],
    });
  }
  return { lines, ...slotAnalysis };
}

export function nextWandSentence(cards: (CardId | null)[], castIndex: number): WandSentenceLine {
  return buildWandSentenceView(cards, castIndex).lines[0];
}
