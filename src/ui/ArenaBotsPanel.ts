import { BRAIN_BLURBS, BRAIN_IDS } from '@/arena/ai';
import type { BrainId } from '@/arena/ai';
import { botDriverFor, rivalDriverFor, type BotDriver } from '@/arena/ai/driver';
import type { Ctx } from '@/core/types';
import { AI_DIFFICULTIES } from '@/config/aiTiers';
import { PERSONALITY_IDS, isPersonality } from '@/config/aiPersonalities';

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
  private readonly personality = document.createElement('select');
  private readonly scores = document.createElement('div');
  private level = 3;
  private last = '';

  /** `slot` 0 is the fighter you hold (the keyboard is the "You" choice); a rival's brain can be a brain or nothing. */
  constructor(private readonly ctx: Ctx, private readonly slot = 0, title = 'At the controls') {
    this.root.className = 'fa-section fa-bots';
    const label = document.createElement('div');
    label.className = 'fa-label';
    label.textContent = title;
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
    make('off', slot === 0 ? 'You' : 'Still', slot === 0 ? 'The keyboard and mouse are yours' : 'No brain: the rival stands where it is');
    for (const id of BRAIN_IDS) make(id, id, BRAIN_BLURBS[id]);
    const levels = document.createElement('div');
    levels.className = 'fa-buttons fa-levels';
    const lv = document.createElement('span');
    lv.className = 'fa-bar-label';
    lv.textContent = 'Skill';
    levels.append(lv);
    for (const [name, n] of Object.entries(AI_DIFFICULTIES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fa-btn fa-level';
      b.textContent = name[0].toUpperCase() + name.slice(1);
      b.dataset.level = String(n);
      b.title = n === 1 ? 'Clumsy: slow to react, wide of the mark' : n === 5 ? 'Sharp: quick eyes and a steady aim' : `Skill ${n}`;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.setLevel(n));
      this.levelBtns.push(b);
      levels.append(b);
    }
    this.think.className = 'fa-think';
    this.stats.className = 'fa-count';
    this.personality.className = 'fa-select';
    this.personality.setAttribute('aria-label', `Slot ${slot} personality`);
    for (const id of PERSONALITY_IDS) {
      const option = document.createElement('option'); option.value = id; option.textContent = id;
      this.personality.append(option);
    }
    this.personality.value = 'duelist';
    this.personality.addEventListener('change', () => {
      if (isPersonality(this.personality.value)) this.driver()?.setPersonality(this.personality.value);
      this.update(true);
    });
    this.scores.className = 'fa-count';
    this.root.append(label, row, levels, this.personality, this.think, this.scores, this.stats);
  }

  private driver(): BotDriver | null {
    return this.slot === 0 ? botDriverFor(this.ctx) : rivalDriverFor(this.ctx, this.slot);
  }

  private choose(id: BrainId | 'off'): void {
    const driver = this.driver();
    if (!driver) return;
    if (id === 'off') driver.off();
    else driver.install(id, this.level);
    this.update(true);
  }

  private setLevel(n: number): void {
    this.level = n;
    const driver = this.driver();
    if (driver?.active) driver.setLevel(n);
    this.update(true);
  }

  /** Redraw from the driver's state (cheap; the panel calls it a few times a second). */
  update(force = false): void {
    const d = this.driver();
    const brain = d?.brain ?? null;
    const key = brain ? `${brain.id}|${brain.level}|${brain.personality}|${brain.status.intent}|${brain.status.target}|${brain.status.rule}|${Object.values(brain.status.stats).join(',')}` : `off|${this.level}`;
    if (!force && key === this.last) return;
    this.last = key;
    for (const [id, b] of this.brainBtns) b.classList.toggle('on', brain ? brain.id === id : id === 'off');
    const shown = brain ? brain.level : this.level;
    this.levelBtns.forEach(b => { b.classList.toggle('on', Number(b.dataset.level) === shown); });
    if (!brain) {
      this.think.textContent = this.slot === 0 ? 'The keyboard is yours.' : d === null ? 'No rival.' : 'No brain: it stands still.';
      this.stats.textContent = '';
      this.scores.textContent = '';
      return;
    }
    const s = brain.status;
    this.personality.value = brain.personality;
    this.think.textContent = `${s.intent}${s.target !== '-' ? ` → ${s.target}` : ''}${s.rule ? `  ·  ${s.rule}` : ''}`;
    this.scores.textContent = (s.scores ?? []).slice(0, 3).map(r => `${r.action} ${r.total.toFixed(2)}`).join(' · ');
    this.scores.title = (s.scores ?? []).map(r => `${r.action}: ${Object.entries(r.terms).map(([k, n]) => `${k} ${n.toFixed(2)}`).join(', ')}`).join('\n');
    this.stats.textContent = Object.entries(s.stats).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${Math.round(v)}`).join('  ·  ');
  }
}
