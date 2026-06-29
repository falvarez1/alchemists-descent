import {
  PLAYER_CRAWL_H,
  PLAYER_H,
  PLAYER_HALF_W,
  type Ctx,
  type Enemy,
  type RigidBody,
  type RuntimeInspectionMarker,
} from '@/core/types';
import { MATERIAL_PARAMS } from '@/config/params';
import { enemyStateLabel } from '@/core/enemyState';
import { humanizeIdentifier } from '@/core/strings';
import { MATERIAL_LORE, recordLore } from '@/game/lore';
import { isConductor } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

interface InspectedTarget {
  kind: string;
  label: string;
  group: 'player' | 'enemy' | 'body' | 'pickup' | 'mechanism' | 'portal' | 'critter' | 'prefab' | 'decor';
  details: string[];
}

/**
 * Debug readout of the cell under the cursor — type/id, color, charge, life,
 * bloomWeight, and whether it conducts. Toggle with the `I` key.
 *
 * Why: the sim's emergent interactions are opaque from the outside (e.g. the cyan
 * "electrified ooze" turned out to be charge conducting through acid). A live cell
 * readout answers "what IS this and why is it doing that" instantly. Mouse coords
 * are already world-grid space (ctx.input.mouse), so this is a pure read.
 */
export class CellInspector {
  private readonly el: HTMLDivElement;
  private visible = false;
  private raf = 0;

  constructor(private readonly ctx: Ctx) {
    this.el = document.createElement('div');
    this.el.id = 'cell-inspector';
    this.el.style.cssText =
      'position:absolute;top:8px;left:8px;z-index:60;pointer-events:none;display:none;' +
      'font:11px var(--mono,ui-monospace,monospace);color:#cfe6ff;background:rgba(8,10,16,0.85);' +
      'border:1px solid #2a3550;border-radius:4px;padding:6px 9px;white-space:pre;line-height:1.5;';
    (document.getElementById('canvas-holder') ?? document.body).appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyI' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    this.examine();
    this.toggle();
  };

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    cancelAnimationFrame(this.raf);
    if (this.visible) this.loop();
  }

  private readonly loop = (): void => {
    if (!this.visible) return;
    this.update();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Public so a tick hook (or a probe) can refresh without the rAF loop. */
  update(): void {
    this.renderCellReadout(false);
  }

  examine(): void {
    this.renderCellReadout(true);
  }

  private renderCellReadout(discover: boolean): void {
    const w = this.ctx.world;
    const mx = this.ctx.input.mouse.x;
    const my = this.ctx.input.mouse.y;
    const x = Math.floor(mx);
    const y = Math.floor(my);
    if (!w.inBounds(x, y)) {
      this.el.textContent = `(${x}, ${y})  out of bounds`;
      return;
    }
    const i = w.idx(x, y);
    const t = w.types[i];
    const c = w.colors[i];
    const mat = MATERIAL_PARAMS[t];
    const name = mat?.name ?? `cell #${t}`;
    if (discover) recordLore(this.ctx, t);
    const lore = MATERIAL_LORE[t];
    const target = this.inspectTargetAt(mx, my);
    // Nearest enemy within ~12 cells of the cursor: show its live AI state.
    let near: { kind: string; state: string; hp: number; maxHp: number } | null = null;
    if (target?.group !== 'enemy') {
      let nd = 12 * 12;
      for (const e of this.ctx.enemies) {
        const dx = e.x - mx;
        const dy = e.y - 5 - my;
        const d = dx * dx + dy * dy;
        if (d < nd) {
          nd = d;
          near = { kind: e.kind, state: enemyStateLabel(e), hp: Math.ceil(e.hp), maxHp: e.maxHp };
        }
      }
    }
    const targetText = target
      ? `${target.kind}: ${target.label}\n${target.details.map((detail) => `  ${detail}`).join('\n')}\n\n`
      : '';
    this.el.textContent =
      `(${x}, ${y})\n` +
      targetText +
      `Cell: ${name}  [id ${t}]\n` +
      `rgb ${unpackR(c)}, ${unpackG(c)}, ${unpackB(c)}\n` +
      `charge ${w.charge[i]}   life ${w.life[i]}\n` +
      `bloom ${mat?.bloomWeight ?? 0}   ${isConductor(t) ? 'conductor' : 'insulator'}` +
      (lore ? `\n— ${lore.body}` : '') +
      (near ? `\n\n${near.kind}: ${near.state}   hp ${near.hp}/${near.maxHp}` : '');
  }

  private inspectTargetAt(mx: number, my: number): InspectedTarget | null {
    const player = this.ctx.player;
    if (this.pointInBody(mx, my, player.x, player.y, PLAYER_HALF_W, player.crawling ? PLAYER_CRAWL_H : PLAYER_H)) {
      return {
        kind: 'Entity',
        label: player.dead ? 'Player (dead)' : 'Player',
        group: 'player',
        details: [
          `position ${this.fmt(player.x)}, ${this.fmt(player.y)}`,
          `hp ${Math.ceil(player.hp)}/${player.maxHp}`,
          player.grounded ? 'grounded' : 'airborne',
        ],
      };
    }

    const enemy = this.enemyAt(mx, my);
    if (enemy) {
      return {
        kind: 'Entity',
        label: humanizeIdentifier(enemy.kind),
        group: 'enemy',
        details: [
          `state ${enemyStateLabel(enemy)}`,
          `position ${this.fmt(enemy.x)}, ${this.fmt(enemy.y)}`,
          `hp ${Math.ceil(enemy.hp)}/${enemy.maxHp}`,
        ],
      };
    }

    const body = this.ctx.rigidBodies.hitTest(mx, my);
    if (body) return this.rigidBodyTarget(body);

    const runtime = this.ctx.levels.current;
    if (runtime) {
      const pickup = runtime.pickups.find((p) => !p.taken && this.pointNear(mx, my, p.x, p.y, 5));
      if (pickup) {
        const data = pickup.data.card ?? pickup.data.potion ?? pickup.data.amount ?? '';
        return {
          kind: 'Entity',
          label: humanizeIdentifier(pickup.kind),
          group: 'pickup',
          details: [`position ${this.fmt(pickup.x)}, ${this.fmt(pickup.y)}`, data !== '' ? `data ${data}` : 'pickup'],
        };
      }

      const mechanism = runtime.mechanisms.find((m) => this.pointInRect(mx, my, m.x, m.y, m.x + m.w, m.y + m.h));
      if (mechanism) {
        return {
          kind: 'Entity',
          label: humanizeIdentifier(mechanism.kind),
          group: 'mechanism',
          details: [`id ${mechanism.id}`, `state ${this.fmt(mechanism.state)}`, `size ${mechanism.w} x ${mechanism.h}`],
        };
      }

      if (runtime.portal && this.pointInRect(mx, my, runtime.portal.x - 5, runtime.portal.y - 14, runtime.portal.x + 6, runtime.portal.y + 1)) {
        return {
          kind: 'Entity',
          label: 'Exit Portal',
          group: 'portal',
          details: [`position ${this.fmt(runtime.portal.x)}, ${this.fmt(runtime.portal.y)}`, runtime.portal.open ? 'open' : 'closed'],
        };
      }

      const marker = this.markerAt(mx, my, runtime.inspectionMarkers ?? []);
      if (marker) {
        return {
          kind: humanizeIdentifier(marker.kind),
          label: marker.label,
          group: marker.kind === 'decor' ? 'decor' : 'prefab',
          details: [marker.detail ?? 'authored cell dressing'],
        };
      }

      const placed = this.smallestRectAt(mx, my, runtime.placedPrefabs ?? []);
      if (placed) {
        return {
          kind: 'Prefab',
          label: humanizeIdentifier(placed.id),
          group: 'prefab',
          details: [`bounds ${placed.x0},${placed.y0} - ${placed.x1},${placed.y1}`],
        };
      }

      const scene = this.smallestRectAt(mx, my, runtime.generatedScenes ?? []);
      if (scene) {
        return {
          kind: 'Prefab',
          label: scene.label,
          group: 'prefab',
          details: [`scene ${scene.sceneId}`, `${scene.objectCount} objects, ${scene.lightCount} lights`],
        };
      }
    }

    const critter = this.ctx.critters.list.find((c) => this.pointNear(mx, my, c.x, c.y, 3));
    if (critter) {
      return {
        kind: 'Entity',
        label: humanizeIdentifier(critter.kind),
        group: 'critter',
        details: [`position ${this.fmt(critter.x)}, ${this.fmt(critter.y)}`],
      };
    }

    return null;
  }

  private enemyAt(mx: number, my: number): Enemy | null {
    for (const enemy of this.ctx.enemies) {
      const def = this.ctx.enemyCtl.defs[enemy.kind];
      if (this.pointInBody(mx, my, enemy.x, enemy.y, def.halfW, def.h)) return enemy;
    }
    return null;
  }

  private rigidBodyTarget(body: RigidBody): InspectedTarget {
    const base = body.payload === 'explosive'
      ? 'Explosive Barrel'
      : body.shape.kind === 'circle'
        ? 'Boulder'
        : 'Crate';
    const material = body.material ? humanizeIdentifier(body.material) : '';
    const label = `${material} ${base}`.trim();
    const size = body.shape.kind === 'circle'
      ? `r ${this.fmt(body.shape.radius)}`
      : `${this.fmt(body.shape.halfW * 2)} x ${this.fmt(body.shape.halfH * 2)}`;
    return {
      kind: 'Entity',
      label,
      group: 'body',
      details: [
        `rigid body #${body.id}`,
        `position ${this.fmt(body.x)}, ${this.fmt(body.y)}`,
        `shape ${body.shape.kind} ${size}`,
      ],
    };
  }

  private markerAt(mx: number, my: number, markers: readonly RuntimeInspectionMarker[]): RuntimeInspectionMarker | null {
    return this.smallestRectAt(mx, my, markers);
  }

  private smallestRectAt<T extends { x0: number; y0: number; x1: number; y1: number }>(
    mx: number,
    my: number,
    items: readonly T[],
  ): T | null {
    let best: T | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const item of items) {
      if (!this.pointInRect(mx, my, item.x0, item.y0, item.x1, item.y1)) continue;
      const area = Math.max(1, item.x1 - item.x0 + 1) * Math.max(1, item.y1 - item.y0 + 1);
      if (area < bestArea) {
        best = item;
        bestArea = area;
      }
    }
    return best;
  }

  private pointInBody(mx: number, my: number, x: number, y: number, halfW: number, h: number): boolean {
    return mx >= x - halfW && mx <= x + halfW && my >= y - h + 1 && my <= y + 1;
  }

  private pointInRect(mx: number, my: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const ax = Math.min(x0, x1);
    const bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1);
    const by = Math.max(y0, y1);
    return mx >= ax && mx <= bx && my >= ay && my <= by;
  }

  private pointNear(mx: number, my: number, x: number, y: number, r: number): boolean {
    const dx = mx - x;
    const dy = my - y;
    return dx * dx + dy * dy <= r * r;
  }

  private fmt(n: number): string {
    return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : String(n);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
