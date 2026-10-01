import { BRAIN_BLURBS, BRAIN_IDS } from '@/arena/ai';
import type { BrainId } from '@/arena/ai';
import { botDriverFor } from '@/arena/ai/driver';
import type { Ctx } from '@/core/types';

/**
 * THE BOTS SECTION of the Proving Yard's panel (docs/arena/AI-FIGHTERS.md 5): who is at the controls of the fighter in hand.
 * "You" (the keyboard), a computer brain and a skill level 1-5; while a brain plays, one line says what it is thinking
 * (its goal, who it is after and which rule last fired) and a few counters say what it has done. Presentation only: the
 * driver (arena/ai/driver) does the work, this reads it.
 */
export class ArenaBotsPanel {
  readonly root = document.createElement('div');
  private readonly brainBtns = new Map<BrainId | 'off', HTMLButtonElement>();
  private readonly levelBtns: HTMLButtonElement[] = [];
  private readonly think = document.createElement('div');
  private readonly stats = document.createElement('div');
  private level = 3;
  private last = '';

  constructor(private readonly ctx: Ctx) {
    this.root.className = 'fa-section fa-bots';
    const label = document.createElement('div');
    label.className = 'fa-label';
    label.textContent = 'At the controls';
    const row = document.createElement('div');
    row.className = 'fa-buttons';
    const make = (id: BrainId | 'off', text: string, title: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fa-btn';
      b.textContent = text;
      b.title = title;
      b.dataset.brain = id;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.choose(id));
      this.brainBtns.set(id, b);
      row.append(b);
      return b;
    };
    make('off', 'You', 'The keyboard and mouse are yours');
    for (const id of BRAIN_IDS) make(id, id, BRAIN_BLURBS[id]);
    const levels = document.createElement('div');
    levels.className = 'fa-buttons fa-levels';
    const lv = document.createElement('span');
    lv.className = 'fa-bar-label';
    lv.textContent = 'Skill';
    levels.append(lv);
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fa-btn fa-level';
      b.textContent = String(n);
      b.dataset.level = String(n);
      b.title = n === 1 ? 'Clumsy: slow to react, wide of the mark' : n === 5 ? 'Sharp: quick eyes and a steady aim' : `Skill ${n}`;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.setLevel(n));
      this.levelBtns.push(b);
      levels.append(b);
    }
    this.think.className = 'fa-think';
    this.stats.className = 'fa-count';
    this.root.append(label, row, levels, this.think, this.stats);
  }

  private choose(id: BrainId | 'off'): void {
    const driver = botDriverFor(this.ctx);
    if (id === 'off') driver.off();
    else driver.install(id, this.level);
    this.update(true);
  }

  private setLevel(n: number): void {
    this.level = n;
    const driver = botDriverFor(this.ctx);
    if (driver.active) driver.setLevel(n);
    this.update(true);
  }

  /** Redraw from the driver's state (cheap; the panel calls it a few times a second). */
  update(force = false): void {
    const d = botDriverFor(this.ctx);
    const brain = d.brain;
    const key = brain ? `${brain.id}|${brain.level}|${brain.status.intent}|${brain.status.target}|${brain.status.rule}|${Object.values(brain.status.stats).join(',')}` : `off|${this.level}`;
    if (!force && key === this.last) return;
    this.last = key;
    for (const [id, b] of this.brainBtns) b.classList.toggle('on', brain ? brain.id === id : id === 'off');
    const shown = brain ? brain.level : this.level;
    this.levelBtns.forEach((b, i) => { b.classList.toggle('on', i + 1 === shown); });
    if (!brain) {
      this.think.textContent = 'The keyboard is yours.';
      this.stats.textContent = '';
      return;
    }
    const s = brain.status;
    this.think.textContent = `${s.intent}${s.target !== '-' ? ` → ${s.target}` : ''}${s.rule ? `  ·  ${s.rule}` : ''}`;
    this.stats.textContent = Object.entries(s.stats).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join('  ·  ');
  }
}
