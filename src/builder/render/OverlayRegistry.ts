import { objectFootprint } from '@/builder/document';
import type { EditorDocument } from '@/builder/document';
import type { DocIssue } from '@/builder/validate';

export interface BuilderOverlayDrawContext {
  doc: EditorDocument;
  issues: readonly DocIssue[];
  cellW: number;
  cellH: number;
  toScreen(wx: number, wy: number): { x: number; y: number };
}

export interface EditorOverlay {
  id: string;
  label: string;
  defaultVisible: boolean;
  draw(g: CanvasRenderingContext2D, ctx: BuilderOverlayDrawContext): void;
}

export const BUILDER_OVERLAYS = [
  {
    id: 'light',
    label: 'Light Coverage',
    defaultVisible: false,
    draw(g, ctx) {
      for (const l of ctx.doc.lights) {
        if (l.hidden) continue;
        blob(g, ctx, l.x, l.y, l.radius, l.color + '40');
      }
    },
  },
  {
    id: 'danger',
    label: 'Danger',
    defaultVisible: false,
    draw(g, ctx) {
      for (const o of ctx.doc.objects) {
        if (o.hidden) continue;
        if (o.kind === 'enemy') blob(g, ctx, o.x, o.y, 60, 'rgba(248,113,113,0.22)');
        if (o.kind === 'bossMarker') blob(g, ctx, o.x, o.y, 90, 'rgba(248,113,113,0.3)');
        if (o.kind === 'hazardEmitter') blob(g, ctx, o.x, o.y, 34, 'rgba(251,146,60,0.22)');
      }
    },
  },
  {
    id: 'loot',
    label: 'Loot And Rewards',
    defaultVisible: false,
    draw(g, ctx) {
      for (const o of ctx.doc.objects) {
        if (o.kind === 'pickup' && !o.hidden) blob(g, ctx, o.x, o.y, 26, 'rgba(251,191,36,0.28)');
      }
    },
  },
  {
    id: 'clearance',
    label: 'Player Clearance',
    defaultVisible: false,
    draw(g, ctx) {
      for (const o of ctx.doc.objects) {
        if (o.kind !== 'spawn' || o.hidden) continue;
        const p = ctx.toScreen(o.x, o.y);
        g.strokeStyle = 'rgba(125,211,252,0.65)';
        g.setLineDash([4, 3]);
        g.strokeRect(p.x - 6 * ctx.cellW, p.y - 12 * ctx.cellH, 12 * ctx.cellW, 14 * ctx.cellH);
        g.setLineDash([]);
      }
    },
  },
  {
    id: 'hiddenLocked',
    label: 'Hidden And Locked',
    defaultVisible: false,
    draw(g, ctx) {
      for (const o of ctx.doc.objects) {
        if (!o.hidden && !o.locked) continue;
        const f = objectFootprint(o);
        const a = f ? ctx.toScreen(f.x0, f.y0) : ctx.toScreen(o.x - 3, o.y - 3);
        const b = f ? ctx.toScreen(f.x1 + 1, f.y1 + 1) : ctx.toScreen(o.x + 3, o.y + 3);
        g.strokeStyle = o.hidden ? 'rgba(148,163,184,0.65)' : 'rgba(251,191,36,0.75)';
        g.setLineDash(o.hidden ? [2, 3] : [6, 3]);
        g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        g.setLineDash([]);
      }
    },
  },
  {
    id: 'validation',
    label: 'Validation Badges',
    defaultVisible: false,
    draw(g, ctx) {
      const locatable = ctx.issues.filter((issue) => issue.objId);
      for (const issue of locatable) {
        const obj = ctx.doc.objects.find((o) => o.id === issue.objId);
        const light = obj ? null : ctx.doc.lights.find((l) => l.id === issue.objId);
        const rec = obj ?? light;
        if (!rec) continue;
        const f = obj ? objectFootprint(obj) : null;
        const p = f ? ctx.toScreen((f.x0 + f.x1) / 2, f.y0) : ctx.toScreen(rec.x, rec.y);
        g.fillStyle = issue.severity === 'error' ? '#ef4444' : issue.severity === 'warning' ? '#f59e0b' : '#38bdf8';
        g.beginPath();
        g.arc(p.x + 7, p.y - 7, 5, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
] satisfies EditorOverlay[];

export type BuilderOverlayId = (typeof BUILDER_OVERLAYS)[number]['id'];

export const BUILDER_OVERLAY_IDS = BUILDER_OVERLAYS.map((overlay) => overlay.id) as BuilderOverlayId[];

export function overlayLabel(id: BuilderOverlayId): string {
  return BUILDER_OVERLAYS.find((overlay) => overlay.id === id)?.label ?? id;
}

export function drawBuilderOverlays(
  g: CanvasRenderingContext2D,
  ctx: BuilderOverlayDrawContext,
  visible: ReadonlySet<string>,
): void {
  for (const overlay of BUILDER_OVERLAYS) {
    if (visible.has(overlay.id)) overlay.draw(g, ctx);
  }
}

export function sanitizeOverlayVisibility(input: Record<string, boolean> | undefined): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const overlay of BUILDER_OVERLAYS) next[overlay.id] = input?.[overlay.id] ?? overlay.defaultVisible;
  return next;
}

function blob(
  g: CanvasRenderingContext2D,
  ctx: BuilderOverlayDrawContext,
  wx: number,
  wy: number,
  r: number,
  color: string,
): void {
  const c = ctx.toScreen(wx, wy);
  const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(4, r * ctx.cellW));
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c.x, c.y, Math.max(4, r * ctx.cellW), 0, Math.PI * 2);
  g.fill();
}
