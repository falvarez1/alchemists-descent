import '@/styles/fighter-hud.css';
import { FIGHTER_DEFS } from '@/content/fighters';
import type { AbilitySlot, AbilityView } from '@/core/fighters';
import type { Ctx } from '@/core/types';
import { getBindings, keyLabel } from '@/input/bindings';
import { chipIcon } from '@/ui/fighterChipIcons';

/**
 * THE FIGHTER'S TWO CHIPS (docs/FIGHTERS.md "Controls and HUD"): the tactical ability (Z) and the
 * ultimate (T) under the flask belt, in the game's own plain HUD voice. Each chip is a real button (so a
 * pointer or a touch can press it) with the ability's glyph, its key, a dark wedge sweeping off while it
 * cools and, for the ultimate, a ring that fills as the bar charges and a glow when it is ready. A thin
 * bar above shows an armor pool, and a kit's own meter (Pressure) sits under the names.
 *
 * Presentation only: it reads `ctx.fighters.view` and presses through `ctx.fighters.press`; nothing here
 * decides anything. It draws nothing at all for the classic Alchemist.
 */
export class FighterChips {
  private readonly root = document.createElement('div');
  private readonly armorBar = document.createElement('div');
  private readonly armorFill = document.createElement('i');
  private readonly chips: Record<AbilitySlot, HTMLButtonElement>;
  private readonly cd: Record<AbilitySlot, HTMLElement>;
  private readonly names: Record<AbilitySlot, HTMLElement>;
  private readonly meter = document.createElement('div');
  private readonly meterFill = document.createElement('i');
  private readonly meterLabel = document.createElement('span');
  private raf = 0;
  private equipped: string | null = null;
  private last = { used: { tactical: -1, ultimate: -1 }, refused: { tactical: -1, ultimate: -1 }, ready: -1 };
  private bound = '';

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'fighter-chips';
    this.root.hidden = true;
    this.armorBar.className = 'fc-armor';
    this.armorBar.append(this.armorFill);
    const row = document.createElement('div');
    row.className = 'fc-row';
    this.chips = { tactical: this.makeChip('tactical'), ultimate: this.makeChip('ultimate') };
    this.cd = {
      tactical: this.chips.tactical.querySelector('.fc-cd') as HTMLElement,
      ultimate: this.chips.ultimate.querySelector('.fc-cd') as HTMLElement,
    };
    row.append(this.chips.tactical, this.chips.ultimate);
    const names = document.createElement('div');
    names.className = 'fc-names';
    this.names = { tactical: document.createElement('span'), ultimate: document.createElement('span') };
    names.append(this.names.tactical, this.names.ultimate);
    this.meter.className = 'fc-meter';
    this.meter.hidden = true;
    this.meter.append(this.meterLabel, this.meterFill);
    this.root.append(this.armorBar, row, names, this.meter);
    // Under the flask belt, in the same corner stack (it inherits the HUD size and opacity options).
    const tools = document.getElementById('expedition-tools');
    (tools ?? document.getElementById('game-hud') ?? document.body).append(this.root);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  private makeChip(slot: AbilitySlot): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `fc-chip fc-${slot}`;
    b.dataset.slot = slot;
    b.innerHTML = '<span class="fc-icon"></span><kbd class="fc-key"></kbd><span class="fc-cd"></span><i class="fc-ring"></i>';
    b.addEventListener('click', () => {
      this.ctx.fighters?.press(slot);
      b.blur(); // a focused button would eat Space and Enter mid-play
    });
    return b;
  }

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop);
    const f = this.ctx.fighters;
    const id = f?.id ?? null;
    const show = id !== null && this.ctx.state.mode === 'play' && !this.ctx.player.dead;
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!f || !show || id === null) return;
    if (this.equipped !== id) this.equip(id);
    const view = f.view;
    this.paint('tactical', view.tactical);
    this.paint('ultimate', view.ultimate);
    this.bindKeys();
    const armor = view.armorMax > 0 ? view.armor / view.armorMax : -1;
    this.armorBar.hidden = armor < 0;
    if (armor >= 0) this.armorFill.style.setProperty('--v', armor.toFixed(3));
    const m = view.meter;
    this.meter.hidden = m === null;
    if (m) {
      this.meterLabel.textContent = m.label;
      this.meterFill.style.setProperty('--v', (m.max > 0 ? Math.min(1, m.value / m.max) : 0).toFixed(3));
    }
  }

  private equip(id: NonNullable<Ctx['fighters']>['id'] & string): void {
    this.equipped = id;
    const def = FIGHTER_DEFS[id];
    this.root.style.setProperty('--fc-accent', def.accent);
    for (const slot of ['tactical', 'ultimate'] as const) {
      this.chips[slot].querySelector('.fc-icon')!.innerHTML = chipIcon(id, slot);
      const copy = def[slot];
      this.chips[slot].setAttribute('aria-label', `${copy.name}: ${copy.description}`);
      this.chips[slot].title = `${copy.name}: ${copy.description}`;
      this.names[slot].textContent = copy.name;
    }
    this.bound = '';
    this.last = { used: { tactical: -1, ultimate: -1 }, refused: { tactical: -1, ultimate: -1 }, ready: -1 };
  }

  /** The key labels follow the player's own bindings. */
  private bindKeys(): void {
    const b = getBindings();
    const sig = b.tactical + b.ultimate;
    if (sig === this.bound) return;
    this.bound = sig;
    this.chips.tactical.querySelector('.fc-key')!.textContent = keyLabel(b.tactical);
    this.chips.ultimate.querySelector('.fc-key')!.textContent = keyLabel(b.ultimate);
  }

  private paint(slot: AbilitySlot, a: AbilityView): void {
    const chip = this.chips[slot];
    const calm = this.ctx.state.reduceFlashes === true;
    chip.classList.toggle('ready', a.ready);
    chip.classList.toggle('active', a.active > 0);
    chip.style.setProperty('--cool', a.cooldown.toFixed(3));
    chip.style.setProperty('--charge', (slot === 'ultimate' ? (a.active > 0 ? a.active : a.charge) : 1).toFixed(3));
    const text = slot === 'tactical' ? (a.cooldownSeconds > 0 ? String(a.cooldownSeconds) : '') : a.active > 0 ? '' : a.charge >= 1 ? '' : `${Math.floor(a.charge * 100)}`;
    if (this.cd[slot].textContent !== text) this.cd[slot].textContent = text;
    // One-shot flourishes, keyed off the frame the system recorded.
    if (a.usedAt !== this.last.used[slot]) {
      if (this.last.used[slot] !== -1 && !calm) this.flourish(chip, 'used');
      this.last.used[slot] = a.usedAt;
    }
    if (a.refusedAt !== this.last.refused[slot]) {
      if (this.last.refused[slot] !== -1 && !calm) this.flourish(chip, 'refused');
      this.last.refused[slot] = a.refusedAt;
    }
    if (slot === 'ultimate' && a.readyAt !== this.last.ready) {
      if (this.last.ready !== -1 && !calm) this.flourish(chip, 'primed');
      this.last.ready = a.readyAt;
    }
  }

  private flourish(chip: HTMLElement, kind: 'used' | 'refused' | 'primed'): void {
    chip.classList.remove('fc-used', 'fc-refused', 'fc-primed');
    void chip.offsetWidth; // restart the animation
    chip.classList.add(`fc-${kind}`);
  }
}
