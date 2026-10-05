import type { Ctx, Difficulty, RunStartResult } from '@/core/types';
import type { KitId } from '@/core/run';
import { GAME_SUBTITLE, GAME_TAGLINE, GAME_TITLE } from '@/config/brand';
import { FLOORS_TOTAL } from '@/config/worldgraph';
import { formatRunTime } from '@/game/runRules';
import { PlayerSettings } from '@/ui/PlayerSettings';
import { KIT_DEFS, KIT_ORDER } from '@/content/kits';
import { MAX_MUTATORS, MUTATOR_DEFS, MUTATOR_ORDER, cleanMutators, mutatorNames, type MutatorId } from '@/content/mutators';
import { DIFFICULTY, DIFFICULTY_ORDER } from '@/config/difficulty';
import { BASE_DIFFICULTY, DIFFICULTY_BLURBS, difficultyUnlockHint, isDifficultyOpen, openDifficulty } from '@/config/difficultyLadder';
import { appDialog } from '@/ui/AppDialog';
import { openTrailer } from '@/ui/TrailerLightbox';
import { launchLine } from '@/content/launchLines';
import { TitleMenu, type MenuCue } from '@/ui/title/TitleMenu';
import { SeedPage, type ChosenSeed } from '@/ui/title/SeedPage';
import {
  complicationDetail,
  complicationsDetail,
  complicationsTotal,
  complicationsValue,
  continueLine,
  cycleDifficulty,
  cycleKit,
  dailyLines,
  difficultyDetail,
  kitDetail,
  loadMark,
  seedDetail,
  seedValue,
  toggleComplication,
  type ContinueFacts,
  type DailyFacts,
  type MenuItem,
} from '@/ui/title/titleMenuModel';

/** "Breathing Works" → "Breathing<br><em>Works</em>": the last word takes the brass. */
function titleMarkup(title: string): string {
  const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const cut = title.lastIndexOf(' ');
  if (cut <= 0) return `<em>${escape(title)}</em>`;
  return `${escape(title.slice(0, cut))}<br><em>${escape(title.slice(cut + 1))}</em>`;
}

const CUE_SOUND = { move: 'ui.hover', step: 'ui.hover', back: 'ui.back', refuse: 'ui.back' } as const satisfies Record<MenuCue, string>;

/**
 * The player entrance, laid out like a game's menu rather than a page: the title and a short main list
 * (Continue, New descent, Today's descent, the Workshop, Extras, Options), and each door opens the choices that
 * belong to it. New descent is a loadout page (case, fighter, difficulty, seed: Left / Right change a row in
 * place, Enter opens the full list, and the card beside it explains what the row is set to); Extras holds the
 * trailer and the opening. The Builder, the sandbox and the advanced run launcher stay behind the
 * authoring-only Workshops page. The walking is ui/title/TitleMenu; what each page says is ui/title/titleMenuModel.
 */
export class ExpeditionEntry {
  private readonly root = document.createElement('section');
  private readonly settings: PlayerSettings;
  private readonly menu: TitleMenu;
  private readonly seed: SeedPage;
  private readonly disposers: Array<() => void> = [];
  private launching = false;
  private unlockedKits = new Set<KitId>(['spark']);
  private selectedKit: KitId = 'spark';
  private selectedDifficulty: Difficulty = BASE_DIFFICULTY;
  private bestVictory = 0;
  private chosenSeed: ChosenSeed | null = null;
  /** The complications chosen for the next descent (remembered by the profile), and what today's carries. */
  private mutators: MutatorId[] = [];
  private todayMutators: MutatorId[] = [];
  /** A swap or a refusal worth saying, shown under the complications list until the next change. */
  private complicationsNote = '';
  private daily: DailyFacts | null = null;
  private workshopUnlocked = false;

  /**
   * `playReady` resolves once the play systems (game/playSystems: the story,
   * the score, the Sanctum…) are installed — false if they could not load.
   * They are fetched under the title; a launch waits for them.
   */
  constructor(private readonly ctx: Ctx, private readonly playReady: () => Promise<boolean> = () => Promise.resolve(true)) {
    this.settings = new PlayerSettings(ctx);
    this.root.id = 'expedition-entry';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'expedition-title');
    this.root.innerHTML = `<div class="entry-scene" aria-hidden="true"></div><div class="entry-content">
      <div class="tm-brand"><h1 id="expedition-title">${titleMarkup(GAME_TITLE)}</h1>
      <p class="entry-subtitle">${GAME_SUBTITLE}</p>
      <p class="entry-tagline">${GAME_TAGLINE.replace('. ', '.<br>')}</p></div>
      <div class="tm-slot"></div>
      <p class="touch-entry-hint">Touch controls are ready. Turn sideways for a larger view. Change controls in Options.</p>
      <p class="entry-status" role="status"></p>
      </div><div class="entry-footer"><span class="entry-release">${GAME_TITLE} <b aria-label="Game version ${__APP_VERSION__}">v${__APP_VERSION__}</b></span><span class="tm-keys-slot"></span></div>`;
    this.menu = new TitleMenu((cue) => { ctx.audio.ensure(); ctx.audio.sfx(CUE_SOUND[cue]); });
    this.seed = new SeedPage(ctx, () => this.menu.refresh(), () => this.useSeed());
    this.registerPages();
    this.root.querySelector('.tm-slot')!.appendChild(this.menu.root);
    this.root.querySelector('.tm-keys-slot')!.appendChild(this.menu.keys);
    document.getElementById('canvas-holder')!.appendChild(this.root);
    this.disposers.push(ctx.events.on('modeChanged', ({ mode }) => { if (mode === 'play') this.hide(); }));
    window.addEventListener('expedition-title-request', this.onTitleRequest);
    this.disposers.push(() => window.removeEventListener('expedition-title-request', this.onTitleRequest));
    const syncPad = (): void => this.menu.setPad(this.padConnected());
    window.addEventListener('gamepadconnected', syncPad);
    window.addEventListener('gamepaddisconnected', syncPad);
    this.disposers.push(() => { window.removeEventListener('gamepadconnected', syncPad); window.removeEventListener('gamepaddisconnected', syncPad); });
    if (!__AUTHORING__) {
      // Player builds: the header's Play (and Tab) in the Workshop lead back
      // here, never to the authoring run launcher. Capture on window runs
      // before the launcher's own listener.
      window.addEventListener('run-launcher-request', this.onLauncherRequest, { capture: true });
      this.disposers.push(() => window.removeEventListener('run-launcher-request', this.onLauncherRequest, { capture: true }));
      // The launcher claims the header Play button itself (capture on the
      // button); a document-level capture sees the click first.
      document.addEventListener('click', this.onPlayButtonCapture, true);
      this.disposers.push(() => document.removeEventListener('click', this.onPlayButtonCapture, true));
    }
  }

  // ---- pages --------------------------------------------------------------------------------------------

  private registerPages(): void {
    const menu = this.menu;
    const back = (): MenuItem => ({ id: 'back', label: 'Back', kind: 'back', activate: () => { menu.pop(); } });
    menu.register({ id: 'main', title: '', items: () => this.mainItems() });
    menu.register({ id: 'descent', title: 'Prepare your descent', eyebrow: 'New descent', focus: 'descend', items: () => [...this.descentItems(), back()] });
    menu.register({ id: 'case', title: 'Your case', eyebrow: 'New descent', focus: () => `kit-${this.selectedKit}`, items: () => [...this.caseItems(), back()] });
    menu.register({ id: 'difficulty', title: 'Difficulty', eyebrow: 'New descent', focus: () => `difficulty-${this.selectedDifficulty}`, items: () => [...this.difficultyItems(), back()] });
    menu.register({
      id: 'complications', title: 'Complications', eyebrow: 'New descent', items: () => [...this.complicationItems(), back()],
      note: () => this.complicationsPageNote(),
    });
    menu.register({ id: 'seed', title: 'Seed', eyebrow: 'New descent', items: () => [...this.seedItems(), back()], body: () => this.seed.body(), lead: () => this.seed.input });
    menu.register({ id: 'extras', title: 'Extras', items: () => [...this.extrasItems(), back()] });
    menu.register({ id: 'workshops', title: 'Workshops', items: () => [...this.workshopItems(), back()] });
  }

  private saved(): boolean {
    return this.ctx.levels.hasSavedExpedition() || this.ctx.run?.active === true;
  }

  private continueFacts(): ContinueFacts | null {
    const save = this.ctx.run?.active ? this.ctx.run.snapshotForSave() : null;
    return save ? { maxFloor: save.maxFloor, kit: save.kit, fighter: save.fighter ?? null, timeMs: save.timeMs } : null;
  }

  private mainItems(): MenuItem[] {
    const saved = this.saved();
    const items: MenuItem[] = [];
    if (saved) {
      items.push({
        id: 'continue', label: 'Continue', kind: 'action', primary: true,
        sub: continueLine(this.continueFacts(), FLOORS_TOTAL, formatRunTime(this.continueFacts()?.timeMs ?? 0)),
        hint: 'Return to the descent in progress.',
        activate: () => void this.launch('continue'),
      });
    }
    items.push({
      id: 'begin', label: 'New descent', kind: 'drill', primary: !saved,
      hint: saved ? 'Start over with a fresh Works. Your current descent will be replaced.' : 'Choose your case and how hard the Works bites.',
      activate: () => this.menu.push('descent'),
    });
    const daily = this.daily ? dailyLines(this.daily, FLOORS_TOTAL, formatRunTime) : null;
    items.push({
      id: 'daily', label: 'Today’s descent', kind: 'action', sub: daily?.sub, hint: daily?.hint,
      activate: () => void this.launch('daily'),
    });
    // No Duel or Arena door: the Duel is its own game now (CLASHFORGED, its own repository; docs/split/SPLIT-PLAN.md).
    // The arena code still in this repository is unreachable from the title and goes in split phase 2.
    if (__AUTHORING__) {
      items.push({ id: 'workshops', label: 'Workshops', kind: 'drill', hint: 'The material sandbox, the level builder and the advanced run setup.', activate: () => this.menu.push('workshops') });
    } else if (this.workshopUnlocked) {
      items.push({ id: 'workshop', label: 'The Workshop', kind: 'action', hint: 'The material sandbox. Nothing here can hurt you, much.', activate: () => this.openWorkshop('workshop') });
    }
    items.push({ id: 'extras', label: 'Extras', kind: 'drill', hint: this.extrasItems().length > 1 ? 'The trailer, and the opening.' : 'The trailer.', activate: () => this.menu.push('extras') });
    items.push({ id: 'settings', label: 'Options', kind: 'action', hint: 'Controls, comfort and sound.', activate: () => this.settings.open() });
    return items;
  }

  private descentItems(): MenuItem[] {
    const kit = KIT_DEFS[this.selectedKit];
    const tier = DIFFICULTY[this.selectedDifficulty];
    const recap = [kit.short, tier.name];
    if (this.mutators.length > 0) recap.push(`${this.mutators.length} complication${this.mutators.length > 1 ? 's' : ''}`);
    if (this.chosenSeed) recap.push(`seed ${this.chosenSeed.seed >>> 0}`);
    return [
      {
        id: 'case', label: 'Case', kind: 'choice', value: kit.short, icon: { kind: 'kit', kit: this.selectedKit },
        detail: kitDetail(this.selectedKit, true),
        activate: () => this.menu.push('case'),
        step: (dir) => this.setKit(cycleKit(this.unlockedKits, this.selectedKit, dir)),
      },
      {
        id: 'difficulty', label: 'Difficulty', kind: 'choice', value: `${tier.roman} · ${tier.name}`, icon: { kind: 'text', text: tier.roman },
        detail: difficultyDetail(this.selectedDifficulty, this.bestVictory),
        activate: () => this.menu.push('difficulty'),
        step: (dir) => this.setDifficulty(cycleDifficulty(this.bestVictory, this.selectedDifficulty, dir)),
      },
      {
        id: 'complications', label: 'Complications', kind: 'choice', value: complicationsValue(this.mutators), icon: { kind: 'text', text: '±' },
        detail: complicationsDetail(this.mutators),
        activate: () => { this.complicationsNote = ''; this.menu.push('complications'); },
      },
      {
        id: 'seed', label: 'Seed', kind: 'choice', value: seedValue(this.chosenSeed), icon: { kind: 'text', text: '#' },
        detail: seedDetail(this.chosenSeed),
        activate: () => this.menu.push('seed'),
      },
      {
        id: 'descend', label: 'Descend', kind: 'action', primary: true, sub: recap.join(' · '),
        activate: () => void this.launch('begin', this.chosenSeed?.seed),
      },
    ];
  }

  private caseItems(): MenuItem[] {
    return KIT_ORDER.map((id): MenuItem => {
      const def = KIT_DEFS[id];
      const open = this.unlockedKits.has(id);
      return {
        id: `kit-${id}`, label: def.name, kind: 'option', checked: id === this.selectedKit, locked: !open,
        sub: open ? def.blurb : `Locked. ${def.unlockHint}`,
        icon: { kind: 'kit', kit: id },
        attrs: { 'data-kit': id },
        detail: kitDetail(id, open),
        activate: () => { this.setKit(id); this.menu.pop(); },
      };
    });
  }

  private difficultyItems(): MenuItem[] {
    return DIFFICULTY_ORDER.map((tier): MenuItem => {
      const def = DIFFICULTY[tier];
      const open = isDifficultyOpen(tier, this.bestVictory);
      return {
        id: `difficulty-${tier}`, label: def.name, kind: 'option', checked: tier === this.selectedDifficulty, locked: !open,
        sub: open ? DIFFICULTY_BLURBS[tier] : `Locked. ${difficultyUnlockHint(tier)}`,
        icon: { kind: 'text', text: def.roman },
        attrs: { 'data-difficulty': String(tier) },
        detail: difficultyDetail(tier, this.bestVictory),
        activate: () => { this.setDifficulty(tier); this.menu.pop(); },
      };
    });
  }

  private complicationItems(): MenuItem[] {
    const full = this.mutators.length >= MAX_MUTATORS;
    const items = MUTATOR_ORDER.map((id): MenuItem => {
      const def = MUTATOR_DEFS[id];
      const on = this.mutators.includes(id);
      return {
        id: `comp-${id}`, label: def.name, kind: 'toggle', checked: on, locked: full && !on,
        value: loadMark(def.weight),
        attrs: { 'data-mutator': id, 'data-weight': String(def.weight) },
        detail: complicationDetail(id, this.mutators),
        activate: () => this.toggleComplication(id),
      };
    });
    if (this.mutators.length > 0) {
      items.push({ id: 'clear', label: 'Clear all', kind: 'action', attrs: { 'data-comp': 'clear' }, activate: () => this.setMutators([], '') });
    }
    return items;
  }

  private complicationsPageNote(): string {
    const today = this.todayMutators.length > 0 ? ` Today’s descent carries ${mutatorNames(this.todayMutators)}, set by the date; it ignores this choice.` : '';
    return `${this.complicationsNote || complicationsTotal(this.mutators)}${today}`;
  }

  private toggleComplication(id: MutatorId): void {
    const result = toggleComplication(this.mutators, id);
    if (result.refused) { this.complicationsNote = result.note; this.menu.refresh(); return; }
    this.setMutators(result.chosen, result.note);
  }

  private setMutators(chosen: readonly MutatorId[], note: string): void {
    this.mutators = cleanMutators(chosen);
    this.complicationsNote = note;
    this.ctx.run?.chooseMutators(this.mutators);
    this.menu.refresh();
  }

  private seedItems(): MenuItem[] {
    const typed = this.seed.parsed();
    const items: MenuItem[] = [
      {
        id: 'use', label: 'Use this seed', kind: 'action', primary: true, locked: typed === null,
        sub: typed === null ? 'Type a number, or any words.' : undefined,
        attrs: { 'data-seed': 'use' },
        activate: () => this.useSeed(),
      },
    ];
    if (this.chosenSeed) {
      items.push({ id: 'random', label: 'Random descent', kind: 'action', sub: 'Forget the seed.', attrs: { 'data-seed': 'random' }, activate: () => this.clearSeed() });
    }
    if (this.seed.currentSeed() !== null) {
      items.push({ id: 'copy', label: 'Copy this descent’s seed', kind: 'action', attrs: { 'data-seed': 'copy' }, activate: () => void this.seed.copyCurrent() });
    }
    return items;
  }

  private extrasItems(): MenuItem[] {
    const items: MenuItem[] = [
      { id: 'trailer', label: 'Watch the trailer', kind: 'action', sub: 'Ninety-five seconds of safety induction. Mind the duck.', activate: () => openTrailer(this.ctx, this.menuButton('trailer')) },
    ];
    // STORY: once seen, the opening can be watched again from here.
    if (this.ctx.story?.openingSeen === true) {
      items.push({ id: 'opening', label: 'The opening', kind: 'action', sub: 'Kettleby, the lift, and a voice in the pipes.', activate: () => void this.ctx.story?.playOpening({ replay: true }) });
    }
    return items;
  }

  private workshopItems(): MenuItem[] {
    return [
      { id: 'sandbox', label: 'Material sandbox', kind: 'action', hint: 'Paint the live simulation.', activate: () => this.openWorkshop('sandbox') },
      { id: 'builder', label: 'Level builder', kind: 'action', hint: 'Author a level and playtest it.', activate: () => this.openWorkshop('builder') },
      { id: 'advanced', label: 'Advanced run setup', kind: 'action', hint: 'The full run launcher.', activate: () => this.openWorkshop('advanced') },
    ];
  }

  private menuButton(id: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`.tm-item[data-entry="${id}"]`) ?? this.root;
  }

  // ---- choices ------------------------------------------------------------------------------------------

  private setKit(kit: KitId): void {
    if (!this.unlockedKits.has(kit)) return;
    const changed = kit !== this.selectedKit;
    this.selectedKit = kit;
    if (changed) this.ctx.run?.chooseKit(kit);
    this.menu.refresh();
  }

  private setDifficulty(tier: Difficulty): void {
    if (!isDifficultyOpen(tier, this.bestVictory)) return;
    const changed = tier !== this.selectedDifficulty;
    this.selectedDifficulty = tier;
    if (changed) this.ctx.run?.chooseDifficulty(tier);
    this.menu.refresh();
  }

  private useSeed(): void {
    const typed = this.seed.parsed();
    if (!typed) return;
    this.chosenSeed = typed;
    this.menu.pop();
  }

  private clearSeed(): void {
    this.chosenSeed = null;
    this.seed.clear();
    this.menu.pop();
  }

  private openWorkshop(action: 'sandbox' | 'builder' | 'workshop' | 'advanced'): void {
    this.hide();
    this.ctx.state.paused = false;
    if (action === 'advanced') {
      window.dispatchEvent(new CustomEvent('run-launcher-request', { detail: { source: 'play-button' } }));
    } else {
      document.getElementById(action === 'builder' ? 'mode-builder-btn' : 'mode-build-btn')?.click();
    }
  }

  // ---- showing and launching -----------------------------------------------------------------------------

  show(): void {
    if (document.body.classList.contains('builder-open') || this.ctx.state.mode === 'play') return;
    this.ctx.state.paused = true;
    this.root.hidden = false;
    document.body.classList.add('entry-active');
    this.refreshMeta();
    this.menu.setPad(this.padConnected());
    this.root.querySelector<HTMLElement>('.entry-status')!.textContent = '';
    // The call to action takes focus for keyboard and gamepad (the menu opens on it).
    this.menu.open('main', this.saved() ? 'continue' : 'begin');
  }

  private padConnected(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' && Array.from(navigator.getGamepads()).some((pad) => pad?.connected === true);
  }

  private refreshMeta(): void {
    const view = this.ctx.run?.metaView();
    this.unlockedKits = new Set<KitId>(['spark', ...(view?.unlockedKits ?? [])]);
    const lastKit = view?.lastKit ?? 'spark';
    this.selectedKit = this.unlockedKits.has(lastKit) ? lastKit : 'spark';
    this.bestVictory = view?.bestVictoryDifficulty ?? 0;
    this.selectedDifficulty = openDifficulty(view?.lastDifficulty ?? BASE_DIFFICULTY, this.bestVictory);
    this.mutators = cleanMutators(view?.lastMutators ?? []);
    this.todayMutators = cleanMutators(view?.todayMutators ?? []);
    this.complicationsNote = '';
    this.daily = view ? { today: view.today, best: view.todayBest ? { victory: view.todayBest.victory, floor: view.todayBest.floor, timeMs: view.todayBest.timeMs } : null, carries: mutatorNames(this.todayMutators) } : null;
    // The material sandbox opens to players once a first run has ended.
    this.workshopUnlocked = view?.workshopUnlocked === true;
    this.seed.show(this.chosenSeed);
  }

  /** The story arrives with the play systems, after the title may already show: "The opening" follows it. */
  refreshStory(): void {
    if (!this.root.hidden) this.menu.refresh();
  }

  private hide(): void { this.root.hidden = true; document.body.classList.remove('entry-active'); }

  private readonly onTitleRequest = (): void => {
    if (this.ctx.state.mode === 'play') document.getElementById('mode-build-btn')?.click();
    this.show();
  };

  private readonly onPlayButtonCapture = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#mode-play-btn')) return;
    if (this.ctx.state.playtestSource !== null || document.body.classList.contains('builder-open')) return;
    event.preventDefault();
    event.stopPropagation();
    (target.closest('#mode-play-btn') as HTMLElement | null)?.blur();
    this.show();
  };

  private readonly onLauncherRequest = (event: Event): void => {
    const source = event instanceof CustomEvent ? (event.detail as { source?: string } | null)?.source : undefined;
    if (source === 'pause') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    this.show();
  };

  private async launch(kind: 'continue' | 'begin' | 'daily', seed?: number): Promise<void> {
    if (this.launching) return;
    const replacing = kind !== 'continue' && this.saved();
    if (replacing) {
      const agreed = await appDialog.confirm(
        kind === 'daily'
          ? 'Begin today’s descent? Your current descent will be replaced.'
          : 'Start a new descent? Your current descent will be replaced.',
        { title: 'A new descent', confirmText: 'Begin anew', tone: 'danger' },
      );
      if (!agreed) return;
    }
    this.launching = true;
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) button.disabled = true;
    this.root.querySelector('.entry-status')!.textContent = kind === 'continue'
      ? 'Returning to the Works…'
      : launchLine(this.ctx.run?.metaView().runsEnded ?? 0);
    this.ctx.audio.ensure();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      if (!(await this.playReady())) {
        this.root.querySelector('.entry-status')!.textContent = 'The Works could not finish loading. Refresh the page to try again.';
        return;
      }
      const started = this.start(kind, seed);
      if (started.ok) {
        // A chosen seed is for one descent; the next title starts from a random one.
        if (kind === 'begin') { this.chosenSeed = null; this.seed.clear(); }
        this.hide();
        this.ctx.state.paused = false;
      } else this.root.querySelector('.entry-status')!.textContent = started.message;
    } catch (error) {
      this.root.querySelector('.entry-status')!.textContent = `The descent could not open. ${error instanceof Error ? error.message : 'Try again.'}`;
    } finally {
      this.launching = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  private start(kind: 'continue' | 'begin' | 'daily', seed?: number): RunStartResult {
    const ctx = this.ctx;
    if (kind === 'continue' || !ctx.run) {
      return ctx.levels.startRun(ctx, { mode: 'normal', worldSource: 'campaign', continueSave: kind === 'continue', loadout: 'fresh' });
    }
    return ctx.run.startNewRun(ctx, { kit: this.selectedKit, daily: kind === 'daily', difficulty: this.selectedDifficulty, seed, mutators: this.mutators });
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.settings.dispose();
    this.menu.dispose();
    this.root.remove();
  }
}
