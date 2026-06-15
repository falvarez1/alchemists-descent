import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { LEVELS } from '@/config/worldgraph';
import { FLASK_SLOT_COUNT, type CardId, type Ctx, type FlaskSlotConfig, type PerkId, type RunLoadoutPreset, type RunMode, type RunStatus, type RunTestKitConfig, type RunWorldSource } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { appDialog } from '@/ui/AppDialog';

const PREFS_KEY = 'noita-run-launcher-prefs-v3';
const LEGACY_PREFS_KEY = 'noita-run-launcher-prefs-v2';

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
const KIT_TABS = ['vitals', 'cards', 'perks', 'flask'] as const;

type LauncherSource = 'play-button' | 'tab' | 'fullscreen';
type KitTab = (typeof KIT_TABS)[number];
type CardFilter = 'all' | 'projectile' | 'modifier' | 'multicast';

type TestPrefs = {
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
  flasks?: FlaskSlotConfig[];
  activeFlaskIndex?: number;
  cards?: CardId[];
  perks?: PerkId[];
  cardFilter?: CardFilter;
  cardSearch?: string;
  kitTab?: KitTab;
};

type LauncherPrefs = {
  mode?: RunMode;
  normal?: { seed?: string };
  test?: TestPrefs;
};

type LegacyLauncherPrefs = TestPrefs & {
  mode?: RunMode;
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

function parseLegacyPrefs(raw: string | null): LauncherPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LegacyLauncherPrefs;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      mode: parsed.mode,
      normal: { seed: parsed.mode === 'normal' ? parsed.seed : undefined },
      test: {
        world: parsed.world,
        level: parsed.level,
        seed: parsed.mode === 'test' ? parsed.seed : undefined,
        loadout: parsed.loadout,
        gold: parsed.gold,
        maxHp: parsed.maxHp,
        hp: parsed.hp,
        maxLevit: parsed.maxLevit,
        flaskMaterial: parsed.flaskMaterial,
        flaskCount: parsed.flaskCount,
        flasks: parsed.flaskMaterial
          ? [{ material: Number(parsed.flaskMaterial), count: Number(parsed.flaskCount ?? 0) }]
          : undefined,
        cards: parsed.cards,
        perks: parsed.perks,
      },
    };
  } catch {
    return null;
  }
}

function validRunMode(mode: unknown): mode is RunMode {
  return mode === 'normal' || mode === 'test';
}

function validWorldSource(world: unknown): world is RunWorldSource {
  return world === 'campaign' || world === 'campaign-level' || world === 'virtual-world';
}

function validLoadout(loadout: unknown): loadout is RunLoadoutPreset {
  return loadout === 'fresh' || loadout === 'advanced' || loadout === 'review';
}

function validKitTab(tab: unknown): tab is KitTab {
  return KIT_TABS.includes(tab as KitTab);
}

function validCardFilter(filter: unknown): filter is CardFilter {
  return filter === 'all' || filter === 'projectile' || filter === 'modifier' || filter === 'multicast';
}

export class RunLauncher {
  private readonly root: HTMLDivElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly normalButton: HTMLButtonElement;
  private readonly testButton: HTMLButtonElement;
  private readonly normalSummary: HTMLElement;
  private readonly testFieldsSection: HTMLElement;
  private readonly worldSelect: HTMLSelectElement;
  private readonly levelSelect: HTMLSelectElement;
  private readonly seedInput: HTMLInputElement;
  private readonly loadoutSelect: HTMLSelectElement;
  private readonly goldInput: HTMLInputElement;
  private readonly maxHpInput: HTMLInputElement;
  private readonly hpInput: HTMLInputElement;
  private readonly maxLevitInput: HTMLInputElement;
  private readonly flaskSlotButtons: HTMLButtonElement[];
  private readonly flaskSummary: HTMLElement;
  private readonly flaskEmptyButton: HTMLButtonElement;
  private readonly flaskRows: HTMLElement[];
  private readonly flaskRadios: HTMLInputElement[];
  private readonly flaskSliders: HTMLInputElement[];
  private readonly flaskOutputs: HTMLOutputElement[];
  private readonly cardFilterSelect: HTMLSelectElement;
  private readonly cardSearchInput: HTMLInputElement;
  private readonly cardChecks: HTMLInputElement[];
  private readonly perkChecks: HTMLInputElement[];
  private readonly kitSection: HTMLElement;
  private readonly kitTabButtons: HTMLButtonElement[];
  private readonly kitPanels: HTMLElement[];
  private readonly startButton: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private mode: RunMode = 'normal';
  private activeKitTab: KitTab = 'vitals';
  private activeFlaskSlot = 0;
  private readonly flaskSlotConfigs: FlaskSlotConfig[] = Array.from({ length: FLASK_SLOT_COUNT }, () => ({
    material: null,
    count: 0,
  }));
  private lastFocused: HTMLElement | null = null;
  private pendingSource: LauncherSource = 'play-button';
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
              <span>Continue Expedition</span>
              <small>Resume a clean current or saved descent</small>
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
              <label data-field-wrap="seed">
                <span>Seed</span>
                <div class="run-launcher-seed">
                  <input data-field="seed" inputmode="numeric" spellcheck="false" />
                  <button type="button" data-action="reroll">REROLL</button>
                </div>
              </label>
            </div>
            <div class="run-launcher-normal-summary" data-section="normal-summary">
              <strong>New Expedition</strong>
              <span>D1 start, fresh starter kit, normal progression, autosave enabled.</span>
            </div>
            <section class="run-launcher-test-fields" data-section="test-fields" aria-label="Test run setup">
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
                  <span>Profile</span>
                  <select data-field="loadout">
                    <option value="fresh">Fresh starter kit</option>
                    <option value="advanced">Advanced test kit</option>
                    <option value="review">Full review kit</option>
                  </select>
                </label>
              </div>
              <section class="run-launcher-kit" data-section="kit" aria-label="Test kit options">
                <div class="run-launcher-kit-tabs" role="tablist" aria-label="Test kit sections">
                  <button type="button" data-kit-tab="vitals" role="tab" aria-selected="true">Vitals</button>
                  <button type="button" data-kit-tab="cards" role="tab" aria-selected="false">Cards</button>
                  <button type="button" data-kit-tab="perks" role="tab" aria-selected="false">Perks</button>
                  <button type="button" data-kit-tab="flask" role="tab" aria-selected="false">Flask</button>
                </div>
                <div class="run-launcher-kit-panel active" data-kit-panel="vitals" role="tabpanel">
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
                  </div>
                </div>
                <div class="run-launcher-kit-panel" data-kit-panel="cards" role="tabpanel">
                  <div class="run-launcher-kit-tools">
                    <label>
                      <span>Type</span>
                      <select data-field="card-filter">
                        <option value="all">All cards</option>
                        <option value="projectile">Projectiles</option>
                        <option value="modifier">Modifiers</option>
                        <option value="multicast">Multicast</option>
                      </select>
                    </label>
                    <label>
                      <span>Search</span>
                      <input data-field="card-search" spellcheck="false" />
                    </label>
                    <div class="run-launcher-inline-actions">
                      <button type="button" data-action="cards-all">ALL</button>
                      <button type="button" data-action="cards-clear">CLEAR</button>
                    </div>
                  </div>
                  <div class="run-launcher-check-grid cards" data-field="cards"></div>
                </div>
                <div class="run-launcher-kit-panel" data-kit-panel="perks" role="tabpanel">
                  <div class="run-launcher-inline-actions right">
                    <button type="button" data-action="perks-all">ALL</button>
                    <button type="button" data-action="perks-clear">CLEAR</button>
                  </div>
                  <div class="run-launcher-check-grid perks" data-field="perks"></div>
                </div>
                <div class="run-launcher-kit-panel" data-kit-panel="flask" role="tabpanel">
                  <div class="run-launcher-flask-slots" data-field="flask-slots" role="tablist" aria-label="Potion slots"></div>
                  <div class="run-launcher-flask-head">
                    <button type="button" data-action="flask-empty">EMPTY</button>
                    <span data-field="flask-summary">Empty flask</span>
                  </div>
                  <div class="run-launcher-flask-list" data-field="flask-materials"></div>
                </div>
              </section>
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
    this.normalSummary = this.root.querySelector<HTMLElement>('[data-section="normal-summary"]')!;
    this.testFieldsSection = this.root.querySelector<HTMLElement>('[data-section="test-fields"]')!;
    this.worldSelect = this.root.querySelector<HTMLSelectElement>('[data-field="world"]')!;
    this.levelSelect = this.root.querySelector<HTMLSelectElement>('[data-field="level"]')!;
    this.seedInput = this.root.querySelector<HTMLInputElement>('[data-field="seed"]')!;
    this.loadoutSelect = this.root.querySelector<HTMLSelectElement>('[data-field="loadout"]')!;
    this.goldInput = this.root.querySelector<HTMLInputElement>('[data-field="gold"]')!;
    this.maxHpInput = this.root.querySelector<HTMLInputElement>('[data-field="max-hp"]')!;
    this.hpInput = this.root.querySelector<HTMLInputElement>('[data-field="hp"]')!;
    this.maxLevitInput = this.root.querySelector<HTMLInputElement>('[data-field="max-levit"]')!;
    this.flaskSummary = this.root.querySelector<HTMLElement>('[data-field="flask-summary"]')!;
    this.flaskEmptyButton = this.root.querySelector<HTMLButtonElement>('[data-action="flask-empty"]')!;
    this.cardFilterSelect = this.root.querySelector<HTMLSelectElement>('[data-field="card-filter"]')!;
    this.cardSearchInput = this.root.querySelector<HTMLInputElement>('[data-field="card-search"]')!;
    this.kitSection = this.root.querySelector<HTMLElement>('[data-section="kit"]')!;
    this.kitTabButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-kit-tab]'));
    this.kitPanels = Array.from(this.root.querySelectorAll<HTMLElement>('[data-kit-panel]'));
    this.startButton = this.root.querySelector<HTMLButtonElement>('.run-launcher-start')!;
    this.statusEl = this.root.querySelector<HTMLDivElement>('.run-launcher-status')!;

    this.populateLevels();
    this.flaskSlotButtons = this.populateFlaskSlots();
    const flaskControls = this.populateMaterials();
    this.flaskRows = flaskControls.rows;
    this.flaskRadios = flaskControls.radios;
    this.flaskSliders = flaskControls.sliders;
    this.flaskOutputs = flaskControls.outputs;
    this.cardChecks = this.populateCards();
    this.perkChecks = this.populatePerks();
    document.body.appendChild(this.root);

    document.getElementById('mode-play-btn')?.addEventListener('click', (e) => {
      if (this.ctx.state.playtestSource === 'builder' || this.builderIsOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.currentTarget as HTMLElement).blur();
      this.ctx.audio.ensure();
      this.open('play-button');
    }, true);
    window.addEventListener('run-launcher-request', (event) => {
      if (this.ctx.state.playtestSource === 'builder' || this.builderIsOpen()) return;
      event.preventDefault();
      this.ctx.audio.ensure();
      const source = event instanceof CustomEvent && this.isLauncherSource(event.detail?.source)
        ? event.detail.source
        : 'play-button';
      this.open(source);
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
    this.flaskEmptyButton.addEventListener('click', () => {
      this.setFlaskSlot(this.activeFlaskSlot, null, 0);
      this.sync();
    });
    for (const input of [...this.cardChecks, ...this.perkChecks]) input.addEventListener('change', () => this.sync());
    this.cardFilterSelect.addEventListener('change', () => {
      this.updateCardVisibility();
      this.sync();
    });
    this.cardSearchInput.addEventListener('input', () => {
      this.updateCardVisibility();
      this.sync();
    });
    for (const button of this.kitTabButtons) {
      button.addEventListener('click', () => {
        const tab = button.dataset.kitTab;
        if (validKitTab(tab)) this.setKitTab(tab);
      });
    }
    this.root.querySelector<HTMLButtonElement>('[data-action="cards-all"]')?.addEventListener('click', () => {
      for (const input of this.visibleCardChecks()) input.checked = true;
      this.sync();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="cards-clear"]')?.addEventListener('click', () => {
      for (const input of this.visibleCardChecks()) input.checked = false;
      this.sync();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="perks-all"]')?.addEventListener('click', () => {
      for (const input of this.perkChecks) input.checked = true;
      this.sync();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="perks-clear"]')?.addEventListener('click', () => {
      for (const input of this.perkChecks) input.checked = false;
      this.sync();
    });
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
    this.setKitTab(this.activeKitTab);
    this.updateCardVisibility();
    this.sync(false);
  }

  open(source: LauncherSource = 'play-button'): void {
    this.pendingSource = source;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!this.seedInput.value) this.seedInput.value = String(this.ctx.levels.runStatus(this.ctx).worldSeed >>> 0);
    this.root.classList.add('visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.sync(false);
    this.primaryFocusTarget().focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.remove('visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.pendingSource = 'play-button';
    this.lastFocused?.focus({ preventScroll: true });
    this.lastFocused = null;
  }

  private isLauncherSource(source: unknown): source is LauncherSource {
    return source === 'play-button' || source === 'tab' || source === 'fullscreen';
  }

  private primaryFocusTarget(): HTMLElement {
    return this.continueButton.disabled ? this.startButton : this.continueButton;
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

  private populateFlaskSlots(): HTMLButtonElement[] {
    const host = this.root.querySelector<HTMLDivElement>('[data-field="flask-slots"]')!;
    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < FLASK_SLOT_COUNT; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.flaskSlot = String(i);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', i === this.activeFlaskSlot ? 'true' : 'false');
      button.textContent = `Flask ${i + 1}`;
      button.addEventListener('click', () => {
        this.activeFlaskSlot = i;
        this.updateFlaskRows();
        this.sync();
      });
      host.appendChild(button);
      buttons.push(button);
    }
    return buttons;
  }

  private populateMaterials(): {
    rows: HTMLElement[];
    radios: HTMLInputElement[];
    sliders: HTMLInputElement[];
    outputs: HTMLOutputElement[];
  } {
    const host = this.root.querySelector<HTMLDivElement>('[data-field="flask-materials"]')!;
    const entries = Object.entries(this.ctx.params.materials)
      .map(([id, def]) => ({ id: Number(id), name: def.name }))
      .filter((entry) => entry.id !== Cell.Empty && Number.isFinite(entry.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rows: HTMLElement[] = [];
    const radios: HTMLInputElement[] = [];
    const sliders: HTMLInputElement[] = [];
    const outputs: HTMLOutputElement[] = [];
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'run-launcher-flask-row';
      row.dataset.flaskMaterial = String(entry.id);
      row.dataset.flaskName = entry.name.toLowerCase();
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', 'false');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'run-launcher-flask-material';
      radio.value = String(entry.id);
      radio.setAttribute('aria-label', entry.name);

      const name = document.createElement('span');
      name.className = 'run-launcher-flask-name';
      name.textContent = entry.name;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '600';
      slider.step = '25';
      slider.value = '0';
      slider.setAttribute('aria-label', `${entry.name} flask cells`);

      const output = document.createElement('output');
      output.value = '0';
      output.textContent = '0';

      const index = rows.length;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const count = this.readFlaskSlider(index) || 300;
        this.selectFlaskMaterial(index, count);
        this.sync();
      });
      row.addEventListener('click', (event) => {
        if (event.target === slider || event.target === radio) return;
        const count = this.readFlaskSlider(index) || 300;
        this.selectFlaskMaterial(index, count);
        this.sync();
      });
      slider.addEventListener('input', () => {
        const count = this.readFlaskSlider(index);
        if (count > 0) {
          this.selectFlaskMaterial(index, count);
        } else if (this.materialIndexFor(this.flaskSlotConfigs[this.activeFlaskSlot].material) === index) {
          this.setFlaskSlot(this.activeFlaskSlot, null, 0);
        } else {
          this.updateFlaskRows();
        }
        this.sync();
      });

      row.append(radio, name, slider, output);
      host.appendChild(row);
      rows.push(row);
      radios.push(radio);
      sliders.push(slider);
      outputs.push(output);
    }
    return { rows, radios, sliders, outputs };
  }

  private populateCards(): HTMLInputElement[] {
    const host = this.root.querySelector<HTMLDivElement>('[data-field="cards"]')!;
    return ALL_CARD_IDS.map((id) => {
      const label = document.createElement('label');
      label.className = 'run-launcher-check';
      label.dataset.cardKind = CARD_DEFS[id].kind;
      label.dataset.cardName = `${id} ${CARD_DEFS[id].name}`.toLowerCase();
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
      this.cardSearchInput,
    ];
  }

  private allTestControls(): Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> {
    return [
      this.worldSelect,
      this.levelSelect,
      this.loadoutSelect,
      this.goldInput,
      this.maxHpInput,
      this.hpInput,
      this.maxLevitInput,
      this.flaskEmptyButton,
      ...this.flaskSlotButtons,
      ...this.flaskRadios,
      ...this.flaskSliders,
      this.cardFilterSelect,
      this.cardSearchInput,
      ...this.cardChecks,
      ...this.perkChecks,
    ];
  }

  private setMode(mode: RunMode): void {
    this.savePrefs();
    this.mode = mode;
    if (mode === 'test' && this.worldSelect.value === 'campaign') {
      this.worldSelect.value = 'campaign-level';
    }
    if (mode === 'normal') {
      this.worldSelect.value = 'campaign';
      this.loadoutSelect.value = 'fresh';
    }
    this.restoreModePrefs(mode);
    this.sync();
  }

  private sync(persist = true): void {
    const status = this.ctx.levels.runStatus(this.ctx);
    const canContinue = this.canContinue(status);
    this.continueButton.disabled = !canContinue;
    this.normalButton.classList.toggle('selected', this.mode === 'normal');
    this.testButton.classList.toggle('selected', this.mode === 'test');

    const testMode = this.mode === 'test';
    const worldSource = this.worldSelect.value as RunWorldSource;
    const virtual = worldSource === 'virtual-world';
    this.normalSummary.classList.toggle('run-launcher-hidden', testMode);
    this.testFieldsSection.classList.toggle('run-launcher-hidden', !testMode);
    this.kitSection.classList.toggle('run-launcher-hidden', !testMode);
    for (const input of this.allTestControls()) input.disabled = !testMode;
    this.levelSelect.disabled = !testMode || worldSource !== 'campaign-level';
    this.updateFlaskRows();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-kit-tab], [data-action="cards-all"], [data-action="cards-clear"], [data-action="perks-all"], [data-action="perks-clear"]')) {
      button.disabled = !testMode;
    }
    this.startButton.textContent = testMode ? 'START TEST' : 'START NEW';
    this.startButton.disabled = false;

    if (testMode && virtual) {
      this.statusEl.textContent = 'Chunked virtual worlds start as disposable materialized test windows; saves stay untouched.';
    } else if (testMode) {
      this.statusEl.textContent = 'Test runs are disposable, can jump to any campaign level, and never overwrite expedition saves.';
    } else if (canContinue) {
      this.statusEl.textContent = 'New Expedition starts clean at D1. Continue resumes the current or saved descent.';
    } else if (status.level && (status.playtestSource !== null || status.debugGodMode)) {
      this.statusEl.textContent = 'Current play state is disposable/debug-tainted. Start New creates a clean expedition.';
    } else {
      this.statusEl.textContent = 'New Expedition starts at D1 with normal progression and autosave.';
    }
    if (persist) this.savePrefs();
  }

  private canContinue(status: RunStatus): boolean {
    const cleanCurrent = status.level !== null && status.playtestSource === null && !status.debugGodMode;
    return status.savedExpedition || cleanCurrent;
  }

  private shouldConfirmNewExpedition(status: RunStatus): boolean {
    if (status.savedExpedition) return true;
    return status.level !== null && status.playtestSource === null && !status.debugGodMode;
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
    const worldSource = this.mode === 'test' ? (this.worldSelect.value as RunWorldSource) : 'campaign';
    const seed = Number(this.seedInput.value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      this.statusEl.textContent = 'Seed must be an integer from 0 to 4294967295.';
      return;
    }
    const status = this.ctx.levels.runStatus(this.ctx);
    if (this.mode === 'normal' && this.shouldConfirmNewExpedition(status)) {
      const ok = await appDialog.confirm('Start a new expedition and abandon the current or saved one?', {
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
      levelId: this.mode === 'test' ? this.levelSelect.value : undefined,
      seed,
      loadout: this.mode === 'test' ? (this.loadoutSelect.value as RunLoadoutPreset) : 'fresh',
      kit: this.mode === 'test' ? this.readKit() : undefined,
      continueSave: false,
    });
    this.finish(started.ok, started.message);
  }

  private finish(ok: boolean, message: string): void {
    this.statusEl.textContent = message;
    if (!ok) return;
    const source = this.pendingSource;
    this.close();
    window.dispatchEvent(new CustomEvent('run-launcher-started', { detail: { source } }));
  }

  private applyPresetDefaults(preset: RunLoadoutPreset): void {
    const cards = preset === 'review' ? ALL_CARD_IDS : preset === 'advanced' ? ADVANCED_CARDS : [];
    const perks = preset === 'review' ? PERK_CHOICES.map((perk) => perk.id) : [];
    this.goldInput.value = preset === 'review' ? '1000' : preset === 'advanced' ? '250' : '0';
    this.maxHpInput.value = preset === 'review' ? '999' : preset === 'advanced' ? '140' : '100';
    this.hpInput.value = this.maxHpInput.value;
    this.maxLevitInput.value = preset === 'review' ? '400' : preset === 'advanced' ? '125' : '100';
    this.clearFlaskSlots();
    if (preset === 'advanced') {
      this.setFlaskSlot(0, Cell.Water, 300);
    } else if (preset === 'review') {
      this.setFlaskSlot(0, Cell.Water, 600);
      this.setFlaskSlot(1, Cell.ElixirLife, 600);
      this.setFlaskSlot(2, Cell.ElixirLevity, 600);
      this.setFlaskSlot(3, Cell.Acid, 600);
    }
    this.activeFlaskSlot = 0;
    this.updateFlaskRows();
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

  private clampFlaskCount(count: number): number {
    if (!Number.isFinite(count)) return 0;
    return Math.max(0, Math.min(600, Math.floor(count)));
  }

  private readFlaskSlider(index: number): number {
    return this.clampFlaskCount(Number(this.flaskSliders[index]?.value ?? 0));
  }

  private materialIndexFor(material: number | null): number {
    if (material === null) return -1;
    return this.flaskRadios.findIndex((input) => input.value === String(material));
  }

  private clearFlaskSlots(): void {
    for (let i = 0; i < this.flaskSlotConfigs.length; i++) {
      this.flaskSlotConfigs[i] = { material: null, count: 0 };
    }
  }

  private setFlaskSlot(slotIndex: number, material: number | null, count: number): void {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= this.flaskSlotConfigs.length) return;
    const clamped = material === null ? 0 : this.clampFlaskCount(count);
    this.flaskSlotConfigs[slotIndex] = {
      material: clamped > 0 ? material : null,
      count: clamped,
    };
    this.updateFlaskRows();
  }

  private selectFlaskMaterial(materialIndex: number, count: number): void {
    const material = Number(this.flaskRadios[materialIndex]?.value);
    this.setFlaskSlot(this.activeFlaskSlot, Number.isInteger(material) ? material : null, count);
  }

  private readFlasks(): FlaskSlotConfig[] {
    return this.flaskSlotConfigs.map((slot) => ({
      material: slot.material,
      count: this.clampFlaskCount(slot.count),
    }));
  }

  private restoreFlasks(flasks: Array<FlaskSlotConfig | null | undefined> | undefined): void {
    this.clearFlaskSlots();
    if (flasks) {
      for (let i = 0; i < Math.min(FLASK_SLOT_COUNT, flasks.length); i++) {
        const flask = flasks[i];
        if (!flask) continue;
        this.setFlaskSlot(i, flask.material, flask.count);
      }
    }
    this.updateFlaskRows();
  }

  private updateFlaskRows(): void {
    const active = this.flaskSlotConfigs[this.activeFlaskSlot];
    const selectedIndex = this.materialIndexFor(active.material);
    for (let i = 0; i < this.flaskSlotButtons.length; i++) {
      const slot = this.flaskSlotConfigs[i];
      const activeButton = i === this.activeFlaskSlot;
      this.flaskSlotButtons[i].classList.toggle('active', activeButton);
      this.flaskSlotButtons[i].setAttribute('aria-selected', activeButton ? 'true' : 'false');
      const name = slot.material === null ? 'Empty' : (this.ctx.params.materials[slot.material]?.name ?? `Material ${slot.material}`);
      this.flaskSlotButtons[i].textContent = `${i + 1}: ${name}${slot.count > 0 ? ` ${slot.count}` : ''}`;
      this.flaskSlotButtons[i].title = `Flask ${i + 1}: ${name}${slot.count > 0 ? ` (${slot.count}/600)` : ''}`;
    }
    for (let i = 0; i < this.flaskRows.length; i++) {
      const selected = i === selectedIndex && active.count > 0;
      const count = selected ? active.count : 0;
      this.flaskRadios[i].checked = selected;
      this.flaskSliders[i].value = String(count);
      this.flaskRows[i].classList.toggle('selected', selected);
      this.flaskRows[i].classList.toggle('filled', count > 0);
      this.flaskRows[i].classList.toggle('disabled', this.flaskSliders[i].disabled);
      this.flaskRows[i].setAttribute('aria-checked', selected ? 'true' : 'false');
      this.flaskOutputs[i].value = String(count);
      this.flaskOutputs[i].textContent = String(count);
    }
    if (selectedIndex < 0 || active.material === null || active.count <= 0) {
      this.flaskSummary.textContent = `Flask ${this.activeFlaskSlot + 1}: Empty`;
      return;
    }
    const name = this.ctx.params.materials[active.material]?.name ?? `Material ${active.material}`;
    this.flaskSummary.textContent = `Flask ${this.activeFlaskSlot + 1}: ${name} - ${active.count} / 600 cells`;
  }

  private readKit(): RunTestKitConfig {
    return {
      gold: this.readNumber(this.goldInput),
      maxHp: this.readNumber(this.maxHpInput),
      hp: this.readNumber(this.hpInput),
      maxLevit: this.readNumber(this.maxLevitInput),
      cards: this.checkedValues<CardId>(this.cardChecks),
      perks: this.checkedValues<PerkId>(this.perkChecks),
      flasks: this.readFlasks(),
      activeFlaskIndex: this.activeFlaskSlot,
    };
  }

  private savePrefs(): void {
    const existing = parsePrefs(localStorage.getItem(PREFS_KEY)) ?? parseLegacyPrefs(localStorage.getItem(LEGACY_PREFS_KEY)) ?? {};
    const prefs: LauncherPrefs = {
      ...existing,
      mode: this.mode,
      normal: {
        ...(existing.normal ?? {}),
        seed: this.mode === 'normal' ? this.seedInput.value : existing.normal?.seed,
      },
      test: {
        ...(existing.test ?? {}),
        ...(this.mode === 'test' ? this.currentTestPrefs() : {}),
      },
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Launcher preferences are convenience only.
    }
  }

  private currentTestPrefs(): TestPrefs {
    const flasks = this.readFlasks();
    const first = flasks[0];
    return {
      world: this.worldSelect.value as RunWorldSource,
      level: this.levelSelect.value,
      seed: this.seedInput.value,
      loadout: this.loadoutSelect.value as RunLoadoutPreset,
      gold: this.goldInput.value,
      maxHp: this.maxHpInput.value,
      hp: this.hpInput.value,
      maxLevit: this.maxLevitInput.value,
      flaskMaterial: first.material === null ? '' : String(first.material),
      flaskCount: String(first.count),
      flasks,
      activeFlaskIndex: this.activeFlaskSlot,
      cards: this.checkedValues<CardId>(this.cardChecks),
      perks: this.checkedValues<PerkId>(this.perkChecks),
      cardFilter: this.cardFilterSelect.value as CardFilter,
      cardSearch: this.cardSearchInput.value,
      kitTab: this.activeKitTab,
    };
  }

  private restorePrefs(): void {
    const prefs = parsePrefs(localStorage.getItem(PREFS_KEY)) ?? parseLegacyPrefs(localStorage.getItem(LEGACY_PREFS_KEY));
    if (!prefs) return;
    if (validRunMode(prefs.mode)) this.mode = prefs.mode;
    this.restoreModePrefs(this.mode, prefs);
  }

  private restoreModePrefs(mode: RunMode, providedPrefs?: LauncherPrefs): void {
    const prefs = providedPrefs ?? parsePrefs(localStorage.getItem(PREFS_KEY)) ?? parseLegacyPrefs(localStorage.getItem(LEGACY_PREFS_KEY));
    if (!prefs) return;
    this.suppressPresetApply = true;
    if (mode === 'normal') {
      this.seedInput.value = prefs.normal?.seed ?? this.seedInput.value;
      this.worldSelect.value = 'campaign';
      this.loadoutSelect.value = 'fresh';
      this.applyPresetDefaults('fresh');
      this.suppressPresetApply = false;
      return;
    }
    const test = prefs.test;
    if (!test) {
      this.suppressPresetApply = false;
      return;
    }
    if (validWorldSource(test.world)) this.worldSelect.value = test.world;
    if (test.level && LEVELS[test.level]) this.levelSelect.value = test.level;
    if (test.seed) this.seedInput.value = test.seed;
    if (validLoadout(test.loadout)) this.loadoutSelect.value = test.loadout;
    for (const [input, value] of [
      [this.goldInput, test.gold],
      [this.maxHpInput, test.maxHp],
      [this.hpInput, test.hp],
      [this.maxLevitInput, test.maxLevit],
      [this.cardSearchInput, test.cardSearch],
    ] as Array<[HTMLInputElement, string | undefined]>) {
      if (value !== undefined) input.value = value;
    }
    if (Array.isArray(test.flasks)) {
      this.restoreFlasks(test.flasks);
    } else if (test.flaskMaterial !== undefined || test.flaskCount !== undefined) {
      const material = test.flaskMaterial === undefined || test.flaskMaterial === '' ? null : Number(test.flaskMaterial);
      const count = Number(test.flaskCount ?? 0);
      this.restoreFlasks([{ material: material === null || Number.isInteger(material) ? material : null, count }]);
    }
    const activeFlaskIndex = test.activeFlaskIndex;
    if (typeof activeFlaskIndex === 'number' && Number.isInteger(activeFlaskIndex) && activeFlaskIndex >= 0 && activeFlaskIndex < FLASK_SLOT_COUNT) {
      this.activeFlaskSlot = activeFlaskIndex;
    }
    this.updateFlaskRows();
    if (validCardFilter(test.cardFilter)) this.cardFilterSelect.value = test.cardFilter;
    if (validKitTab(test.kitTab)) this.activeKitTab = test.kitTab;
    if (test.cards) this.setChecked(this.cardChecks, test.cards);
    if (test.perks) this.setChecked(this.perkChecks, test.perks);
    this.suppressPresetApply = false;
    this.setKitTab(this.activeKitTab);
    this.updateCardVisibility();
  }

  private setKitTab(tab: KitTab): void {
    this.activeKitTab = tab;
    for (const button of this.kitTabButtons) {
      const active = button.dataset.kitTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of this.kitPanels) {
      panel.classList.toggle('active', panel.dataset.kitPanel === tab);
    }
    this.sync();
  }

  private updateCardVisibility(): void {
    const filter = this.cardFilterSelect.value as CardFilter;
    const search = this.cardSearchInput.value.trim().toLowerCase();
    for (const input of this.cardChecks) {
      const label = input.closest<HTMLElement>('.run-launcher-check');
      if (!label) continue;
      const kindOk = filter === 'all' || label.dataset.cardKind === filter;
      const searchOk = search === '' || (label.dataset.cardName ?? '').includes(search);
      label.classList.toggle('run-launcher-hidden', !kindOk || !searchOk);
    }
  }

  private visibleCardChecks(): HTMLInputElement[] {
    return this.cardChecks.filter((input) => !input.closest<HTMLElement>('.run-launcher-check')?.classList.contains('run-launcher-hidden'));
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
