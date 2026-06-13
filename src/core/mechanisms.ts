import type { LevelRuntime, Mechanism } from '@/core/types';

const EMPTY_TRIGGERS: Mechanism[] = [];

/** Build actuator trigger lookup in mechanism list order for sequence gates. */
export function buildMechanismTriggerIndex(list: Mechanism[]): Map<number, Mechanism[]> {
  const index = new Map<number, Mechanism[]>();
  for (const trigger of list) {
    if (trigger.kind === 'door' || trigger.targetId < 0) continue;
    let triggers = index.get(trigger.targetId);
    if (!triggers) {
      triggers = [];
      index.set(trigger.targetId, triggers);
    }
    triggers.push(trigger);
  }
  return index;
}

/** Return triggers targeting an actuator, rebuilding lazily for old runtimes/tests. */
export function mechanismTriggersFor(
  runtime: LevelRuntime,
  actuatorId: number,
  exclude?: Mechanism,
): Mechanism[] {
  runtime.mechanismTriggers ??= buildMechanismTriggerIndex(runtime.mechanisms);
  const triggers = runtime.mechanismTriggers.get(actuatorId) ?? EMPTY_TRIGGERS;
  if (!exclude || !triggers.includes(exclude)) return triggers;
  return triggers.filter((trigger) => trigger !== exclude);
}
