export type SnapStep = 0 | 4 | 8 | 16;

export const SNAP_STEPS: readonly SnapStep[] = [0, 4, 8, 16];

export interface WorldViewBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Measurement {
  dx: number;
  dy: number;
  distance: number;
  label: string;
}

export function sanitizeSnapStep(value: unknown): SnapStep {
  return value === 4 || value === 8 || value === 16 ? value : 0;
}

export function nextSnapStep(step: SnapStep): SnapStep {
  const index = SNAP_STEPS.indexOf(step);
  return SNAP_STEPS[(index + 1) % SNAP_STEPS.length] ?? 0;
}

export function snapValue(value: number, step: SnapStep, override = false): number {
  if (override || step === 0) return value;
  return Math.round(value / step) * step;
}

export function measurementBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Measurement {
  const dx = Math.round(b.x - a.x);
  const dy = Math.round(b.y - a.y);
  const distance = Math.hypot(dx, dy);
  return {
    dx,
    dy,
    distance,
    label: `${Math.abs(dx)} x ${Math.abs(dy)} cells / ${distance.toFixed(1)} diag`,
  };
}

export function gridLineStart(min: number, step: SnapStep): number {
  if (step === 0) return min;
  return Math.floor(min / step) * step;
}

export function drawSnapGrid(
  g: CanvasRenderingContext2D,
  opts: {
    snapStep: SnapStep;
    view: WorldViewBounds;
    cellW: number;
    cellH: number;
    width: number;
    height: number;
    toScreen: (wx: number, wy: number) => ScreenPoint;
  },
): void {
  const { snapStep, view, cellW, cellH, width, height, toScreen } = opts;
  if (snapStep === 0) return;
  const pxStep = Math.min(cellW, cellH) * snapStep;
  if (pxStep < 7) return;

  g.save();
  const xStart = gridLineStart(view.x0, snapStep);
  const yStart = gridLineStart(view.y0, snapStep);
  for (const major of [false, true]) {
    g.strokeStyle = major
      ? pxStep >= 24 ? 'rgba(125,211,252,0.20)' : 'rgba(125,211,252,0.13)'
      : pxStep >= 24 ? 'rgba(125,211,252,0.09)' : 'rgba(125,211,252,0.055)';
    g.lineWidth = major ? 1.25 : 1;
    g.beginPath();
    for (let x = xStart; x <= view.x1 + snapStep; x += snapStep) {
      if (isMajorGridLine(x, snapStep) !== major) continue;
      const p = toScreen(x, view.y0);
      if (p.x < -1 || p.x > width + 1) continue;
      const sx = Math.round(p.x) + 0.5;
      g.moveTo(sx, 0);
      g.lineTo(sx, height);
    }
    for (let y = yStart; y <= view.y1 + snapStep; y += snapStep) {
      if (isMajorGridLine(y, snapStep) !== major) continue;
      const p = toScreen(view.x0, y);
      if (p.y < -1 || p.y > height + 1) continue;
      const sy = Math.round(p.y) + 0.5;
      g.moveTo(0, sy);
      g.lineTo(width, sy);
    }
    g.stroke();
  }
  g.restore();
}

export function drawCoordinateReadout(
  g: CanvasRenderingContext2D,
  opts: {
    mouse: { x: number; y: number };
    snapStep: SnapStep;
    width: number;
    height: number;
    extra?: string;
  },
): void {
  const snap = opts.snapStep === 0 ? 'OFF' : String(opts.snapStep);
  const text = `X ${Math.floor(opts.mouse.x)}  Y ${Math.floor(opts.mouse.y)}  SNAP ${snap}${opts.extra ? `  ${opts.extra}` : ''}`;
  g.save();
  g.font = '700 10px monospace';
  const metrics = g.measureText(text);
  const padX = 7;
  const x = Math.max(8, opts.width - metrics.width - padX * 2 - 10);
  const y = opts.height - 25;
  g.fillStyle = 'rgba(5,10,18,0.82)';
  g.strokeStyle = 'rgba(125,211,252,0.34)';
  g.lineWidth = 1;
  g.fillRect(x, y, metrics.width + padX * 2, 18);
  g.strokeRect(x, y, metrics.width + padX * 2, 18);
  g.fillStyle = 'rgba(214,230,245,0.92)';
  g.fillText(text, x + padX, y + 12);
  g.restore();
}

function isMajorGridLine(value: number, step: SnapStep): boolean {
  return Math.abs(Math.round(value / step)) % 4 === 0;
}
