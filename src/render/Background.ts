import { HEIGHT, WIDTH } from '@/config/constants';
import { valueNoise } from '@/core/math';
import type { ParallaxLayers } from '@/render/pixels';

/**
 * Two parallax backdrop layers, baked at world size:
 *   bgFar  — distant silhouette spires/stalactites (scrolls at 0.35x camera)
 *   bgNear — dim rock texture (scrolls at 0.62x camera)
 */
export class Background implements ParallaxLayers {
  readonly bgFar: Float32Array;
  readonly bgNear: Float32Array;

  constructor() {
    this.bgFar = new Float32Array(WIDTH * HEIGHT);
    this.bgNear = new Float32Array(WIDTH * HEIGHT);

    const S = 1337;
    // Far layer: jagged skyline of hanging and rising rock masses
    for (let x = 0; x < WIDTH; x++) {
      const ridge = valueNoise(x, 0, 0.007, S + 1);
      const jag = valueNoise(x, 9, 0.03, S + 2);
      const topLen = 46 + ridge * 250 + jag * jag * 175;
      const botRidge = valueNoise(x, 3, 0.006, S + 3);
      const botJag = valueNoise(x, 5, 0.025, S + 4);
      const botLen = 70 + botRidge * 290 + botJag * botJag * 135;
      for (let y = 0; y < HEIGHT; y++) {
        const i = y * WIDTH + x;
        this.bgFar[i] = y < topLen || y > HEIGHT - botLen ? 1 : 0;
      }
    }
    // Near layer: layered rock texture
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const n1 = valueNoise(x, y, 0.009, S + 7);
        const n2 = valueNoise(x, y, 0.028, S + 11);
        const n3 = valueNoise(x, y, 0.08, S + 13);
        this.bgNear[y * WIDTH + x] = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
      }
    }
  }
}
