import { clamp } from '@/core/math';
import { HEIGHT, WIDTH } from '@/config/constants';

interface Subject { x: number; y: number; vx: number; vy: number }

/** The closest the stock camera comes (concepts/camera-direction.png panel 1: fighters ~90 px tall at 720p). */
export const STOCK_ZOOM_MAX = 2.3;

/** Fixed-tick framing. The camera owns presentation only, never knockout bounds. */
export class StockCameraRig {
  x = 800; y = 550; zoom = 1;
  reset(x: number, y: number, zoom = 1): void { this.x = x; this.y = y; this.zoom = zoom; }
  step(subjects: readonly Subject[]): void {
    if (!subjects.length) return;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const p of subjects) {
      const px = p.x + clamp(p.vx * 10, -65, 65), py = p.y + clamp(p.vy * 7, -45, 55);
      left = Math.min(left, p.x, px); right = Math.max(right, p.x, px);
      top = Math.min(top, p.y - 20, py - 20); bottom = Math.max(bottom, p.y, py);
    }
    // Concept framing (camera-direction.png): close combat reads at ~2.3x, the whole stage at the bottom of the range.
    const targetZoom = clamp(Math.min(640 / (right - left + 180), 360 / (bottom - top + 135)), .4, STOCK_ZOOM_MAX);
    // Asymmetric response: opening the frame is urgent; tightening it should be barely noticed.
    this.zoom += (targetZoom - this.zoom) * (targetZoom < this.zoom ? .20 : .025);
    // Feet on the lower-third line (~64% of the frame), as in foundry-match.png, but only as far as the vertical slack
    // allows: a fighter far below must never be pushed out of frame. Uses the target zoom, so footwork jitter while the
    // zoom is still settling does not creep the frame.
    const halfSpan = (bottom - top) / 2, slack = Math.max(0, 180 / targetZoom - halfSpan - 58 / targetZoom);
    const tx = (left + right) / 2, ty = (top + bottom) / 2 - Math.min(Math.max(0, 50 / targetZoom - 10), slack);
    const dx = tx - this.x, dy = ty - this.y;
    // Dead zones are screen space (tuned at 1x): small footwork never moves the frame.
    const deadX = 10 / targetZoom, deadY = 7 / targetZoom;
    if (Math.abs(dx) > deadX) this.x += (dx - Math.sign(dx) * deadX) * .12;
    if (Math.abs(dy) > deadY) this.y += (dy - Math.sign(dy) * deadY) * .10;
    // Keep a launched fighter inside the usable frame while easing catches up.
    const halfW = 320 / this.zoom, halfH = 180 / this.zoom;
    // Margins are screen space (tuned at 1x): HUD clearance under the feet, headroom above, a little air at the sides.
    const side = 32 / this.zoom, below = 58 / this.zoom, above = 32 / this.zoom;
    if (right - left + side * 2 < halfW * 2) this.x = clamp(this.x, right + side - halfW, left - side + halfW);
    if (bottom - top + below + above < halfH * 2) this.y = clamp(this.y, bottom + below - halfH, top - above + halfH);
    this.x = clamp(this.x, halfW, WIDTH - halfW);
    this.y = clamp(this.y, halfH, HEIGHT - halfH);
  }
}
