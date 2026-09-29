/**
 * A sim worker (docs/SANDBOX-MT.md): one Participant in the checkerboard
 * chunk sweep. It idles on the control block's GEN word — spinning briefly,
 * then parked in Atomics.waitAsync so tuning messages still arrive — and runs
 * each substep main publishes.
 */
import { Participant, type ParticipantSetup, type RuleParams } from '@/sim/parallel/chunkSweep';
import { C_GEN, C_PARAMS_EPOCH, C_PHASE, C_PUBLISHED, C_SHUTDOWN, PHASE_RECLASS } from '@/sim/parallel/protocol';

export type SimWorkerMessage =
  | { type: 'init'; setup: ParticipantSetup; params: RuleParams; paramsEpoch: number; index: number }
  | { type: 'params'; params: RuleParams; epoch: number };

interface WorkerScope {
  onmessage: ((event: MessageEvent<SimWorkerMessage>) => void) | null;
  postMessage(message: unknown): void;
}
type WaitAsync = (array: Int32Array, index: number, value: number, timeout?: number) =>
  { async: false; value: string } | { async: true; value: Promise<string> };

const scope = globalThis as unknown as WorkerScope;
const waitAsync = (Atomics as unknown as { waitAsync?: WaitAsync }).waitAsync;
/** Spin this long for the next substep before parking (substeps of one tick
 *  arrive back to back; the next tick is ~16 ms away). */
const SPIN_MS = 0.25;

let participant: Participant | null = null;
let control: Int32Array | null = null;
let appliedEpoch = -1;
let epochWaiter: (() => void) | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    participant = new Participant(message.setup, message.params);
    control = new Int32Array(message.setup.control);
    appliedEpoch = message.paramsEpoch;
    void run(participant, control).catch((error: unknown) => {
      scope.postMessage({ type: 'error', message: String((error as Error)?.stack ?? error) });
    });
    scope.postMessage({ type: 'ready', index: message.index });
  } else if (message.type === 'params') {
    participant?.setParams(message.params);
    appliedEpoch = message.epoch;
    epochWaiter?.();
    epochWaiter = null;
  }
};

async function run(p: Participant, ctrl: Int32Array): Promise<void> {
  if (!waitAsync) throw new Error('Atomics.waitAsync unavailable');
  let lastGen = Atomics.load(ctrl, C_GEN);
  for (;;) {
    let gen = Atomics.load(ctrl, C_GEN);
    if (gen === lastGen) {
      const until = performance.now() + SPIN_MS;
      while ((gen = Atomics.load(ctrl, C_GEN)) === lastGen && performance.now() < until) { /* spin */ }
      if (gen === lastGen) {
        const wait = waitAsync(ctrl, C_GEN, lastGen);
        if (wait.async) await wait.value;
        continue;
      }
    }
    if (Atomics.load(ctrl, C_SHUTDOWN) !== 0) return;
    lastGen = gen;
    while (Atomics.load(ctrl, C_PARAMS_EPOCH) !== appliedEpoch) {
      // main posted new tuning just before this substep; take it first
      await new Promise<void>((resolve) => { epochWaiter = resolve; });
    }
    if (Atomics.load(ctrl, C_PHASE) === PHASE_RECLASS) p.runReclass();
    else p.runSubstep();
    Atomics.add(ctrl, C_PUBLISHED, 1);
  }
}
