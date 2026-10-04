import { describe, expect, it } from 'vitest';
import { FIGHTER_ORDER } from '@/content/fighters';
import { COSTUMES, recolorImageData, recolorPixel } from '@/render/duel/costumes';

const hueOf = (r: number, g: number, b: number): number => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const fromHsv = (h: number, s: number, v: number): [number, number, number] => {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
};

describe('mirror-match costumes', () => {
  it('give every fighter a second colourway', () => {
    for (const id of FIGHTER_ORDER) expect(COSTUMES[id], id).toBeDefined();
  });

  it('move each signature cloth to its new hue, and leave the outline alone', () => {
    for (const id of FIGHTER_ORDER) {
      const rule = COSTUMES[id];
      for (const shift of rule.shifts) {
        const [a, b] = shift.hue, centre = (a + ((b - a + 360) % 360) / 2) % 360;
        const cloth = fromHsv(centre, Math.max(.6, shift.sat + .1), Math.min(.7, Math.max(.45, shift.val[0] + .2)));
        const moved = recolorPixel(...cloth, rule);
        expect(hueGap(hueOf(...moved), shift.to), `${id} cloth`).toBeLessThan(12);
      }
      // The near-black outline is nobody's cloth.
      expect(recolorPixel(.03, .03, .04, rule), `${id} outline`).toEqual([.03, .03, .04]);
    }
  });

  it('keep skin out of the red rules (Kest, Rusk) and the bust background out of the blue ones', () => {
    const skin: [number, number, number] = [.82, .62, .5];
    expect(recolorPixel(...skin, COSTUMES['kest-rel'])).toEqual(skin);
    const bust = new Uint8ClampedArray([0x11, 0x1a, 0x24, 255]);
    for (const id of ['ilyra-voss', 'selene-wraith'] as const) {
      const px = bust.slice(); recolorImageData(px, COSTUMES[id], 0.17);
      expect([...px], id).toEqual([0x11, 0x1a, 0x24, 255]);
    }
  });
});
