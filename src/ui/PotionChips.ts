import '@/styles/alchemy.css';
import { activePotions, POTION_CAP_FRAMES } from '@/content/elixirs';
import type { Ctx } from '@/core/types';

/** Under this many seconds left a chip blinks (it is about to run out). */
const FADING_SECONDS = 6;

interface Chip {
  el: HTMLElement;
  time: HTMLElement;
  bar: HTMLElement;
  seconds: number;
}

/**
 * POTION CHIPS: what you are, and for how long. One chip per working potion in the empty
 * `#vitals-aside` under the vitals: its label in its tint, the seconds left counting down,
 * and a thin bar of how much of the cup is left. A readout only: the Hud calls `update`
 * with the HUD cadence (~30 Hz); it reads `player.status`, so a loot potion, a brewed
 * elixir and the Sanctum's brew all show the same way. Touches the DOM only when a
 * chip appears, goes, or its whole seconds change.
 */
export class PotionChips {
  private readonly host: HTMLElement;
  private readonly chips = new Map<string, Chip>();

  constructor(private readonly ctx: Ctx, aside: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'potion-chips';
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-label', 'Active potions');
    aside.appendChild(this.host);
  }

  update(): void {
    const live = activePotions(this.ctx.player.status);
    const seen = new Set<string>();
    for (const { def, frames } of live) {
      const key = def.effect.key;
      seen.add(key);
      const seconds = Math.ceil(frames / 60);
      let chip = this.chips.get(key);
      if (!chip) {
        const el = document.createElement('div');
        el.className = 'potion-chip';
        el.style.setProperty('--chip-tint', def.chip.tint);
        el.dataset.potion = key;
        const label = document.createElement('span');
        label.className = 'pc-label';
        label.textContent = def.chip.label;
        const time = document.createElement('span');
        time.className = 'pc-time';
        const bar = document.createElement('span');
        bar.className = 'pc-bar';
        const fill = document.createElement('i');
        bar.appendChild(fill);
        el.append(label, document.createElement('span'), time, bar);
        this.host.appendChild(el);
        chip = { el, time, bar: fill, seconds: -1 };
        this.chips.set(key, chip);
      }
      if (chip.seconds !== seconds) {
        chip.seconds = seconds;
        chip.time.textContent = `${seconds}s`;
        chip.el.classList.toggle('fading', seconds <= FADING_SECONDS);
        chip.el.setAttribute('aria-label', `${def.chip.label}, ${seconds} seconds left`);
      }
      chip.bar.style.width = `${Math.min(100, (frames / POTION_CAP_FRAMES) * 100).toFixed(1)}%`;
    }
    for (const [key, chip] of this.chips) {
      if (seen.has(key)) continue;
      chip.el.remove();
      this.chips.delete(key);
    }
  }

  dispose(): void {
    this.chips.clear();
    this.host.remove();
  }
}
