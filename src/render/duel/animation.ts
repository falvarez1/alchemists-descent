type Phase = 'startup' | 'active' | 'recovery';
export interface DuelAnimation {
  loop: boolean;
  anchor?: 'feet' | 'grip' | 'center';
  frames: readonly { name: string; ticks: number; phase?: Phase }[];
}
interface AttackTiming {
  age: number;
  phase: Phase;
  spec: Record<Phase, number>;
}
export interface AnimationClock { action: string; frame: number; age: number }

/** Animation time belongs to the body, not the number of rendering passes. */
export function advanceAnimation(previous: AnimationClock | undefined, action: string, frame: number, frozen: boolean): AnimationClock {
  if (!previous || previous.action !== action || frame < previous.frame) return { action, frame, age: 0 };
  return { action, frame, age: previous.age + (frozen ? 0 : Math.max(0, frame - previous.frame)) };
}

export function animationFrame(clip: DuelAnimation, age: number, attack?: AttackTiming): string | undefined {
  let frames = clip.frames;
  let tick = Math.max(0, age);
  let loop = clip.loop;
  if (attack) {
    const phaseFrames = frames.filter(f => f.phase === attack.phase);
    if (phaseFrames.length) {
      frames = phaseFrames;
      const start = attack.phase === 'startup' ? 0 : attack.spec.startup + (attack.phase === 'recovery' ? attack.spec.active : 0);
      const duration = frames.reduce((n, f) => n + f.ticks, 0);
      tick = Math.max(0, attack.age - start) / Math.max(1, attack.spec[attack.phase]) * duration;
      loop = false;
    }
  }
  const total = frames.reduce((n, f) => n + f.ticks, 0);
  if (!frames.length || total <= 0) return undefined;
  if (loop) tick %= total;
  for (const frame of frames) {
    if (tick < frame.ticks) return frame.name;
    tick -= frame.ticks;
  }
  return frames.at(-1)?.name;
}
