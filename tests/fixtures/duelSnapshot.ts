import { createPlayer } from '@/entities/Player';
import { NEUTRAL_BODY } from '@/core/fighterBody';
import type { AbilityView } from '@/core/fighters';
import type { DuelSnapshot } from '@/net/duel/snapshot';

export function snapshotFixture(): DuelSnapshot {
  const ability = (slot: 'tactical' | 'ultimate'): AbilityView => ({ slot, name: 'test', ready: true, cooldown: 0, cooldownSeconds: 0, active: 0, charge: 1, usedAt: -1, refusedAt: -1, readyAt: -1 });
  const fighter = () => ({ player: createPlayer(), body: { ...NEUTRAL_BODY }, concealment: 0, effects: [],
    fighter: { id: 'ilyra-voss' as const, technique: { name: 'test', state: 'idle', uses: 0, usedAt: -1 }, tactical: ability('tactical'), ultimate: ability('ultimate'), armor: 0, armorMax: 0, meter: null } });
  return {
    epoch: 1, seq: 1, base: 0, baseline: true, tick: 1, width: 100, height: 100,
    fighters: [fighter(), fighter()],
    arena: {
      match: { state: 'fighting', fighters: [{ stocks: 3, volatility: 0, respawn: 0, protection: 0 }, { stocks: 3, volatility: 0, respawn: 0, protection: 0 }], remainingTicks: 100, countdown: 0, winner: null, reason: null, zone: { left: 0, right: 100, top: 0, bottom: 100 } },
      bout: { state: 'fighting', winner: null, startedAt: 0, endedAt: -1, downs: [] },
      slots: [0, 1].map(() => ({ attack: null, shield: null, dodge: null, ledge: null, grab: null, special: null, canRecover: true, recovering: false, grabbed: false, launching: false })),
    },
    camera: { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, viewScale: 1 },
    projectiles: [], particles: [], arcs: [], lights: [], bloom: 0, shake: 0, sounds: [],
  };
}
