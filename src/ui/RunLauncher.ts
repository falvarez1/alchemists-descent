import { LEVELS } from '@/config/worldgraph';
import type { Ctx, RunLoadoutPreset, RunMode, RunWorldSource } from '@/core/types';
import { appDialog } from '@/ui/AppDialog';

const LEVEL_IDS = Object.values(LEVELS).sort((a, b) => {
  if (a.branch !== b.branch) return a.branch ? 1 : -1;
  return a.depth - b.depth || a.id.localeCompare(b.id);
});

function optionLabel(id: string): string {
  const level = LEVELS[id];
  return level ? `${level.id.toUpperCase()} - ${level.name}` : id;
}

export class RunLauncher {
  private readonly root: HTMLDivElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly normalButton: HTMLButtonElement;
  private readonly testButton: HTMLButtonElement;
  private readonly worldSelect: HTMLSelectElement;
  private readonly levelSelect: HTMLSelectElement;
  private readonly seedInput: HTMLInputElement;
  private readonly loadoutSelect: HTMLSelectElement;
  private readonly startButton: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private mode: RunMode = 'normal';

  constructor(private readonly ctx: Ctx) {
    this.root = document.createElement('div');
    this.root.id = 'run-launcher';
    this.root.className = 'run-launcher';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="run-launcher-panel" role="dialog" aria-modal="true" aria-labelledby="run-launcher-title">
        <div class="run-launcher-head">
          <div>
            <div id="run-launcher-title" class="run-launcher-title">Start Run</div>
            <div class="run-launcher-subtitle">Expedition launcher</div>
          </div>
          <button type="button" class="run-launcher-close" aria-label="Close run launcher">&times;</button>
        </div>
        <div class="run-launcher-body">
          <div class="run-launcher-column">
            <button type="button" class="run-launcher-choice" data-action="continue">
              <span>Continue</span>
              <small>Resume current or saved expedition</small>
            </button>
            <button type="button" class="run-launcher-choice selected" data-mode="normal">
              <span>New Expedition</span>
              <small>Start progression from the beginning</small>
            </button>
            <button type="button" class="run-launcher-choice" data-mode="test">
              <span>Test Run</span>
              <small>Disposable world, level, and loadout sandbox</small>
            </button>
          </div>
          <form class="run-launcher-form">
            <label>
              <span>World</span>
              <select data-field="world">
                <option value="campaign">Current campaign generator</option>
                <option value="campaign-level">Current generator, selected level</option>
                <option value="virtual-world">Chunked virtual world</option>
              </select>
            </label>
            <label>
              <span>Level</span>
              <select data-field="level"></select>
            </label>
            <label>
              <span>Seed</span>
              <div class="run-launcher-seed">
                <input data-field="seed" inputmode="numeric" spellcheck="false" />
                <button type="button" data-action="reroll">REROLL</button>
              </div>
            </label>
            <label>
              <span>Loadout</span>
              <select data-field="loadout">
                <option value="fresh">Fresh starter kit</option>
                <option value="advanced">Advanced test kit</option>
                <option value="review">Full review kit</option>
              </select>
            </label>
          </form>
        </div>
        <div class="run-launcher-foot">
          <div class="run-launcher-status" aria-live="polite"></div>
          <button type="button" class="run-launcher-start">START</button>
        </div>
      </div>
    `;

    this.continueButton = this.root.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    this.normalButton = this.root.querySelector<HTMLButtonElement>('[data-mode="normal"]')!;
    this.testButton = this.root.querySelector<HTMLButtonElement>('[data-mode="test"]')!;
    this.worldSelect = this.root.querySelector<HTMLSelectElement>('[data-field="world"]')!;
    this.levelSelect = this.root.querySelector<HTMLSelectElement>('[data-field="level"]')!;
    this.seedInput = this.root.querySelector<HTMLInputElement>('[data-field="seed"]')!;
    this.loadoutSelect = this.root.querySelector<HTMLSelectElement>('[data-field="loadout"]')!;
    this.startButton = this.root.querySelector<HTMLButtonElement>('.run-launcher-start')!;
    this.statusEl = this.root.querySelector<HTMLDivElement>('.run-launcher-status')!;

    for (const level of LEVEL_IDS) {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = optionLabel(level.id);
      this.levelSelect.appendChild(option);
    }
    document.body.appendChild(this.root);

    document.getElementById('mode-play-btn')?.addEventListener('click', (e) => {
      if (this.ctx.state.playtestSource === 'builder') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.currentTarget as HTMLElement).blur();
      this.ctx.audio.ensure();
      this.open();
    }, true);

    this.root.querySelector<HTMLButtonElement>('.run-launcher-close')?.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.continueButton.addEventListener('click', () => this.startContinue());
    this.normalButton.addEventListener('click', () => this.setMode('normal'));
    this.testButton.addEventListener('click', () => this.setMode('test'));
    this.worldSelect.addEventListener('change', () => this.sync());
    this.loadoutSelect.addEventListener('change', () => this.sync());
    this.root.querySelector<HTMLButtonElement>('[data-action="reroll"]')?.addEventListener('click', () => {
      this.seedInput.value = String((Math.random() * 4294967296) >>> 0);
    });
    this.startButton.addEventListener('click', () => {
      void this.startConfigured();
    });
    this.seedInput.value = String(this.ctx.levels.runStatus(this.ctx).worldSeed >>> 0);
    this.sync();
  }

  open(): void {
    this.seedInput.value = String(this.ctx.levels.runStatus(this.ctx).worldSeed >>> 0);
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.sync();
    this.startButton.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
  }

  private setMode(mode: RunMode): void {
    this.mode = mode;
    if (mode === 'test' && this.worldSelect.value === 'campaign') {
      this.worldSelect.value = 'campaign-level';
    }
    if (mode === 'normal') {
      this.worldSelect.value = 'campaign';
      this.loadoutSelect.value = 'fresh';
    }
    this.sync();
  }

  private sync(): void {
    const status = this.ctx.levels.runStatus(this.ctx);
    const canContinue = status.savedExpedition || status.level !== null;
    this.continueButton.disabled = !canContinue;
    this.normalButton.classList.toggle('selected', this.mode === 'normal');
    this.testButton.classList.toggle('selected', this.mode === 'test');

    const worldSource = this.worldSelect.value as RunWorldSource;
    const virtual = worldSource === 'virtual-world';
    const selectedLevel = worldSource === 'campaign-level' || this.mode === 'test';
    this.levelSelect.disabled = !selectedLevel || virtual;
    this.loadoutSelect.disabled = this.mode === 'normal';
    this.startButton.disabled = virtual;
    if (virtual) {
      this.statusEl.textContent = 'Chunked virtual worlds are preview-only until runtime materialization lands.';
    } else if (this.mode === 'test') {
      this.statusEl.textContent = 'Test runs are disposable and never overwrite expedition saves.';
    } else {
      this.statusEl.textContent = canContinue ? 'Continue resumes your current or saved descent.' : 'New expedition starts at D1.';
    }
  }

  private startContinue(): void {
    const started = this.ctx.levels.startRun(this.ctx, {
      mode: 'normal',
      worldSource: 'campaign',
      continueSave: true,
    });
    this.finish(started.ok, started.message);
  }

  private async startConfigured(): Promise<void> {
    const worldSource = this.worldSelect.value as RunWorldSource;
    const seed = Number(this.seedInput.value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      this.statusEl.textContent = 'Seed must be an integer from 0 to 4294967295.';
      return;
    }
    if (this.mode === 'normal' && this.ctx.levels.runStatus(this.ctx).savedExpedition) {
      const ok = await appDialog.confirm('Start a new expedition and abandon the saved one?', {
        title: 'New Expedition',
        confirmText: 'Start New',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const started = this.ctx.levels.startRun(this.ctx, {
      mode: this.mode,
      worldSource,
      levelId: this.levelSelect.value,
      seed,
      loadout: this.loadoutSelect.value as RunLoadoutPreset,
      continueSave: false,
    });
    this.finish(started.ok, started.message);
  }

  private finish(ok: boolean, message: string): void {
    this.statusEl.textContent = message;
    if (ok) this.close();
  }
}
