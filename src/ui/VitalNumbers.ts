import type { Ctx } from '@/core/types';

/** "110/110" for a bar: whole numbers, never below zero, never above the maximum. */
export function formatVital(value: number, max: number, round: (n: number) => number = Math.floor): string {
  const cap = Math.max(0, Math.round(max));
  const now = Math.min(cap, Math.max(0, round(value)));
  return `${now}/${cap}`;
}

const ROWS: ReadonlyArray<{ fill: string; read: (ctx: Ctx) => string }> = [
  { fill: 'hp-fill', read: ({ player }) => formatVital(player.hp, player.maxHp, Math.ceil) },
  { fill: 'mana-fill', read: ({ player }) => formatVital(player.mana, player.maxMana) },
  { fill: 'levit-fill', read: ({ player }) => formatVital(player.levit, player.maxLevit) },
];

/**
 * Numeric vitals (a player option, off by default): the exact figure beside the HP,
 * MANA and LEV bars. A readout only: it reads the player and writes text, nothing more.
 * While off there is no element, no class and no frame callback, so the HUD is untouched.
 */
export class VitalNumbers {
  private readonly nodes: Array<{ num: HTMLElement; read: (ctx: Ctx) => string; text: string }> = [];
  private raf: number | null = null;

  constructor(private readonly ctx: Ctx) {}

  setEnabled(on: boolean): void {
    document.body.classList.toggle('vitals-numeric', on);
    if (!on) { this.stop(); return; }
    if (this.nodes.length === 0) {
      for (const row of ROWS) {
        const host = document.getElementById(row.fill)?.closest('.vital-row');
        if (!host) continue;
        const num = document.createElement('span');
        num.className = 'vital-num';
        num.setAttribute('aria-hidden', 'true'); // the bar's own aria-label already speaks it
        host.appendChild(num);
        this.nodes.push({ num, read: row.read, text: '' });
      }
    }
    if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    for (const node of this.nodes) {
      const text = node.read(this.ctx);
      if (text !== node.text) { node.text = text; node.num.textContent = text; }
    }
  };

  private stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const node of this.nodes.splice(0)) node.num.remove();
  }

  dispose(): void { this.stop(); document.body.classList.remove('vitals-numeric'); }
}
