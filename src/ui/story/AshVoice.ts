import type { Ctx } from '@/core/types';
import { SPEAKER_NAMES } from '@/content/story/types';
import { ASH_FIGURES_STYLE, createAshFigures, type AshFigures } from './ashFigures';

const STYLE = `
.sanc-ash {
  position: relative; display: grid; gap: 6px; padding: 12px 16px 12px 18px; border-left: 2px solid #d5b982aa;
  background: linear-gradient(90deg, #1a2d2a99, #0000); opacity: 0; transform: translateY(4px);
  transition: opacity 0.45s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.sanc-ash[hidden] { display: none; }
.sanc-ash.show { opacity: 1; transform: none; }
.sanc-ash .sa-name {
  font: 650 calc(10.5px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--house-brass, #d5b982);
}
.sanc-ash .sa-name span { color: #9fb0a6; letter-spacing: 0.12em; margin-left: 8px; }
.sanc-ash .sa-line { margin: 0; font: italic 500 calc(17px * var(--text-scale, 1))/1.45 var(--house-serif, Georgia, serif); color: var(--house-paper, #e6dfca); max-width: 62ch; }
.sanc-ash .sa-line .sa-rest { opacity: 0; }
.sanc-ash .sa-spores { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sanc-ash .sa-spores i {
  position: absolute; bottom: -4px; width: 3px; height: 3px; border-radius: 50%; background: #b8e6c8; opacity: 0;
  animation: sa-spore 5s ease-in infinite;
}
@keyframes sa-spore { 10% { opacity: 0.55; } 100% { transform: translate(14px, -70px); opacity: 0; } }
body.reduce-flashes .sanc-ash .sa-spores { display: none; }
`;

/**
 * MATRON ASH in the Sanctum (wave 3 WS-S): the Old Ones' voice between floors.
 * Her lines are spoken by the narrator (her own recording, doubled offline
 * into a faint chorus); this shows them in the Sanctum itself — a name plate
 * and the words typing on in step with her voice, a few spores drifting up,
 * and the three of them seated beside it (ashFigures: she leans while she
 * speaks; one nods at a boon, one lifts a hand as the phial is poured).
 */
export class AshVoice {
  private readonly style = document.createElement('style');
  private readonly root = document.createElement('section');
  private readonly line = document.createElement('p');
  private readonly off: Array<() => void> = [];
  private observer: MutationObserver | null = null;
  private text = '';
  private startedAt = 0;
  private seconds = 1;
  private raf: number | null = null;
  private readonly figures: AshFigures;
  private readonly onPick = (): void => this.figures.nod();
  private readonly onPour = (): void => this.figures.pour();
  /** A click or a key in the Sanctum finishes the line being typed (her voice goes on; the words are all there). */
  private readonly onSkip = (): void => {
    if (!this.text || performance.now() - this.startedAt >= this.seconds * 900) return;
    this.startedAt = performance.now() - this.seconds * 900;
    this.frame();
  };

  constructor(ctx: Ctx) {
    this.style.textContent = STYLE + ASH_FIGURES_STYLE;
    document.head.appendChild(this.style);
    this.root.className = 'sanc-ash';
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    const name = document.createElement('div');
    name.className = 'sa-name';
    name.innerHTML = `${SPEAKER_NAMES.ash}<span>of the Old Ones</span>`;
    this.line.className = 'sa-line';
    const spores = document.createElement('div');
    spores.className = 'sa-spores';
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('i');
      s.style.left = `${8 + i * 13}%`;
      s.style.animationDelay = `${(i * 0.73) % 5}s`;
      spores.appendChild(s);
    }
    this.figures = createAshFigures(this.root);
    this.root.append(spores, name, this.line, this.figures.root);
    const overlay = document.getElementById('sanctum-overlay');
    overlay?.querySelector('.sanc-body')?.prepend(this.root);
    if (overlay) {
      this.observer = new MutationObserver(() => { if (!overlay.classList.contains('visible')) this.clear(); });
      this.observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
      overlay.addEventListener('pointerdown', this.onSkip, true);
      window.addEventListener('keydown', this.onSkip, true);
      overlay.addEventListener('sanctum-pick', this.onPick);
      overlay.addEventListener('sanctum-pour', this.onPour);
    }
    this.off.push(ctx.events.on('narration', ({ text, seconds, speaker }) => {
      if (speaker !== 'ash') return;
      this.text = text;
      this.seconds = Math.max(0.8, seconds);
      this.startedAt = performance.now();
      this.figures.talk(true);
      this.root.hidden = false;
      requestAnimationFrame(() => this.root.classList.add('show'));
      if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
    }));
  }

  private clear(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
    this.text = '';
    this.figures.talk(false);
  }

  private readonly frame = (): void => {
    const k = Math.min(1, (performance.now() - this.startedAt) / (this.seconds * 900));
    const n = Math.floor(this.text.length * k);
    const shown = document.createElement('span');
    shown.textContent = this.text.slice(0, n);
    const rest = document.createElement('span');
    rest.className = 'sa-rest';
    rest.textContent = this.text.slice(n);
    this.line.replaceChildren(shown, rest);
    this.raf = k < 1 && this.text ? requestAnimationFrame(this.frame) : null;
    if (k >= 1) this.figures.talk(false);
  };

  dispose(): void {
    for (const d of this.off.splice(0)) d();
    this.observer?.disconnect();
    document.getElementById('sanctum-overlay')?.removeEventListener('pointerdown', this.onSkip, true);
    document.getElementById('sanctum-overlay')?.removeEventListener('sanctum-pick', this.onPick);
    document.getElementById('sanctum-overlay')?.removeEventListener('sanctum-pour', this.onPour);
    window.removeEventListener('keydown', this.onSkip, true);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.root.remove();
    this.style.remove();
  }
}
