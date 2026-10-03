import { clamp } from '@/core/math';
import { HEIGHT, WIDTH } from '@/config/constants';

interface Subject { x: number; y: number; vx: number; vy: number }

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
    const targetZoom = clamp(Math.min(640 / (right - left + 180), 360 / (bottom - top + 160)), .4, 1.65);
    // Asymmetric response: opening the frame is urgent; tightening it should be barely noticed.
    this.zoom += (targetZoom - this.zoom) * (targetZoom < this.zoom ? .20 : .025);
    const tx = (left + right) / 2, ty = (top + bottom) / 2 - 22;
    const dx = tx - this.x, dy = ty - this.y;
    if (Math.abs(dx) > 10) this.x += (dx - Math.sign(dx) * 10) * .12;
    if (Math.abs(dy) > 7) this.y += (dy - Math.sign(dy) * 7) * .10;
    // Keep a launched fighter inside the usable frame while easing catches up.
    const halfW = 320 / this.zoom, halfH = 180 / this.zoom;
    if (right - left + 64 < halfW * 2) this.x = clamp(this.x, right + 32 - halfW, left - 32 + halfW);
    if (bottom - top + 90 < halfH * 2) this.y = clamp(this.y, bottom + 58 - halfH, top - 32 + halfH);
    this.x = clamp(this.x, halfW, WIDTH - halfW);
    this.y = clamp(this.y, halfH, HEIGHT - halfH);
  }
}
