import type { Ctx } from '@/core/types';
import { MATERIAL_PARAMS } from '@/config/params';
import { enemyStateLabel } from '@/entities/Enemies';
import { MATERIAL_LORE, recordLore } from '@/game/lore';
import { isConductor } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

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
    const w = this.ctx.world;
    const x = Math.floor(this.ctx.input.mouse.x);
    const y = Math.floor(this.ctx.input.mouse.y);
    if (!w.inBounds(x, y)) {
      this.el.textContent = `(${x}, ${y})  out of bounds`;
      return;
    }
    const i = w.idx(x, y);
    const t = w.types[i];
    const c = w.colors[i];
    const mat = MATERIAL_PARAMS[t];
    const name = mat?.name ?? `cell #${t}`;
    // Examining IS discovery: the first look at a cataloged material inscribes its
    // lore into the Grimoire. Allowed in every mode (the Sandbox paint mode is
    // internally 'build') — it only ever adds to the player's persistent knowledge.
    recordLore(this.ctx, t);
    const lore = MATERIAL_LORE[t];
    // Nearest enemy within ~12 cells of the cursor: show its live AI state.
    let near: { kind: string; state: string; hp: number; maxHp: number } | null = null;
    let nd = 12 * 12;
    for (const e of this.ctx.enemies) {
      const dx = e.x - this.ctx.input.mouse.x;
      const dy = e.y - 5 - this.ctx.input.mouse.y;
      const d = dx * dx + dy * dy;
      if (d < nd) {
        nd = d;
        near = { kind: e.kind, state: enemyStateLabel(e), hp: Math.ceil(e.hp), maxHp: e.maxHp };
      }
    }
    this.el.textContent =
      `(${x}, ${y})\n` +
      `${name}  [id ${t}]\n` +
      `rgb ${unpackR(c)}, ${unpackG(c)}, ${unpackB(c)}\n` +
      `charge ${w.charge[i]}   life ${w.life[i]}\n` +
      `bloom ${mat?.bloomWeight ?? 0}   ${isConductor(t) ? 'conductor' : 'insulator'}` +
      (lore ? `\n— ${lore.body}` : '') +
      (near ? `\n\n${near.kind}: ${near.state}   hp ${near.hp}/${near.maxHp}` : '');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
