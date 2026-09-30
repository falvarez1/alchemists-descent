import { describe, expect, it } from 'vitest';

import type { StoryFigureView } from '@/core/story';
import { makeSkeleton } from '@/entities/playerPose';
import { poseFigure } from '@/render/story/figurePose';
import { IDLE_ACTS } from '@/game/story/pellIdle';

/**
 * The story figure's pose (render/story/figurePose): every act Pell idles in is
 * a finite, readable pose distinct from standing, and his mouth follows a
 * given line clock. Pure: no game, no canvas.
 */

function figure(act: string, actT: number, over: Partial<StoryFigureView> = {}): StoryFigureView {
  return { x: 100, y: 200, facing: 1, costume: 'surveyor', act, actT, stride: 0, alpha: 1, ghost: false, lookX: null, lookY: null, seed: 7, ...over };
}

const joints = (act: string, t: number, over: Partial<StoryFigureView> = {}): number[] => {
  const s = makeSkeleton();
  const { props } = poseFigure(figure(act, t, over), s);
  void props;
  return [s.frontHand, s.backHand, s.frontElbow, s.backElbow, s.head, s.hip, s.frontFoot, s.backFoot].flatMap(v => [v.x, v.y]).concat([s.headTilt, s.lean, s.mouth]);
};

const dist = (a: number[], b: number[]): number => Math.hypot(...a.map((v, i) => v - b[i]!));

describe('the story figure’s idle acts', () => {
  it('every act he idles in poses finitely across its whole length', () => {
    for (const a of IDLE_ACTS) {
      for (let t = 0; t <= a.secs[1] + 1; t += 0.1) {
        for (const v of joints(a.act, t)) expect(Number.isFinite(v), `${a.act} @${t.toFixed(1)}`).toBe(true);
      }
    }
  });

  it('each new act is a visibly different pose from standing, and from the others', () => {
    const base = joints('stand', 1);
    const acts = ['rock', 'lookup', 'sip', 'rub', 'check', 'sneeze', 'kneel'];
    for (const act of acts) expect(dist(joints(act, 1.3), base), act).toBeGreaterThan(3);
    // "stand" and "lookup" used to look identical; so must not any pair now.
    for (let i = 0; i < acts.length; i++) for (let j = i + 1; j < acts.length; j++) expect(dist(joints(acts[i]!, 1.3), joints(acts[j]!, 1.3)), `${acts[i]} / ${acts[j]}`).toBeGreaterThan(1);
  });

  it('puts the right thing in his hands', () => {
    const props = (act: string, t: number) => poseFigure(figure(act, t), makeSkeleton()).props;
    expect(props('sip', 2).cup).toBe(true);
    expect(props('check', 2).map).toBe(true);
    expect(props('check', 0).map).toBe(false);
    expect(props('sneeze', 0.5).cloth).toBe(true);
    // The breath in the cold air comes only in the blow at the end of a rub.
    expect(props('rub', 0.4).puff).toBe(0);
    expect(props('rub', 2.1).puff).toBeGreaterThan(0.5);
    expect(props('sketch', 1).cup).toBe(false);
  });

  it('the sip brings the cup up to his face and lowers it again', () => {
    const hand = (t: number): number => { const s = makeSkeleton(); poseFigure(figure('sip', t), s); return s.frontHand.y; };
    expect(hand(2)).toBeLessThan(hand(0) - 4);
    expect(hand(4.6)).toBeGreaterThan(hand(2) + 4);
  });

  it('the sneeze throws him forward on the beat, with a hop', () => {
    const lean = (t: number): number => { const s = makeSkeleton(); poseFigure(figure('sneeze', t), s); return s.lean; };
    expect(lean(0.9)).toBeLessThan(0);
    expect(lean(1.2)).toBeGreaterThan(0.1);
    expect(lean(2.1)).toBeCloseTo(0, 1);
  });

  it('his mouth follows the line clock when given one, and chatters on its own when not', () => {
    const mouth = (over: Partial<StoryFigureView>, t = 0.3): number => { const s = makeSkeleton(); poseFigure(figure('talk', t, over), s); return s.mouth; };
    expect(mouth({ mouth: 0 })).toBe(0);
    expect(mouth({ mouth: 0.85 })).toBe(0.85);
    const own = new Set<number>();
    for (let t = 0; t < 1; t += 0.05) own.add(mouth({}, t));
    expect(own.size).toBeGreaterThan(1);
  });

  it('mirrors for the other way round', () => {
    const a = makeSkeleton(), b = makeSkeleton();
    poseFigure(figure('rock', 1), a);
    poseFigure(figure('rock', 1, { facing: -1 }), b);
    expect(a.frontHand.x - 100).toBeCloseTo(-(b.frontHand.x - 100), 4);
    expect(a.frontHand.y).toBeCloseTo(b.frontHand.y, 4);
  });
});
