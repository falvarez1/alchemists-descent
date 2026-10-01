import type { StoryFigureView } from '@/core/story';
import type { Skeleton } from '@/entities/playerPose';
import { makeSkeleton } from '@/entities/playerPose';

/**
 * The STORY FIGURE's pose (wave 3 WS-S): the alchemist's skeleton (entities/
 * playerPose — the same joints, the same `at(side, up)` body frame) posed
 * from a story figure's action and its clock instead of player physics. Pell
 * sketches, warms his hands, waves and jumps at noises, and between times sips
 * from a tin cup, rubs and blows on his fingers, holds the map up to the wall,
 * rocks on his heels with his hands behind him, and sneezes; the echoes' Guild
 * workers crank valves, carry crates, ring the shift bell, shovel coal, hold a
 * lens to the light. Presentation only: pure, allocation-free per call once
 * the skeleton exists.
 */

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const ease = (x: number): number => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
type P = [number, number];
const set = (v: { x: number; y: number }, p: P): void => { v.x = p[0]; v.y = p[1]; };

/** Props a pose puts in the hands (the art draws them). */
export interface FigureProps {
  /** A sketch board / notebook in the back hand. */
  board: boolean;
  /** A crate carried in both hands. */
  crate: boolean;
  /** A shovel (the stoker). */
  shovel: boolean;
  /** A lens held up. */
  lens: boolean;
  /** A hand bell. */
  bell: boolean;
  /** The rope above a climber. */
  rope: boolean;
  /** The valve wheel being cranked (drawn at the hands). */
  wheel: boolean;
  /** A tin cup in the front hand, steaming. */
  cup: boolean;
  /** A handkerchief in the front hand. */
  cloth: boolean;
  /** The map held open at arm's length. */
  map: boolean;
  /** Breath in the cold air at his mouth, 0..1 (a blow on his hands). */
  puff: number;
}

const PROPS: FigureProps = { board: false, crate: false, shovel: false, lens: false, bell: false, rope: false, wheel: false, cup: false, cloth: false, map: false, puff: 0 };

/** Bulk per costume: the stoker is a head and a half taller and twice as broad. */
export function figureScale(costume: StoryFigureView['costume']): number {
  return costume === 'stoker' ? 1.45 : costume === 'surveyor' ? 1.04 : 1;
}

/** Acts that set their own head tilt (the rest stand upright). */
const KEEPS_TILT: ReadonlySet<string> = new Set(['sketch', 'write', 'warm', 'lookup', 'holdup', 'sip', 'rub', 'check', 'sneeze']);

export function poseFigure(f: StoryFigureView, s: Skeleton = makeSkeleton()): { s: Skeleton; props: FigureProps } {
  const props = PROPS;
  props.board = false; props.crate = false; props.shovel = false; props.lens = false; props.bell = false; props.rope = false; props.wheel = false;
  props.cup = false; props.cloth = false; props.map = false; props.puff = 0;
  const k = figureScale(f.costume);
  const fc = f.facing;
  const t = f.actT, act = f.act;
  const breath = Math.sin(t * 2.1 + f.seed) * 0.3;
  const walking = act === 'walk' || act === 'run' || act === 'carry';
  const speed = act === 'run' ? 1 : walking ? 0.55 : 0;
  const ph = f.stride;
  let lean = fc * speed * 0.12;
  let squash = 0;
  let hop = 0;
  if (act === 'startle') { const u = clamp(t / 0.35, 0, 1); hop = Math.sin(u * Math.PI) * 2.2; lean = -fc * 0.22 * (1 - clamp((t - 0.3) / 0.6, 0, 1)); }
  if (act === 'kneel') squash = 5;
  if (act === 'sit') squash = 6.5;
  if (act === 'warm') { squash = 1.3; lean = fc * 0.08; }
  if (act === 'sketch' || act === 'write') lean = fc * 0.05;
  if (act === 'shovel') { const c = Math.sin(t * 3.2); lean = fc * (0.22 + c * 0.12); squash = 1 + Math.max(0, c) * 1.2; }
  if (act === 'lookup') { lean = -fc * 0.14; squash = -0.4; }
  if (act === 'carry') lean = -fc * 0.05;
  // Rocking on his heels, hands behind him: a slow sway, a little lift on the toes.
  if (act === 'rock') { const r = Math.sin(t * 1.4 + f.seed); lean = fc * (0.02 + r * 0.05); squash = 0.2 - Math.max(0, r) * 0.5; }
  // Hunched against the cold, a shiver through him.
  if (act === 'rub') { squash = 1.5; lean = fc * 0.07; }
  if (act === 'sip') lean = -fc * 0.05 * ease((t - 0.3) / 0.6) * (1 - ease((t % 5 - 3.4) / 0.6));
  if (act === 'check') lean = -fc * 0.05;
  if (act === 'sneeze') {
    // Breathes in, back; the sneeze itself throws him forward with a hop; then a sniff.
    const wind = ease(t / 1.1), snap = t > 1.1 ? Math.max(0, 1 - (t - 1.1) / 0.45) : 0;
    lean = -fc * 0.1 * wind * (t > 1.1 ? 0 : 1) + fc * 0.3 * snap;
    hop = t > 1.1 && t < 1.4 ? Math.sin(((t - 1.1) / 0.3) * Math.PI) * 1.8 : 0;
    squash = snap * 1.4;
  }
  const cos = Math.cos(lean), sin = Math.sin(lean);
  const shiver = act === 'rub' ? Math.sin(t * 38) * 0.22 : 0;
  const at = (side: number, up: number): P => {
    const kk = clamp(up / 16, 0, 1);
    const u = (up - squash * kk + (walking ? Math.abs(Math.sin(ph)) * speed * 0.6 : breath * clamp((up - 6) / 8, 0, 1)) + hop) * k;
    const dx = fc * (side + shiver * kk) * k, dy = -u;
    return [f.x + dx * cos - dy * sin, f.y + dx * sin + dy * cos];
  };
  s.kind = 'stand';
  s.facing = fc;
  s.lean = lean;
  s.eyesShut = Math.sin(t * 0.9 + f.seed * 3) > 0.985;
  // His mouth follows the line he is saying (PellCamp feeds it from the line's clock); the rig's own chatter otherwise.
  s.mouth = f.mouth !== undefined ? f.mouth : act === 'talk' ? (Math.sin(t * 13) > 0 ? 0.6 : 0.1) : act === 'startle' && t < 0.5 ? 0.7 : 0;
  s.held = null;
  s.wand.visible = false;
  s.lift = 0; s.commune = 0;
  s.crouch = clamp(squash / 5, 0, 1);
  s.flare = act === 'startle' ? 0.5 : 0;
  set(s.hip, at(0, 6.2)); set(s.chest, at(0.2, 11.2)); set(s.neck, at(0.35, 12.6)); set(s.head, at(0.55, 14.0));
  // Legs: a stride, a kneel, a seat, or planted.
  const stride = walking ? Math.sin(ph) * (1.3 + speed * 1.9) : 0;
  const swing = Math.cos(ph);
  let bF = at(-1.9 - stride, 0.1 + (walking ? Math.max(0, -swing) * 1.4 * speed : 0));
  let fF = at(1.9 + stride, 0.1 + (walking ? Math.max(0, swing) * 1.4 * speed : 0));
  let bK = at(-1.0 - stride * 0.35, 3.5 + (walking ? Math.max(0, -swing) * speed : 0));
  let fK = at(1.2 + stride * 0.35, 3.6 + (walking ? Math.max(0, swing) * speed : 0));
  if (act === 'kneel') { bF = at(-3.2, 0.1); bK = at(-1.2, 0.6); fF = at(2.4, 0.1); fK = at(2.8, 3.0); }
  if (act === 'sit') { bF = at(2.6, 0.1); fF = at(3.4, 0.1); bK = at(3.0, 3.4); fK = at(3.6, 3.6); }
  if (act === 'startle' && t < 0.5) { bF = at(-2.8, 0.3 + hop * 0.2); fF = at(1.4, 0.8 + hop * 0.3); }
  if (act === 'climb') {
    const c = Math.sin(t * 4);
    bF = at(-0.8, 1.2 + Math.max(0, c) * 1.6); fF = at(0.8, 0.6 + Math.max(0, -c) * 1.6); bK = at(-1.6, 4.4); fK = at(1.6, 4.2);
  }
  set(s.backFoot, bF); set(s.frontFoot, fF); set(s.backKnee, bK); set(s.frontKnee, fK);
  // Arms: counter-swing by default.
  const counter = walking ? -stride * 0.45 : 0;
  let bE = at(-2.4 + counter * 0.5, 9.0), bH = at(-2.0 + counter, 6.4);
  let fE = at(2.6 - counter * 0.4, 9.0), fH = at(3.0 - counter * 0.7, 6.6);
  const osc = (hz: number, a: number): number => Math.sin(t * hz * Math.PI * 2) * a;
  switch (act) {
    case 'sketch': case 'write': {
      // The board held up in the back hand, the front hand drawing small strokes across it.
      bE = at(0.4, 8.2); bH = at(3.2, 9.6);
      fE = at(2.6, 8.8); fH = at(3.6 + osc(1.3, 0.6), 10.4 + osc(2.1, 0.35));
      props.board = true;
      s.headTilt = fc * 0.28;
      break;
    }
    case 'warm': {
      // Both hands out toward the lantern, rubbing.
      bE = at(1.6, 9.0); bH = at(4.4 + osc(1.6, 0.35), 9.6);
      fE = at(2.8, 8.9); fH = at(4.8 - osc(1.6, 0.35), 9.2);
      s.headTilt = fc * 0.12;
      break;
    }
    case 'wave': {
      fE = at(3.4, 12.2); fH = at(4.2 + osc(1.8, 1.1), 15.6);
      break;
    }
    case 'talk': {
      fE = at(2.8, 9.2); fH = at(4.4 + osc(0.6, 0.6), 9.6 + osc(0.9, 0.7));
      break;
    }
    case 'point': {
      fE = at(3.6, 10.4); fH = at(6.6, 8.2);
      break;
    }
    case 'startle': {
      const up = t < 0.6 ? 1 : 1 - clamp((t - 0.6) / 0.3, 0, 1);
      bE = at(-2.8, 10.4 + up * 1.2); bH = at(-3.6, 12.0 + up * 2.6);
      fE = at(3.0, 10.6 + up * 1.2); fH = at(3.8, 12.4 + up * 2.8);
      break;
    }
    case 'lookup': {
      // Head right back, a hand up to shade the brow: studying the ceiling, not standing.
      s.headTilt = -fc * 0.62;
      fE = at(3.0, 12.6); fH = at(3.4 + osc(0.35, 0.3), 16.0);
      break;
    }
    case 'rock': {
      // Hands clasped behind his back.
      bE = at(-2.6, 8.8); bH = at(-3.6, 6.4);
      fE = at(-1.4, 8.6); fH = at(-3.0, 6.2);
      break;
    }
    case 'sip': {
      // The tin cup up to his mouth in the front hand, the other hand under it; a long sip, a satisfied breath out.
      const c = t % 5;
      const up = ease(c / 0.9) * (1 - ease((c - 3.4) / 0.9));
      const tip = up * (0.5 + Math.max(0, Math.sin(c * 2.2)) * 0.5);
      fE = at(2.6 + up * 0.2, 9.0 + up * 1.4); fH = at(3.0 + up * 0.9, 6.6 + up * 6.4);
      bE = at(-2.4 + up * 3.4, 9.0); bH = at(-2.0 + up * 4.6, 6.4 + up * 5.6);
      props.cup = true;
      s.headTilt = -fc * 0.3 * tip;
      if (c > 4.3 && c < 4.8) s.mouth = 0.6;
      break;
    }
    case 'rub': {
      // Rubbing his hands together in front of his chest; then a long breath into them.
      const c = t % 2.6;
      const blow = ease((c - 1.5) / 0.3) * (1 - ease((c - 2.4) / 0.2));
      const rubX = Math.sin(t * Math.PI * 2 * 3.4) * 0.7 * (1 - blow);
      fE = at(2.4, 9.2 + blow * 2.2); fH = at(3.6 + rubX, 9.4 + blow * 3.2);
      bE = at(1.6, 9.0 + blow * 2.0); bH = at(3.9 - rubX, 9.0 + blow * 3.6);
      s.headTilt = fc * (0.26 - blow * 0.22);
      if (blow > 0.5) { s.mouth = 0.55; props.puff = blow; }
      break;
    }
    case 'check': {
      // The map up at arm's length against the wall, his head going from it to the wall and back.
      const c = t % 4.6;
      const up = ease(c / 0.7) * (1 - ease((c - 3.9) / 0.7));
      fE = at(2.4 + up * 0.6, 9.2 + up * 2.6); fH = at(3.2 + up * 2.4, 8.0 + up * 6.6);
      bE = at(0.6 + up * 1.4, 9.0 + up * 2.4); bH = at(2.0 + up * 3.4, 8.2 + up * 6.2);
      props.map = up > 0.05;
      s.headTilt = fc * Math.sin(t * 1.9) * 0.28 * up;
      break;
    }
    case 'sneeze': {
      // A hand with a handkerchief up to his nose; the breath in, the snap, the wipe.
      const wind = ease(t / 1.1);
      const wipe = t > 1.6 ? Math.sin((t - 1.6) * 14) * 0.5 : 0;
      fE = at(2.6, 9.4 + wind * 1.6); fH = at(3.2 + wipe * 0.4, 7.0 + wind * 6.0 + wipe * 0.3);
      props.cloth = true;
      s.headTilt = t < 1.1 ? -fc * 0.5 * wind : t < 1.6 ? fc * 0.5 * (1 - (t - 1.1) / 1.0) : 0;
      s.mouth = t > 0.5 && t < 1.6 ? 0.85 : 0;
      break;
    }
    case 'crank': {
      // Both hands on a wheel in front of the chest, going round.
      const a = t * 3.2;
      const cx = 4.4, cy = 10.2;
      fH = at(cx + Math.cos(a) * 1.8, cy + Math.sin(a) * 1.8); bH = at(cx + Math.cos(a + Math.PI) * 1.8, cy + Math.sin(a + Math.PI) * 1.8);
      fE = at(2.8, 8.8); bE = at(1.6, 9.2);
      props.wheel = true;
      break;
    }
    case 'carry': {
      bE = at(1.4, 8.4); bH = at(3.8, 8.6); fE = at(2.8, 8.2); fH = at(4.2, 8.6);
      props.crate = true;
      break;
    }
    case 'bell': {
      fE = at(3.0, 11.8); fH = at(3.8 + osc(3, 0.9), 14.6);
      props.bell = true;
      break;
    }
    case 'shovel': {
      const c = Math.sin(t * 3.2);
      fE = at(3.0, 8.6 + c); fH = at(5.4 + c * 1.6, 6.8 + c * 2.2); bE = at(0.4, 8.8 + c * 0.6); bH = at(2.6 + c, 8.4 + c * 1.6);
      props.shovel = true;
      break;
    }
    case 'holdup': {
      bE = at(0.6, 13.4); bH = at(1.6, 17.0); fE = at(2.8, 13.6); fH = at(2.6, 17.2);
      props.lens = true;
      s.headTilt = -fc * 0.45;
      break;
    }
    case 'pat': {
      fE = at(3.6, 11.0); fH = at(6.0, 11.4 - Math.abs(osc(1.5, 0.6)));
      break;
    }
    case 'kneel': {
      bE = at(0.2, 7.2); bH = at(2.8, 6.4); fE = at(2.6, 7.4); fH = at(4.2, 5.2);
      break;
    }
    case 'sit': {
      bE = at(0.8, 7.6); bH = at(3.2, 6.8); fE = at(2.4, 7.8); fH = at(3.8, 7.0);
      break;
    }
    case 'climb': {
      const c = Math.sin(t * 4);
      bE = at(-0.6, 13.0); bH = at(0.2, 16.4 + Math.max(0, c) * 1.6); fE = at(0.8, 13.2); fH = at(0.4, 17.6 + Math.max(0, -c) * 1.6);
      props.rope = true;
      break;
    }
    default: break;
  }
  if (!KEEPS_TILT.has(act)) s.headTilt = 0;
  if (act === 'sneeze') s.eyesShut = t > 1.0 && t < 1.7;
  // The head turns toward someone it is watching.
  if (f.lookX !== null && f.lookY !== null) {
    s.gazeX = clamp((f.lookX - f.x) * fc / 40, -1, 1);
    s.gazeY = clamp((f.lookY - (f.y - 14 * k)) / 40, -1, 1);
    s.headTilt += fc * s.gazeY * 0.2;
  } else {
    s.gazeX = 0.4; s.gazeY = act === 'lookup' ? -0.8 : act === 'sketch' ? 0.6 : 0;
    // Idle eyes: his stand-about look wanders, his hands draw his eyes, the map draws them left and right.
    if (act === 'rock') { s.gazeX = Math.sin(t * 0.8 + f.seed) * 0.9; s.gazeY = Math.sin(t * 0.5 + 1) * 0.2; }
    else if (act === 'rub') s.gazeY = 0.7;
    else if (act === 'sip') s.gazeY = 0.1;
    else if (act === 'check') { s.gazeX = Math.sin(t * 1.9) * 0.9; s.gazeY = -0.2; }
    else if (act === 'sneeze') { s.gazeX = 0; s.gazeY = t < 1.1 ? -0.6 : 0.6; }
  }
  set(s.backElbow, bE); set(s.backHand, bH); set(s.frontElbow, fE); set(s.frontHand, fH);
  set(s.crown, at(-0.2, 17.2));
  s.brimAngle = lean + s.headTilt * 0.6;
  return { s, props };
}
