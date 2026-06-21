import type {
  RuntimeEntityBounds,
  RuntimeEntityGroup,
  RuntimeEntityRow,
  RuntimeEntitySnapshot,
} from '@/game/runtimeSnapshot';
import { clamp } from '@/core/math';

export type RuntimeOverlayKind = 'bounds' | 'labels' | 'velocity';

export type RuntimeOverlayState = Record<RuntimeOverlayKind, boolean>;

export const DEFAULT_RUNTIME_OVERLAYS: RuntimeOverlayState = {
  bounds: false,
  labels: false,
  velocity: false,
};

export const RUNTIME_OVERLAY_OPTIONS = [
  { id: 'bounds', label: 'Bounds', title: 'Draw runtime footprints and anchor markers' },
  { id: 'labels', label: 'IDs', title: 'Label active runtime rows in the viewport' },
  { id: 'velocity', label: 'Velocity', title: 'Draw velocity vectors for moving runtime rows' },
] satisfies Array<{ id: RuntimeOverlayKind; label: string; title: string }>;

export const RUNTIME_OVERLAY_ROW_LIMITS = {
  player: 1,
  enemies: 240,
  projectiles: 240,
  critters: 180,
  pickups: 180,
  mechanisms: 260,
  portal: 1,
  particles: 0,
} satisfies Partial<Record<RuntimeEntityGroup, number>>;

const MAX_OVERLAY_ROWS = 420;
const MAX_OVERLAY_LABELS = 90;

interface RuntimeOverlayPalette {
  stroke: string;
  fill: string;
  label: string;
  velocity: string;
}

const PALETTES: Record<RuntimeEntityGroup, RuntimeOverlayPalette> = {
  player: {
    stroke: 'rgba(125,211,252,0.95)',
    fill: 'rgba(125,211,252,0.16)',
    label: '#bae6fd',
    velocity: 'rgba(125,211,252,0.9)',
  },
  enemies: {
    stroke: 'rgba(248,113,113,0.9)',
    fill: 'rgba(248,113,113,0.13)',
    label: '#fecaca',
    velocity: 'rgba(248,113,113,0.88)',
  },
  projectiles: {
    stroke: 'rgba(250,204,21,0.9)',
    fill: 'rgba(250,204,21,0.12)',
    label: '#fef08a',
    velocity: 'rgba(250,204,21,0.86)',
  },
  critters: {
    stroke: 'rgba(74,222,128,0.86)',
    fill: 'rgba(74,222,128,0.11)',
    label: '#bbf7d0',
    velocity: 'rgba(74,222,128,0.8)',
  },
  pickups: {
    stroke: 'rgba(251,191,36,0.88)',
    fill: 'rgba(251,191,36,0.13)',
    label: '#fde68a',
    velocity: 'rgba(251,191,36,0.8)',
  },
  mechanisms: {
    stroke: 'rgba(196,181,253,0.86)',
    fill: 'rgba(196,181,253,0.1)',
    label: '#ddd6fe',
    velocity: 'rgba(196,181,253,0.75)',
  },
  portal: {
    stroke: 'rgba(45,212,191,0.9)',
    fill: 'rgba(45,212,191,0.14)',
    label: '#99f6e4',
    velocity: 'rgba(45,212,191,0.76)',
  },
  particles: {
    stroke: 'rgba(148,163,184,0.7)',
    fill: 'rgba(148,163,184,0.08)',
    label: '#cbd5e1',
    velocity: 'rgba(148,163,184,0.7)',
  },
};

export interface RuntimeOverlayDrawContext {
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  labelY?: number;
  toScreen(wx: number, wy: number): { x: number; y: number };
}

export function runtimeOverlaysActive(state: RuntimeOverlayState): boolean {
  return RUNTIME_OVERLAY_OPTIONS.some((option) => state[option.id]);
}

export function runtimeOverlaySummary(state: RuntimeOverlayState): string {
  const active = RUNTIME_OVERLAY_OPTIONS.filter((option) => state[option.id]).map((option) => option.label.toUpperCase());
  return active.length === 0 ? 'OFF' : active.join(', ');
}

export function runtimeOverlayRows(snapshot: RuntimeEntitySnapshot): RuntimeEntityRow[] {
  const selectedId = snapshot.selectedRow?.id ?? snapshot.selectedId;
  const rows = snapshot.rows.filter((row) => row.group !== 'particles' && row.visible);
  const capped = rows.slice(0, MAX_OVERLAY_ROWS);
  if (selectedId === null || capped.some((row) => row.id === selectedId)) return capped;
  const selected = rows.find((row) => row.id === selectedId);
  return selected ? [...capped, selected] : capped;
}

export function drawRuntimeEntityOverlays(
  g: CanvasRenderingContext2D,
  snapshot: RuntimeEntitySnapshot,
  state: RuntimeOverlayState,
  ctx: RuntimeOverlayDrawContext,
): void {
  if (!runtimeOverlaysActive(state)) return;

  const rows = runtimeOverlayRows(snapshot);
  const selectedId = snapshot.selectedRow?.id ?? snapshot.selectedId;
  let labels = 0;

  g.save();
  drawLegend(g, state, ctx, rows.length);
  for (const row of rows) {
    const selected = selectedId === row.id;
    if (state.bounds) drawBounds(g, row, ctx, selected);
    else drawAnchor(g, row, ctx, selected);
    if (state.velocity) drawVelocity(g, row, ctx, selected);
    if (state.labels && labels < MAX_OVERLAY_LABELS) {
      drawLabel(g, row, ctx, selected);
      labels++;
    }
  }
  g.restore();
}

function drawLegend(
  g: CanvasRenderingContext2D,
  state: RuntimeOverlayState,
  ctx: RuntimeOverlayDrawContext,
  rowCount: number,
): void {
  const text = `RUNTIME: ${runtimeOverlaySummary(state)} (${rowCount} rows)`;
  g.font = '700 10px monospace';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(5,8,13,0.76)';
  g.strokeStyle = 'rgba(45,212,191,0.45)';
  const y = ctx.labelY ?? 16;
  const w = Math.ceil(g.measureText(text).width) + 12;
  g.fillRect(8, y - 12, w, 17);
  g.strokeRect(8.5, y - 11.5, w - 1, 16);
  g.fillStyle = 'rgba(153,246,228,0.92)';
  g.fillText(text, 14, y);
}

function drawBounds(
  g: CanvasRenderingContext2D,
  row: RuntimeEntityRow,
  ctx: RuntimeOverlayDrawContext,
  selected: boolean,
): void {
  const palette = PALETTES[row.group];
  const bounds = row.bounds ?? fallbackBounds(row);
  const a = ctx.toScreen(bounds.x0, bounds.y0);
  const b = ctx.toScreen(bounds.x1, bounds.y1);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(2, Math.abs(b.x - a.x));
  const h = Math.max(2, Math.abs(b.y - a.y));

  g.fillStyle = selected ? 'rgba(255,255,255,0.18)' : palette.fill;
  g.strokeStyle = selected ? 'rgba(255,255,255,0.96)' : palette.stroke;
  g.lineWidth = selected ? 2 : 1;
  g.setLineDash(row.group === 'mechanisms' || row.group === 'portal' ? [4, 3] : []);
  g.fillRect(x, y, w, h);
  g.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
  g.setLineDash([]);
  drawAnchorDot(g, row, ctx, selected);
}

function drawAnchor(
  g: CanvasRenderingContext2D,
  row: RuntimeEntityRow,
  ctx: RuntimeOverlayDrawContext,
  selected: boolean,
): void {
  drawAnchorDot(g, row, ctx, selected);
}

function drawAnchorDot(
  g: CanvasRenderingContext2D,
  row: RuntimeEntityRow,
  ctx: RuntimeOverlayDrawContext,
  selected: boolean,
): void {
  const palette = PALETTES[row.group];
  const p = ctx.toScreen(row.x, row.y);
  g.fillStyle = selected ? 'rgba(255,255,255,0.96)' : palette.stroke;
  g.strokeStyle = 'rgba(5,8,13,0.82)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(p.x, p.y, selected ? 4 : 3, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

function drawVelocity(
  g: CanvasRenderingContext2D,
  row: RuntimeEntityRow,
  ctx: RuntimeOverlayDrawContext,
  selected: boolean,
): void {
  const vx = row.vx ?? 0;
  const vy = row.vy ?? 0;
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || vx * vx + vy * vy < 0.01) return;
  const palette = PALETTES[row.group];
  const a = ctx.toScreen(row.x, row.y);
  const b = ctx.toScreen(row.x + vx * 5, row.y + vy * 5);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 4) return;

  g.strokeStyle = selected ? 'rgba(255,255,255,0.92)' : palette.velocity;
  g.fillStyle = g.strokeStyle;
  g.lineWidth = selected ? 2 : 1;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();

  const angle = Math.atan2(dy, dx);
  const head = 5;
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.x - Math.cos(angle - 0.55) * head, b.y - Math.sin(angle - 0.55) * head);
  g.lineTo(b.x - Math.cos(angle + 0.55) * head, b.y - Math.sin(angle + 0.55) * head);
  g.closePath();
  g.fill();
}

function drawLabel(
  g: CanvasRenderingContext2D,
  row: RuntimeEntityRow,
  ctx: RuntimeOverlayDrawContext,
  selected: boolean,
): void {
  const palette = PALETTES[row.group];
  const bounds = row.bounds ?? fallbackBounds(row);
  const anchor = ctx.toScreen(bounds.x1, bounds.y0);
  const text = runtimeRowOverlayLabel(row);
  g.font = selected ? '800 10px monospace' : '700 10px monospace';
  const padX = 4;
  const w = Math.ceil(g.measureText(text).width) + padX * 2;
  const x = clamp(anchor.x + 5, 2, Math.max(2, ctx.width - w - 2));
  const y = clamp(anchor.y - 2, 14, Math.max(14, ctx.height - 4));
  g.fillStyle = 'rgba(4,7,12,0.82)';
  g.strokeStyle = selected ? 'rgba(255,255,255,0.88)' : palette.stroke;
  g.lineWidth = 1;
  g.fillRect(x, y - 12, w, 15);
  g.strokeRect(x + 0.5, y - 11.5, w - 1, 14);
  g.fillStyle = selected ? '#ffffff' : palette.label;
  g.fillText(text, x + padX, y);
}

function runtimeRowOverlayLabel(row: RuntimeEntityRow): string {
  if (row.group === 'mechanisms' || row.group === 'portal') return row.label;
  if (row.id === 'player') return 'player';
  return `${row.label} ${shortRuntimeId(row.id)}`.slice(0, 48);
}

function shortRuntimeId(id: string): string {
  const [prefix, ...parts] = id.split(':');
  const last = parts[parts.length - 1] ?? '';
  return last === '' ? prefix : `${prefix}:${last}`;
}

function fallbackBounds(row: RuntimeEntityRow): RuntimeEntityBounds {
  const radius = row.group === 'player' ? 6 : row.group === 'projectiles' ? 2 : 4;
  return {
    x0: row.x - radius,
    y0: row.y - radius,
    x1: row.x + radius + 1,
    y1: row.y + radius + 1,
  };
}
