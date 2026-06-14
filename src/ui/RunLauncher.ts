import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { LEVELS } from '@/config/worldgraph';
import type { CardId, Ctx, PerkId, RunLoadoutPreset, RunMode, RunTestKitConfig, RunWorldSource } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { appDialog } from '@/ui/AppDialog';

const PREFS_KEY = 'noita-run-launcher-prefs-v2';

const LEVEL_IDS = Object.values(LEVELS).sort((a, b) => {
  if (a.branch !== b.branch) return a.branch ? 1 : -1;
  return a.depth - b.depth || a.id.localeCompare(b.id);
});

const PERK_CHOICES: Array<{ id: PerkId; name: string }> = [
  { id: 'might', name: 'Might' },
  { id: 'vampirism', name: 'Vampirism' },
  { id: 'featherweight', name: 'Featherweight' },
  { id: 'manafont', name: 'Mana Font' },
  { id: 'swiftfoot', name: 'Swift Foot' },
  { id: 'torchbearer', name: 'Torchbearer' },
  { id: 'ironhide', name: 'Ironhide' },
  { id: 'flameward', name: 'Flame Ward' },
  { id: 'toxinward', name: 'Toxin Ward' },
  { id: 'goldmagnet', name: 'Gold Magnet' },
];

const ADVANCED_CARDS: CardId[] = ['lightning', 'bomb', 'speed', 'heavy', 'bounce', 'trigger'];

type LauncherPrefs = {
  mode?: RunMode;
  world?: RunWorldSource;
  level?: string;
  seed?: string;
  loadout?: RunLoadoutPreset;
  gold?: string;
  maxHp?: string;
  hp?: string;
  maxLevit?: string;
  flaskMaterial?: string;
  flaskCount?: string;
  cards?: CardId[];
  perks?: PerkId[];
};

function optionLabel(id: string): string {
  const level = LEVELS[id];
  return level ? `${level.id.toUpperCase()} - ${level.name}` : id;
}

function parsePrefs(raw: string | null): LauncherPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LauncherPrefs;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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
  private readonly goldInput: HTMLInputElement;
  private readonly maxHpInput: HTMLInputElement;
  private readonly hpInput: HTMLInputElement;
  private readonly maxLevitInput: HTMLInputElement;
  private readonly flaskMaterialSelect: HTMLSelectElement;
  private readonly flaskCountInput: HTMLInputElement;
  private readonly cardChecks: HTMLInputElement[];
  private readonly perkChecks: HTMLInputElement[];
  private readonly kitSection: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private mode: RunMode = 'normal';
  private lastFocused: HTMLElement | null = null;
  private suppressPresetApply = false;

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
              <small>Progression from D1 with autosave</small>
            </button>
            <button type="button" class="run-launcher-choice" data-mode="test">
              <span>Test Run</span>
              <small>Disposable world, level, and kit sandbox</small>
            </button>
          </div>
          <form class="run-launcher-form">
            <div class="run-launcher-form-grid">
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
                <span>Profile</span>
                <select data-field="loadout">
                  <option value="fresh">Fresh starter kit</option>
                  <option value="advanced">Advanced test kit</option>
                  <option value="review">Full review kit</option>
                </select>
              </label>
            </div>
            <section class="run-launcher-kit" data-section="kit" aria-label="Test kit options">
              <div class="run-launcher-kit-grid">
                <label>
                  <span>Gold</span>
                  <input data-field="gold" type="number" min="0" step="1" />
                </label>
                <label>
                  <span>Max HP</span>
                  <input data-field="max-hp" type="number" min="1" step="1" />
                </label>
                <label>
                  <span>Current HP</span>
                  <input data-field="hp" type="number" min="1" step="1" />
                </label>
                <label>
                  <span>Levitation</span>
                  <input data-field="max-levit" type="number" min="1" step="1" />
                </label>
                <label>
                  <span>Flask</span>
                  <select data-field="flask-material"></select>
                </label>
                <label>
                  <span>Flask Cells</span>
                  <input data-field="flask-count" type="number" min="0" max="600" step="1" />
                </label>
              </div>
              <fieldset class="run-launcher-fieldset">
                <legend>Cards</legend>
                <div class="run-launcher-check-grid" data-field="cards"></div>
              </fieldset>
              <fieldset class="run-launcher-fieldset">
                <legend>Perks</legend>
                <div class="run-launcher-check-grid perks" data-field="perks"></div>
              </fieldset>
            </section>
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
    this.goldInput = this.root.querySelector<HTMLInputElement>('[data-field="gold"]')!;
    this.maxHpInput = this.root.querySelector<HTMLInputElement>('[data-field="max-hp"]')!;
    this.hpInput = this.root.querySelector<HTMLInputElement>('[data-field="hp"]')!;
    this.maxLevitInput = this.root.querySelector<HTMLInputElement>('[data-field="max-levit"]')!;
    this.flaskMaterialSelect = this.root.querySelector<HTMLSelectElement>('[data-field="flask-material"]')!;
    this.flaskCountInput = this.root.querySelector<HTMLInputElement>('[data-field="flask-count"]')!;
    this.kitSection = this.root.querySelector<HTMLElement>('[data-section="kit"]')!;
    this.startButton = this.root.querySelector<HTMLButtonElement>('.run-launcher-start')!;
    this.statusEl = this.root.querySelector<HTMLDivElement>('.run-launcher-status')!;

    this.populateLevels();
    this.populateMaterials();
    this.cardChecks = this.populateCards();
    this.perkChecks = this.populatePerks();
    document.body.appendChild(this.root);

    document.getElementById('mode-play-btn')?.addEventListener('click', (e) => {
      if (this.ctx.state.playtestSource === 'builder' || this.builderIsOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.currentTarget as HTMLElement).blur();
      this.ctx.audio.ensure();
      this.open();
    }, true);
    window.addEventListener('run-launcher-request', (event) => {
      if (this.ctx.state.playtestSource === 'builder' || this.builderIsOpen()) return;
      event.preventDefault();
      this.ctx.audio.ensure();
      this.open();
    });

    this.root.querySelector<HTMLButtonElement>('.run-launcher-close')?.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.continueButton.addEventListener('click', () => this.startContinue());
    this.normalButton.addEventListener('click', () => this.setMode('normal'));
    this.testButton.addEventListener('click', () => this.setMode('test'));
    this.worldSelect.addEventListener('change', () => this.sync());
    this.levelSelect.addEventListener('change', () => this.sync());
    this.seedInput.addEventListener('input', () => this.sync());
    this.loadoutSelect.addEventListener('change', () => {
      if (!this.suppressPresetApply) this.applyPresetDefaults(this.loadoutSelect.value as RunLoadoutPreset);
      this.sync();
    });
    for (const input of this.kitInputs()) input.addEventListener('input', () => this.sync());
    for (const input of [...this.cardChecks, ...this.perkChecks]) input.addEventListener('change', () => this.sync());
    this.root.querySelector<HTMLButtonElement>('[data-action="reroll"]')?.addEventListener('click', () => {
      this.seedInput.value = String((Math.random() * 4294967296) >>> 0);
      this.sync();
    });
    this.startButton.addEventListener('click', () => {
      void this.startConfigured();
    });

    this.seedInput.value = String(this.ctx.levels.runStatus(this.ctx).worldSeed >>> 0);
    this.applyPresetDefaults('fresh');
    this.restorePrefs();
    this.sync(false);
  }

  open(): void {
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!this.seedInput.value) this.seedInput.value = String(this.ctx.levels.runStatus(this.ctx).worldSeed >>> 0);
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.sync(false);
    this.startButton.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.lastFocused?.focus({ preventScroll: true });
    this.lastFocused = null;
  }

  private populateLevels(): void {
    for (const level of LEVEL_IDS) {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = optionLabel(level.id);
      this.levelSelect.appendChild(option);
    }
  }

  private builderIsOpen(): boolean {
    return document.body.classList.contains('builder-open');
  }

  private populateMaterials(): void {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Empty flask';
    this.flaskMaterialSelect.appendChild(empty);
    const entries = Object.entries(this.ctx.params.materials)
      .map(([id, def]) => ({ id: Number(id), name: def.name }))
      .filter((entry) => entry.id !== Cell.Empty && Number.isFinite(entry.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = entry.name;
      this.flaskMaterialSelect.appendChild(option);
    }
  }

  private populateCards(): HTMLInputElement[] {
    const host = this.root.querySelector<HTMLDivElement>('[data-field="cards"]')!;
    return ALL_CARD_IDS.map((id) => {
      const label = document.createElement('label');
      label.className = 'run-launcher-check';
      label.innerHTML = `<input type="checkbox" value="${id}" /><span>${CARD_DEFS[id].name}</span>`;
      host.appendChild(label);
      return label.querySelector<HTMLInputElement>('input')!;
    });
  }

  private populatePerks(): HTMLInputElement[] {
    const host = this.root.querySelector<HTMLDivElement>('[data-field="perks"]')!;
    return PERK_CHOICES.map((perk) => {
      const label = document.createElement('label');
      label.className = 'run-launcher-check';
      label.innerHTML = `<input type="checkbox" value="${perk.id}" /><span>${perk.name}</span>`;
      host.appendChild(label);
      return label.querySelector<HTMLInputElement>('input')!;
    });
  }

  private kitInputs(): HTMLInputElement[] {
    return [
      this.goldInput,
      this.maxHpInput,
      this.hpInput,
      this.maxLevitInput,
      this.flaskCountInput,
    ];
  }

  private setMode(mode: RunMode): void {
    this.mode = mode;
    if (mode === 'test' && this.worldSelect.value === 'campaign') {
      this.worldSelect.value = 'campaign-level';
    }
    if (mode === 'normal') {
      this.worldSelect.value = 'campaign';
      this.loadoutSelect.value = 'fresh';
      this.applyPresetDefaults('fresh');
    }
    this.sync();
  }

  private sync(persist = true): void {
    const status = this.ctx.levels.runStatus(this.ctx);
    const canContinue = status.savedExpedition || status.level !== null;
    this.continueButton.disabled = !canContinue;
    this.normalButton.classList.toggle('selected', this.mode === 'normal');
    this.testButton.classList.toggle('selected', this.mode === 'test');

    const testMode = this.mode === 'test';
    const worldSource = this.worldSelect.value as RunWorldSource;
    const virtual = worldSource === 'virtual-world';
    this.worldSelect.disabled = !testMode;
    this.levelSelect.disabled = !testMode || worldSource !== 'campaign-level' || virtual;
    this.loadoutSelect.disabled = !testMode;
    this.kitSection.classList.toggle('disabled', !testMode);
    for (const input of [...this.kitInputs(), this.flaskMaterialSelect, ...this.cardChecks, ...this.perkChecks]) {
      input.disabled = !testMode;
    }
    this.startButton.disabled = false;

    if (testMode && virtual) {
      this.statusEl.textContent = 'Chunked virtual worlds start as disposable materialized test windows; saves stay untouched.';
    } else if (testMode) {
      this.statusEl.textContent = 'Test runs are disposable, can jump to any campaign level, and never overwrite expedition saves.';
    } else if (canContinue) {
      const suffix = status.autosaveBlockReason ? ' Continue will leave the disposable/debug state first.' : '';
      this.statusEl.textContent = `New Expedition starts clean at D1. Continue resumes the current or saved descent.${suffix}`;
    } else {
      this.statusEl.textContent = 'New Expedition starts at D1 with normal progression and autosave.';
    }
    if (persist) this.savePrefs();
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
    this.savePrefs();
    const started = this.ctx.levels.startRun(this.ctx, {
      mode: this.mode,
      worldSource,
      levelId: this.levelSelect.value,
      seed,
      loadout: this.loadoutSelect.value as RunLoadoutPreset,
      kit: this.mode === 'test' ? this.readKit() : undefined,
      continueSave: false,
    });
    this.finish(started.ok, started.message);
  }

  private finish(ok: boolean, message: string): void {
    this.statusEl.textContent = message;
    if (ok) this.close();
  }

  private applyPresetDefaults(preset: RunLoadoutPreset): void {
    const cards = preset === 'review' ? ALL_CARD_IDS : preset === 'advanced' ? ADVANCED_CARDS : [];
    const perks = preset === 'review' ? PERK_CHOICES.map((perk) => perk.id) : [];
    this.goldInput.value = preset === 'review' ? '1000' : preset === 'advanced' ? '250' : '0';
    this.maxHpInput.value = preset === 'review' ? '999' : preset === 'advanced' ? '140' : '100';
    this.hpInput.value = this.maxHpInput.value;
    this.maxLevitInput.value = preset === 'review' ? '400' : preset === 'advanced' ? '125' : '100';
    this.flaskMaterialSelect.value = preset === 'fresh' ? '' : String(Cell.Water);
    this.flaskCountInput.value = preset === 'fresh' ? '0' : preset === 'review' ? '600' : '300';
    this.setChecked(this.cardChecks, cards);
    this.setChecked(this.perkChecks, perks);
  }

  private setChecked<T extends string>(inputs: HTMLInputElement[], selected: T[]): void {
    const values = new Set<string>(selected);
    for (const input of inputs) input.checked = values.has(input.value);
  }

  private checkedValues<T extends string>(inputs: HTMLInputElement[]): T[] {
    return inputs.filter((input) => input.checked).map((input) => input.value as T);
  }

  private readNumber(input: HTMLInputElement): number | undefined {
    const n = Number(input.value);
    return Number.isFinite(n) ? n : undefined;
  }

  private readKit(): RunTestKitConfig {
    const material = this.flaskMaterialSelect.value === '' ? null : Number(this.flaskMaterialSelect.value);
    return {
      gold: this.readNumber(this.goldInput),
      maxHp: this.readNumber(this.maxHpInput),
      hp: this.readNumber(this.hpInput),
      maxLevit: this.readNumber(this.maxLevitInput),
      cards: this.checkedValues<CardId>(this.cardChecks),
      perks: this.checkedValues<PerkId>(this.perkChecks),
      flask: {
        material: material === null || Number.isInteger(material) ? material : null,
        count: this.readNumber(this.flaskCountInput) ?? 0,
      },
    };
  }

  private savePrefs(): void {
    const prefs: LauncherPrefs = {
      mode: this.mode,
      world: this.worldSelect.value as RunWorldSource,
      level: this.levelSelect.value,
      seed: this.seedInput.value,
      loadout: this.loadoutSelect.value as RunLoadoutPreset,
      gold: this.goldInput.value,
      maxHp: this.maxHpInput.value,
      hp: this.hpInput.value,
      maxLevit: this.maxLevitInput.value,
      flaskMaterial: this.flaskMaterialSelect.value,
      flaskCount: this.flaskCountInput.value,
      cards: this.checkedValues<CardId>(this.cardChecks),
      perks: this.checkedValues<PerkId>(this.perkChecks),
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Launcher preferences are convenience only.
    }
  }

  private restorePrefs(): void {
    const prefs = parsePrefs(localStorage.getItem(PREFS_KEY));
    if (!prefs) return;
    this.suppressPresetApply = true;
    if (prefs.mode === 'normal' || prefs.mode === 'test') this.mode = prefs.mode;
    if (prefs.world && ['campaign', 'campaign-level', 'virtual-world'].includes(prefs.world)) {
      this.worldSelect.value = prefs.world;
    }
    if (prefs.level && LEVELS[prefs.level]) this.levelSelect.value = prefs.level;
    if (prefs.seed) this.seedInput.value = prefs.seed;
    if (prefs.loadout && ['fresh', 'advanced', 'review'].includes(prefs.loadout)) {
      this.loadoutSelect.value = prefs.loadout;
    }
    for (const [input, value] of [
      [this.goldInput, prefs.gold],
      [this.maxHpInput, prefs.maxHp],
      [this.hpInput, prefs.hp],
      [this.maxLevitInput, prefs.maxLevit],
      [this.flaskCountInput, prefs.flaskCount],
    ] as Array<[HTMLInputElement, string | undefined]>) {
      if (value !== undefined) input.value = value;
    }
    if (prefs.flaskMaterial !== undefined) this.flaskMaterialSelect.value = prefs.flaskMaterial;
    if (prefs.cards) this.setChecked(this.cardChecks, prefs.cards);
    if (prefs.perks) this.setChecked(this.perkChecks, prefs.perks);
    if (this.mode === 'normal') {
      this.worldSelect.value = 'campaign';
      this.loadoutSelect.value = 'fresh';
    }
    this.suppressPresetApply = false;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.code !== 'Tab') return;
    const focusables = this.focusableControls();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private focusableControls(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }
}
