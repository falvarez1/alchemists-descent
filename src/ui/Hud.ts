import type { Ctx, PerkId } from '@/core/types';
import { livingObjective } from '@/game/LivingExpedition';
import { canHumiliate } from '@/combat/Trickshot';
import { worksRoomAt } from '@/world/breathingWorks';
import { getBindings, keyLabel } from '@/input/bindings';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { floorLabel } from '@/config/worldgraph';
import { CARD_DEFS } from '@/combat/wands/cards';
import { PERK_DEFS, isPerkActive, togglePerkActive } from '@/content/perks';
import { nextWandSentence } from '@/combat/wands/sentenceView';
import { COLOR_FN, unpackB, unpackG, unpackR } from '@/sim/colors';
import { deathCauseLine, deathTitle } from '@/ui/deathCauses';
import {
  INTRO_OBJECTIVE,
  INTRO_PRE_KEY_OBJECTIVES,
  INTRO_REWARD_CARD,
  introControlHintForObjective,
} from '@/game/introObjectives';
import { cardIconName, makeIconCanvas } from '@/ui/icons';
import { ToastStack } from '@/ui/ToastStack';
import { titleCaseName } from '@/core/strings';
import { FLOOR_LOOKS, floorLookFor } from '@/config/floorLooks';

/** Non-null getElementById — all HUD elements exist statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** How long the "seat it at the bench" line lingers under the objective (ticks). */
const BENCH_NOTE_FRAMES = 720;
const WAYSTONE_OBJECTIVE_RADIUS_SQ = 72 * 72;

/** Centre-card timing: an arrival title holds longer than an event notice. */
const TITLE_HOLD_MS = 3600;
const NOTICE_HOLD_MS = 2600;
/** The card's fade-out (main.css #wave-banner transition) plus a breath before the next. */
const BANNER_GAP_MS = 750;
const MAX_QUEUED_NOTICES = 3;

/**
 * One centre card. Arrival titles always play first and uninterrupted; event
 * notices (waystone lit, first brew, a card found) queue behind them and each
 * other, lowest `priority` first, so nothing stomps anything.
 */
interface BannerCard {
  big: string;
  small: string;
  kicker: string;
  kind: 'title' | 'notice';
  priority: number;
  onShow?: () => void;
}

function introCompletionCardSlotted(ctx: Ctx): boolean {
  const wands = ctx.wands.wands;
  return Array.isArray(wands) && wands.some((wand) => wand.cards.includes(INTRO_REWARD_CARD));
}

/**
 * The objective line. A found card never takes it over: the floor's goal stays
 * the goal, and the bench cue rides underneath it (Hud's objective note).
 */
export function contextualObjectiveText(ctx: Ctx, fallback: string): string {
  if (ctx.state.mode !== 'play') return fallback;
  const runtime = ctx.levels.current;
  if (!runtime) return fallback;
  const living = livingObjective(ctx);
  if (living) return living;
  const nearUnlitWaystone = runtime.waystones.some((waystone) => {
    if (waystone.lit) return false;
    const dx = waystone.x - ctx.player.x;
    const dy = waystone.y - ctx.player.y;
    return dx * dx + dy * dy <= WAYSTONE_OBJECTIVE_RADIUS_SQ;
  });
  if (nearUnlitWaystone && !runtime.keyTaken) return FLOOR_OBJECTIVE_WAYSTONE;
  if (runtime.portal) {
    if (runtime.keyTaken) return INTRO_OBJECTIVE.returnPortal;
    return INTRO_PRE_KEY_OBJECTIVES.has(fallback) && !introCompletionCardSlotted(ctx)
      ? fallback
      : INTRO_OBJECTIVE.findKey;
  }
  return fallback;
}

/** The secondary line under the objective after a card is found. */
export function cardGrantBenchCue(ctx: Ctx, name?: string): string {
  if (ctx.state.mode !== 'play') return 'A new spell card';
  // The bench opens anywhere now — just slot it whenever you like.
  return `Seat ${name ? name : 'the new card'} at the wand bench (B).`;
}

/** Near an unlit waystone on a generated floor (house tone; see introObjectives). */
export const FLOOR_OBJECTIVE_WAYSTONE = 'Bring fire to the waystone to set your return point.';

/** Level title card kicker. A generic hook: the run layer may say "Floor 2 of 4". */
export function levelTitleKicker(depth: number): string {
  return 'Depth ' + depth;
}

// ===================== HUD =====================
/**
 * Play-mode heads-up display: vitals bars, gold readout, spell hotbar,
 * wave banner, damage vignette and the game-over overlay.
 *
 * Gameplay systems never touch the DOM — they emit events on the bus and
 * the Hud (constructed after all systems exist) subscribes here.
 */
export class Hud {
  /** Last flask material rendered (undefined = never rendered), so the palette lookup runs once per change. */
  private flaskMaterial: number | null | undefined = undefined;
  private readonly flaskSlots: Array<{ root: HTMLElement; fill: HTMLElement; count: HTMLElement; name: HTMLElement }> = [];
  private readonly soundCaption = document.createElement('div');
  private readonly toastStack: ToastStack;
  /** Empty slot beside the vitals, reserved for the run layer's return-phial row. */
  private readonly vitalsAside = document.createElement('div');
  /** Trailing "loss" bars behind HP/mana: the chunk you just lost lingers, then drains. */
  private readonly vitalGhosts: Array<{ ghost: HTMLElement; fraction: number; dropAt: number }> = [];
  private readonly bannerKicker = document.createElement('div');
  private readonly bannerRule = document.createElement('div');
  private readonly trickshotReadout = document.createElement('div');
  private captionUntil = 0;
  /** Filled hotbar tiles of the ACTIVE wand (+ costs and slot positions). */
  private hotbarSlots: Array<{ tile: HTMLElement; cost: number; slotIdx: number }> = [];
  /** The active wand's recharge bar fill (rebuilt with the hotbar). */
  private rechargeFill: HTMLElement | null = null;
  /** Readable spell sentence for the active wand's next click. */
  private castCaption: HTMLElement | null = null;
  private readonly godPowerButtons = new Map<PerkId, HTMLButtonElement>();
  /** Rolling gold display: ticks toward the true score instead of snapping. */
  private displayedGold = 0;
  /** Frame the last dry-fire flash started (clears the class after it). */
  private dryFlashUntil = 0;
  private objectiveBase: string = INTRO_OBJECTIVE.findKey;
  private bannerTimer = 0;
  /** An arrival title waiting for the transition curtain to lift. */
  private pendingTitle: BannerCard | null = null;
  private titleFallback = 0;
  /** Notices waiting for the centre card to come free. */
  private readonly bannerQueue: BannerCard[] = [];
  /** performance.now() at which the card on screen has faded and the next may enter. */
  private bannerFreeAt = 0;
  private bannerPump = 0;
  /** Secondary line under the objective (the bench cue after a card is found). */
  private readonly objectiveNote = document.createElement('div');
  private objectiveNoteUntil = 0;
  private objectiveNoteCard: string | null = null;

  // Static HUD nodes resolved once (all exist in index.html). update() runs
  // every other tick (~30Hz), so caching these avoids repeated getElementById
  // lookups on the hottest UI function instead of re-resolving each frame.
  private readonly hpFill = el('hp-fill');
  private readonly manaFill = el('mana-fill');
  private readonly levitFill = el('levit-fill');
  private readonly hudGold = el('hud-gold');
  private readonly keyIndicator = el('key-indicator');
  private readonly hudCards = el('hud-cards');
  private readonly godTools = el('god-tools');
  private readonly flaskFill = el('flask-fill');
  private readonly damageVignette = el('damage-vignette');
  private readonly objectiveNode = el('objective');
  private readonly waveNum = el('wave-num');
  private readonly interactionHintNode = el('interaction-hint');
  private readonly controlsHintNode = el('controls-hint');
  private readonly controlsHintDefaultHtml = this.controlsHintNode.innerHTML;
  private readonly disposers: Array<() => void> = [];
  private readonly timeouts = new Set<number>();

  constructor(private ctx: Ctx) {
    this.trickshotReadout.id = 'trickshot-readout'; this.trickshotReadout.hidden = true;
    el('canvas-holder').appendChild(this.trickshotReadout);
    this.soundCaption.id = 'sound-caption'; this.soundCaption.setAttribute('aria-live', 'polite');
    el('objective').closest('.wave-readout')!.appendChild(this.soundCaption);
    this.objectiveNote.id = 'objective-note';
    this.objectiveNote.setAttribute('aria-live', 'polite');
    el('objective').closest('.objective-row')!.insertAdjacentElement('afterend', this.objectiveNote);
    // Toasts are the right-hand event log: they flow beneath the objective and
    // its caption, so no length of objective can ever overlap them.
    const toastHost = el('toast-stack');
    el('objective').closest('.wave-readout')!.appendChild(toastHost);
    this.toastStack = new ToastStack(toastHost);
    this.vitalsAside.id = 'vitals-aside';
    this.vitalsAside.className = 'vitals-aside';
    el('hud-left').appendChild(this.vitalsAside);
    for (const id of ['hp-fill', 'mana-fill']) {
      const fill = el(id);
      const ghost = document.createElement('div');
      ghost.className = 'vital-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      fill.parentElement!.insertBefore(ghost, fill);
      this.vitalGhosts.push({ ghost, fraction: 1, dropAt: 0 });
    }
    // Title card: a kicker above the name and a copper rule under it.
    const banner = el('wave-banner');
    banner.classList.add('title-card');
    this.bannerKicker.className = 'title-card-kicker';
    this.bannerKicker.id = 'banner-kicker';
    this.bannerRule.className = 'title-card-rule';
    this.bannerRule.setAttribute('aria-hidden', 'true');
    banner.insertBefore(this.bannerKicker, el('banner-big'));
    banner.insertBefore(this.bannerRule, el('banner-small'));
    this.disposers.push(ctx.events.on('habitatSound', ({ kind, x, y }) => {
      if (!ctx.state.creatureCaptions || performance.now() < this.captionUntil) return;
      const direction = Math.abs(x - ctx.player.x) < 35 ? (y < ctx.player.y - 30 ? 'above' : 'nearby') : x < ctx.player.x ? 'left' : 'right';
      this.soundCaption.textContent = `${kind === 'weaver' ? 'Dry claws tapping' : 'A body sliding through water'} · ${direction}`;
      this.captionUntil = performance.now() + 1500;
      this.setHudTimeout(() => { this.soundCaption.textContent = ''; }, 1500);
    }));
    const tools = el('expedition-tools');
    tools.append(el('spell-hotbar'), el('flask-belt'), el('field-note'));
    // Treasure-row pixel icons (hud-gold itself rolls toward the score in
    // update() — income you can watch).
    const goldIconHost = el('gold-chip-icon');
    goldIconHost.replaceChildren();
    const goldIcon = makeIconCanvas('gold', 2);
    if (goldIcon) goldIconHost.appendChild(goldIcon);
    const tomeIconHost = el('cards-chip-icon');
    tomeIconHost.replaceChildren();
    const tomeIcon = makeIconCanvas('tome', 2);
    if (tomeIcon) tomeIconHost.appendChild(tomeIcon);
    this.buildFlaskBelt();
    this.buildGodTools();

    // Dry fire: the mana bar itself flinches red so the WHY is unmissable.
    this.disposers.push(ctx.events.on('dryFire', () => {
      this.dryFlashUntil = this.ctx.state.frameCount + 18;
      el('mana-fill').parentElement?.classList.add('mana-dry');
    }));
    // CRAMPED: the crawler wants to stand but the ceiling says no — a small
    // glyph under the meters for as long as the world refuses (CRAWL.md).
    this.disposers.push(ctx.events.on('crampedChanged', ({ cramped }) => {
      el('cramped-glyph').classList.toggle('visible', cramped);
    }));

    // Same language for refused flask verbs: the FLSK track flinches.
    this.disposers.push(ctx.events.on('flaskDry', () => {
      const track = el('flask-fill').parentElement;
      track?.classList.remove('mana-dry');
      void track?.offsetWidth; // restart the one-shot animation
      track?.classList.add('mana-dry');
      this.setHudTimeout(() => track?.classList.remove('mana-dry'), 320);
    }));

    // The descent: depth readout + one house-style title card on every arrival
    // (the hand-built Works included), with the floor's own epigraph.
    // The card waits for the transition curtain to lift, so its entrance
    // plays in view rather than behind the veil (with a fallback if no
    // curtain comes down, e.g. an in-place restore).
    this.disposers.push(ctx.events.on('levelChanged', ({ depth, name }) => {
      // Campaign floors read "Floor 2 of 4"; off-spine arenas keep the depth code.
      const floor = floorLabel(ctx.levels.current?.def.id);
      el('wave-num').textContent = floor || 'D' + depth;
      const look = ctx.levels.current ? floorLookFor(ctx) : FLOOR_LOOKS.earthen;
      this.pendingTitle = {
        big: titleCaseName(name), small: look.epigraph, kicker: floor || levelTitleKicker(depth), kind: 'title', priority: 0,
      };
      window.clearTimeout(this.titleFallback);
      this.titleFallback = this.setHudTimeout(() => this.revealPendingTitle(), 1600);
    }));
    this.disposers.push(ctx.events.on('levelCurtain', ({ visible, holdMs = 0 }) => {
      if (visible || !this.pendingTitle) return;
      window.clearTimeout(this.titleFallback);
      this.titleFallback = this.setHudTimeout(() => this.revealPendingTitle(), holdMs + 120);
    }));

    // Event notices: sentence case, smaller than a title, queued behind it.
    this.disposers.push(ctx.events.on('waystoneLit', () => {
      this.queueNotice({ kicker: 'Checkpoint', big: 'Waystone lit', small: 'You will return here. Vitals restored.', priority: 1 });
    }));

    this.disposers.push(ctx.events.on('recipeDiscovered', ({ name, bounty }) => {
      this.queueNotice({ kicker: 'A first brew', big: titleCaseName(name), small: `Written into the Grimoire. +${bounty} oz`, priority: 2 });
    }));

    // Wandsmith: a found card announces itself once the centre is free; the
    // bench cue rides under the objective (never replacing it) while the card
    // waits in the satchel. The satchel chip flashes so the income lands in
    // the treasure row too.
    this.disposers.push(ctx.events.on('cardGranted', ({ name }) => {
      const chip = el('cards-chip');
      chip.classList.remove('flash');
      void chip.offsetWidth; // restart the one-shot animation
      chip.classList.add('flash');
      this.queueNotice({
        kicker: 'A new spell card', big: name, small: 'Tucked into the satchel.', priority: 3,
        onShow: () => this.showObjectiveNote(cardGrantBenchCue(this.ctx, name), name),
      });
    }));

    // Descent meta layer: the objective line + short center toasts.
    this.disposers.push(ctx.events.on('objectiveChanged', ({ text }) => {
      this.objectiveBase = text;
      this.renderObjective();
    }));

    // Victory (the Kiln Colossus) is the run ledger's job now (ui/RunSummary):
    // no overlay here, and no page reload to start again.
    this.disposers.push(ctx.events.on('toast', ({ text }) => this.toastStack.push(text)));

    // The hotbar mirrors the active wand; any loadout change rebuilds it.
    this.disposers.push(ctx.events.on('wandChanged', () => this.buildHotbar()));

    this.disposers.push(ctx.events.on('playerDied', ({ depth, level, gold, cause }) => {
      // Prep the overlay text but DON'T show it yet — the wizard ragdolls first.
      el('go-wave').textContent = 'D' + depth + ' - ' + level.toUpperCase();
      el('go-gold').textContent = String(gold);
      el('go-cause').textContent = deathCauseLine(cause, this.ctx.state.frameCount);
      el('death-title').textContent = deathTitle(cause);
    }));
    // The directed death (game/DeathCinema): letterbox bars slide in and the
    // HUD recedes; the title card waits for its beat AND a body at rest. A
    // failsafe still offers the way back if the cinema never reaches its title.
    const letterbox = document.createElement('div');
    letterbox.id = 'death-letterbox';
    letterbox.setAttribute('aria-hidden', 'true');
    el('canvas-holder').appendChild(letterbox);
    this.disposers.push(() => letterbox.remove());
    const revealDeath = (): void => {
      const overlay = el('gameover-overlay');
      if (overlay.classList.contains('visible')) return;
      overlay.classList.add('visible', 'cine');
      el('respawn-btn').focus({ preventScroll: true });
    };
    const clearDeath = (): void => {
      document.body.classList.remove('death-cine');
      el('gameover-overlay').classList.remove('visible', 'cine');
    };
    this.disposers.push(ctx.events.on('deathCinema', ({ phase }) => {
      if (phase === 'begin') document.body.classList.add('death-cine');
      else if (phase === 'title') revealDeath();
      else clearDeath();
    }));
    this.disposers.push(ctx.events.on('playerCorpseSettled', () => {
      this.setHudTimeout(() => { if (this.ctx.player.dead) revealDeath(); }, 6000);
    }));

    this.disposers.push(ctx.events.on('playerRespawned', clearDeath));
    this.disposers.push(ctx.events.on('playerDeathCleared', clearDeath));

    this.disposers.push(ctx.events.on('modeChanged', ({ mode }) => {
      el('mode-build-btn').classList.toggle('active', mode === 'build');
      el('mode-play-btn').classList.toggle('active', mode === 'play');
      el('game-hud').classList.toggle('visible', mode === 'play');
      document.body.classList.toggle('play-active', mode === 'play');
      if (mode !== 'play') el('damage-vignette').style.opacity = '0';
      this.buildHotbar();
    }));

    const onRespawn = (): void => { ctx.audio.ensure(); ctx.playerCtl.respawn(); };
    el('respawn-btn').addEventListener('click', onRespawn);
    this.disposers.push(() => el('respawn-btn').removeEventListener('click', onRespawn));
  }

  dispose(): void {
    this.soundCaption.remove();
    this.objectiveNote.remove();
    this.bannerQueue.length = 0;
    this.pendingTitle = null;
    this.toastStack.clear();
    this.vitalsAside.remove();
    for (const { ghost } of this.vitalGhosts.splice(0)) ghost.remove();
    this.bannerKicker.remove();
    this.bannerRule.remove();
    el('wave-banner').classList.remove('title-card', 'level', 'show');
    this.trickshotReadout.remove();
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const timeout of this.timeouts) window.clearTimeout(timeout);
    this.timeouts.clear();
    el('gold-chip-icon').replaceChildren();
    el('cards-chip-icon').replaceChildren();
    this.godTools.replaceChildren();
    this.godPowerButtons.clear();
  }

  private setHudTimeout(callback: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.timeouts.delete(id);
      callback();
    }, ms);
    this.timeouts.add(id);
    return id;
  }

  private buildFlaskBelt(): void {
    const belt = el('flask-belt');
    belt.replaceChildren();
    for (let i = 0; i < this.ctx.flask.slots.length; i++) {
      const root = document.createElement('div');
      root.className = 'flask-slot';
      root.title = `Flask ${i + 1}`;
      const fill = document.createElement('div');
      fill.className = 'flask-slot-fill';
      const key = document.createElement('div');
      key.className = 'flask-slot-key';
      key.textContent = String(i + 3);
      const count = document.createElement('div');
      count.className = 'flask-slot-count';
      count.textContent = '0';
      const name = document.createElement('div'); name.className = 'flask-slot-name';
      root.append(fill, key, count, name);
      belt.appendChild(root);
      this.flaskSlots.push({ root, fill, count, name });
    }
  }

  /** The arrival title plays now, uninterrupted; queued notices wait for it. */
  private revealPendingTitle(): void {
    const card = this.pendingTitle;
    if (!card) return;
    this.pendingTitle = null;
    this.showBanner(card);
  }

  /**
   * Queue an event notice. Pumped on a fresh task, never synchronously: a card
   * granted inside the same `levelChanged` dispatch as an arrival must still
   * see the arrival's title first (WandSystem hears that event before the Hud).
   */
  private queueNotice(notice: Omit<BannerCard, 'kind'>): void {
    if (this.bannerQueue.some((queued) => queued.big === notice.big && queued.kicker === notice.kicker)) return;
    this.bannerQueue.push({ ...notice, kind: 'notice' });
    // Stable by priority: a checkpoint reads before the card it paid out.
    this.bannerQueue.sort((a, b) => a.priority - b.priority);
    if (this.bannerQueue.length > MAX_QUEUED_NOTICES) this.bannerQueue.length = MAX_QUEUED_NOTICES;
    this.scheduleBannerPump(0);
  }

  private scheduleBannerPump(ms: number): void {
    window.clearTimeout(this.bannerPump);
    this.bannerPump = this.setHudTimeout(() => this.pumpBanners(), Math.max(0, ms));
  }

  private pumpBanners(): void {
    // An arrival waiting on its curtain goes first; its reveal pumps after it.
    if (this.pendingTitle || this.bannerQueue.length === 0) return;
    const wait = this.bannerFreeAt - performance.now();
    if (wait > 0) {
      this.scheduleBannerPump(wait);
      return;
    }
    const next = this.bannerQueue.shift();
    if (next) this.showBanner(next);
  }

  /**
   * The centre card. Level arrivals get the full title treatment (kicker,
   * tracked serif name, copper rule, epigraph) and hold longer; event notices
   * (waystone lit, a first brew, a card found) use the same house style,
   * smaller and in sentence case.
   */
  private showBanner(card: BannerCard): void {
    const title = card.kind === 'title';
    el('banner-big').textContent = card.big;
    el('banner-small').textContent = card.small;
    this.bannerKicker.textContent = card.kicker;
    const banner = el('wave-banner');
    banner.classList.remove('show');
    banner.classList.toggle('level', title);
    banner.classList.toggle('notice', !title);
    void banner.offsetWidth; // restart the entrance choreography
    banner.classList.add('show');
    const hold = title ? TITLE_HOLD_MS : NOTICE_HOLD_MS;
    this.bannerFreeAt = performance.now() + hold + BANNER_GAP_MS;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = this.setHudTimeout(() => {
      banner.classList.remove('show');
      if (this.bannerQueue.length > 0) this.scheduleBannerPump(BANNER_GAP_MS);
    }, hold);
    card.onShow?.();
  }

  /** A quiet second line under the objective; the objective itself never changes for it. */
  private showObjectiveNote(text: string, card: string | null): void {
    this.objectiveNote.textContent = text;
    this.objectiveNoteCard = card;
    this.objectiveNoteUntil = this.ctx.state.frameCount + BENCH_NOTE_FRAMES;
    this.objectiveNote.classList.remove('shown');
    void this.objectiveNote.offsetWidth;
    this.objectiveNote.classList.add('shown');
  }

  private renderObjectiveNote(): void {
    if (!this.objectiveNote.classList.contains('shown')) return;
    // Seated already (it left the satchel), or its moment has passed.
    const seated = this.objectiveNoteCard !== null &&
      !this.ctx.wands.collection.some((id) => CARD_DEFS[id]?.name === this.objectiveNoteCard);
    if (seated || this.ctx.state.frameCount > this.objectiveNoteUntil || this.ctx.state.mode !== 'play') {
      this.objectiveNote.classList.remove('shown');
      this.objectiveNoteCard = null;
    }
  }

  private buildGodTools(): void {
    this.godTools.replaceChildren();
    this.godPowerButtons.clear();

    const actions = document.createElement('div');
    actions.className = 'god-tools-actions';
    const shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.className = 'god-tool-btn';
    shuffle.textContent = 'RESHUFFLE CARDS';
    shuffle.title = 'God mode: reshuffle active wand cards without opening the bench';
    shuffle.addEventListener('click', () => {
      if (!this.ctx.state.debugGodMode) return;
      this.ctx.wands.debugShuffleLoadout();
    });
    actions.appendChild(shuffle);
    this.godTools.appendChild(actions);

    const powers = document.createElement('div');
    powers.className = 'god-power-row';
    for (const perk of PERK_DEFS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'god-power';
      chip.textContent = perk.shortLabel;
      chip.title = perk.name;
      chip.setAttribute('aria-label', perk.shortLabel + ' power');
      chip.addEventListener('click', () => {
        if (!this.ctx.state.debugGodMode) return;
        const enabled = togglePerkActive(this.ctx, perk.id);
        this.ctx.events.emit('toast', { text: perk.shortLabel + (enabled ? ' POWER READY' : ' POWER OFF') });
        this.renderGodTools(this.ctx);
      });
      this.godPowerButtons.set(perk.id, chip);
      powers.appendChild(chip);
    }
    this.godTools.appendChild(powers);
  }

  private renderGodTools(ctx: Ctx): void {
    const visible = ctx.state.mode === 'play' && ctx.state.debugGodMode === true;
    this.godTools.classList.toggle('visible', visible);
    this.godTools.setAttribute('aria-hidden', visible ? 'false' : 'true');
    for (const perk of PERK_DEFS) {
      const button = this.godPowerButtons.get(perk.id);
      if (!button) continue;
      const active = isPerkActive(ctx, perk.id);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private renderObjective(): void {
    const text = contextualObjectiveText(this.ctx, this.objectiveBase);
    const node = this.objectiveNode;
    if (node.textContent !== text) node.textContent = text;
    this.renderObjectiveNote();
    this.renderIntroControlHint(text);
  }

  private renderIntroControlHint(objectiveText: string): void {
    const hint = introControlHintForObjective(objectiveText);
    const node = this.controlsHintNode;
    if (!hint || this.ctx.state.mode !== 'play') {
      if (node.dataset.introHint === 'true') {
        node.innerHTML = this.controlsHintDefaultHtml;
        node.dataset.introHint = 'false';
        delete node.dataset.introHintKey;
      }
      return;
    }
    const key = hint.map((part) => `${part.key}:${part.label}`).join('|');
    if (node.dataset.introHint === 'true' && node.dataset.introHintKey === key) return;
    node.replaceChildren();
    hint.forEach((part, index) => {
      if (index > 0) node.appendChild(document.createTextNode('  ·  '));
      const keyNode = document.createElement('b');
      keyNode.textContent = part.key;
      node.appendChild(keyNode);
      node.appendChild(document.createTextNode(' ' + part.label));
    });
    node.dataset.introHint = 'true';
    node.dataset.introHintKey = key;
  }

  /**
   * The loss ghost holds a lost chunk for a beat, then drains (house.css
   * transition). Only losses animate; gains (regen, drinks) snap the ghost up
   * under the fill once any drain in flight has finished, so a trickle of
   * regeneration never restarts — and stalls — the drain.
   */
  private updateVitalGhost(index: number, fraction: number): void {
    const entry = this.vitalGhosts[index];
    if (!entry) return;
    const next = Math.max(0, Math.min(1, fraction));
    const now = performance.now();
    if (next < entry.fraction - 0.002) {
      entry.fraction = next;
      entry.dropAt = now;
      entry.ghost.classList.remove('snap');
    } else if (next > entry.fraction + 0.002 && now - entry.dropAt > 900) {
      entry.fraction = next;
      entry.ghost.classList.add('snap');
    } else {
      return;
    }
    entry.ghost.style.width = `calc((100% - 4px) * ${next.toFixed(4)})`;
  }

  /** Tier-2 contextual hint: the nearest interactable's "what to do" line. */
  private renderInteractionHint(ctx: Ctx): void {
    const hint = ctx.hints.current;
    const note = hint?.key === 'works-cold-lock';
    const anchored = (hint?.key === 'works-valve' || note) && hint.world;
    const controller = anchored && !note && Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.connected);
    const text = anchored && !note ? `${controller ? 'X' : keyLabel(getBindings().interact)} · Turn valve` : hint?.line ?? '';
    const node = this.interactionHintNode;
    if (node.textContent !== text) node.textContent = text;
    node.classList.toggle('visible', text !== '');
    node.classList.toggle('world-anchor', Boolean(anchored));
    node.classList.toggle('wide', Boolean(anchored && note));
    if (anchored) {
      const width = node.parentElement!.clientWidth, height = node.parentElement!.clientHeight;
      const x = (anchored.x - ctx.camera.renderX + 26) / VIEW_W * width;
      const y = (anchored.y - ctx.camera.renderY - 25) / VIEW_H * height;
      node.style.left = `${Math.max(10, Math.min(width - (note ? 275 : 165), x))}px`;
      node.style.top = `${Math.max(70, Math.min(height - 90, y))}px`;
    } else { node.style.removeProperty('left'); node.style.removeProperty('top'); }
  }

  /**
   * Wandsmith (Wave D): the play-mode hotbar mirrors the ACTIVE WAND — its
   * name as a label, then one tile per frame slot (empty = dim). Cards are
   * not selectable in play (the program runs left-to-right; the bench owns
   * editing), so the tiles carry no click handlers and no digit keys.
   */
  /**
   * The hotbar shows BOTH wands: the active one full size with the cast
   * cursor riding its cards (each click casts the next group left-to-right,
   * then wraps), the holstered one beneath, dimmed — so the wheel/1/2 swap
   * reads as "switching wands", not rows teleporting.
   */
  buildHotbar(): void {
    const bar = el('spell-hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];
    this.castCaption = null;

    const wands = this.ctx.wands;
    for (const wi of [wands.active, (1 - wands.active) as 0 | 1]) {
      const wand = wands.wands[wi];
      const isActive = wi === wands.active;

      const label = document.createElement('div');
      label.className = 'wand-label' + (isActive ? '' : ' holstered');
      label.textContent =
        (wi === 0 ? 'I · ' : 'II · ') + wand.frame.name + (isActive ? '' : '   (wheel / ' + (wi + 1) + ')');
      bar.appendChild(label);

      const row = document.createElement('div');
      row.className = 'wand-slots' + (isActive ? '' : ' holstered');
      if (!isActive) {
        row.title = 'Holstered — mouse wheel or key ' + (wi + 1) + ' to draw';
        row.addEventListener('click', () => {
          this.ctx.wands.active = wi;
          this.ctx.events.emit('wandChanged');
        });
      }
      wand.cards.forEach((id, slotIdx) => {
        const slot = document.createElement('div');
        slot.className = 'hot-slot';
        if (id === null) {
          slot.classList.add('empty');
          slot.title = 'Empty slot';
        } else {
          const def = CARD_DEFS[id];
          slot.title = def.name + ' — ' + def.manaCost + ' mana';
          const icon = makeIconCanvas(cardIconName(id), isActive ? 3 : 2);
          if (icon) slot.appendChild(icon);
          if (isActive) {
            const cost = document.createElement('div');
            cost.className = 'cost';
            cost.textContent = String(def.manaCost);
            slot.appendChild(cost);
            this.hotbarSlots.push({ tile: slot, cost: def.manaCost, slotIdx });
          }
        }
        row.appendChild(slot);
      });
      bar.appendChild(row);

      // Cast rhythm bar: drains over the cooldown — a short blip between
      // cards, a long visible draw when the cycle wraps into recharge.
      if (isActive) {
        const caption = document.createElement('div');
        caption.className = 'wand-cast-caption';
        bar.appendChild(caption);
        this.castCaption = caption;

        const track = document.createElement('div');
        track.className = 'wand-recharge';
        const fill = document.createElement('div');
        fill.className = 'wand-recharge-fill';
        track.appendChild(fill);
        bar.appendChild(track);
        this.rechargeFill = fill;
      }
    }
  }

  update(ctx: Ctx): void {
    const trick = ctx.fx.trickshot;
    this.trickshotReadout.hidden = !ctx.state.trickshot?.enabled || !trick || trick.labelMs <= 0 || ctx.player.dead;
    const trickText = trick && trick.labelMs > 0 ? trick.label : '';
    if (this.trickshotReadout.textContent !== trickText) this.trickshotReadout.textContent = trickText;
    this.trickshotReadout.classList.toggle('finisher', trickText === 'RETURNED WITH INTEREST');
    const player = ctx.player;
    el('spell-hotbar').style.display = player.legClub ? 'none' : '';
    this.renderObjective();
    this.renderInteractionHint(ctx);
    this.renderGodTools(ctx);
    this.hpFill.style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
    // player.mana mirrors the active wand's tank (WandSystem guarantee), so
    // the mana bar tracks the wand with no extra wiring here.
    this.manaFill.style.width = Math.max(0, (player.mana / player.maxMana) * 100) + '%';
    this.levitFill.style.width = Math.max(0, (player.levit / player.maxLevit) * 100) + '%';
    this.updateVitalGhost(0, player.hp / player.maxHp);
    this.updateVitalGhost(1, player.mana / player.maxMana);

    // Critical-state bar language: HP pulses near death, LEV blinks on fumes,
    // the mana track recovers from its dry-fire flinch.
    this.hpFill.classList.toggle('critical', !player.dead && player.hp / player.maxHp < 0.25);
    this.hpFill.parentElement?.setAttribute('aria-label', `Health ${Math.ceil(player.hp)} of ${player.maxHp}`);
    const rt = ctx.levels.current;
    // One voice for the place name: D1 names rooms in title case, so the
    // generated floors do too ("Fungal Deep", not "FUNGAL DEEP").
    const place = rt?.living ? worksRoomAt(player.x, player.y).name : titleCaseName(rt?.def.name ?? '');
    if (this.waveNum.textContent !== place) this.waveNum.textContent = place;
    const bindings = getBindings();
    el('field-note').textContent = player.legClub
      ? `Weaver leg · ${player.legClub.durability} hits left · LMB/${keyLabel(bindings.kick)} ${ctx.enemies.some(e => canHumiliate(ctx, e) && Math.hypot(e.x - player.x, e.y - player.y) < 100) ? 'Finish its owner' : 'Whip'} · RMB Throw · ${keyLabel(bindings.carry)} Drop`
      : rt?.living
      ? `${keyLabel(bindings.lure)} Glowseed · ${rt.living.glowseeds} left${rt.living.room === 'refuge' ? ' · B Wand bench' : ''}`
      : '1 / 2 Swap wand · M Map · H Handbook';
    this.levitFill.classList.toggle('low', player.levit / player.maxLevit < 0.2);
    if (this.dryFlashUntil && ctx.state.frameCount > this.dryFlashUntil) {
      this.manaFill.parentElement?.classList.remove('mana-dry');
      this.dryFlashUntil = 0;
    }

    // Rolling gold: income ticks up, losses tick down — both watchable.
    const goldTarget = ctx.state.score;
    if (this.displayedGold !== goldTarget) {
      const step = Math.ceil(Math.abs(goldTarget - this.displayedGold) * 0.18);
      this.displayedGold += Math.sign(goldTarget - this.displayedGold) * step;
      this.hudGold.textContent = String(this.displayedGold);
      this.hudGold.classList.add('rolling');
    } else {
      this.hudGold.classList.remove('rolling');
    }

    // The golden key rides the HUD once held — you never wonder again.
    this.keyIndicator.classList.toggle('visible', ctx.levels.current?.keyTaken === true);

    // Satchel count: spell cards collected from tomes, waystones, descents.
    const cards = String(ctx.wands.collection.length);
    const cardsEl = this.hudCards;
    if (cardsEl.textContent !== cards) cardsEl.textContent = cards;

    const flask = ctx.flask.state;
    const flaskFill = this.flaskFill;
    flaskFill.style.width = Math.max(0, (flask.count / flask.capacity) * 100) + '%';
    flaskFill.classList.toggle('flask-sloshing', flask.count > 0);
    if (flask.material !== this.flaskMaterial) {
      this.flaskMaterial = flask.material;
      if (flask.material === null) {
        flaskFill.style.backgroundColor = '';
        flaskFill.title = 'Empty flask';
      } else {
        const c = COLOR_FN[flask.material]();
        flaskFill.style.backgroundColor = 'rgb(' + unpackR(c) + ', ' + unpackG(c) + ', ' + unpackB(c) + ')';
        flaskFill.title = ctx.params.materials[flask.material]?.name ?? 'Unknown material';
      }
    }
    for (let i = 0; i < this.flaskSlots.length; i++) {
      const slot = ctx.flask.slots[i];
      const rendered = this.flaskSlots[i];
      const pct = Math.max(0, Math.min(1, slot.count / slot.capacity));
      rendered.root.classList.toggle('active', i === ctx.flask.activeIndex);
      rendered.fill.style.height = `${pct * 100}%`;
      rendered.count.textContent = slot.count > 0 ? String(slot.count) : '';
      if (slot.material === null || slot.count === 0) {
        rendered.fill.style.backgroundColor = '';
        rendered.root.title = `Flask ${i + 1}: Empty`;
        rendered.name.textContent = 'Empty';
      } else {
        const c = COLOR_FN[slot.material]();
        rendered.fill.style.backgroundColor = 'rgb(' + unpackR(c) + ', ' + unpackG(c) + ', ' + unpackB(c) + ')';
        const name = ctx.params.materials[slot.material]?.name ?? 'Unknown material';
        rendered.root.title = `Flask ${i + 1}: ${name} (${slot.count}/${slot.capacity})`;
        rendered.name.textContent = name === 'Liquid Nitrogen' ? 'Nitrogen' : name;
      }
    }

    const hurt = 1 - (player.hp / player.maxHp);
    this.damageVignette.style.opacity = String(player.dead ? 0.22 : Math.max(0, (hurt - 0.4) * 1.3));

    // Cast cursor: the cards the NEXT click will fire pulse amber, so the
    // left-to-right cast cycle is something you can watch, not guess at.
    const wand = ctx.wands.wands[ctx.wands.active];
    const cooling = wand.cooldown > 0;
    const next = ctx.wands.nextCastSlots();
    const sentence = nextWandSentence(wand.cards, wand.castIndex);
    const groupUnaffordable = player.mana < sentence.manaCost;
    if (this.castCaption) {
      this.castCaption.textContent = groupUnaffordable
        ? sentence.label.replace(/^Next: /, '') + ' · Needs ' + sentence.manaCost + ' mana'
        : sentence.label.replace(/^Next: /, '') + ' · ' + sentence.manaCost + ' mana';
      this.castCaption.classList.toggle('overmana', groupUnaffordable);
    }
    for (const s of this.hotbarSlots) {
      const isNext = !cooling && next.includes(s.slotIdx);
      s.tile.classList.toggle('unaffordable', isNext ? groupUnaffordable : player.mana < s.cost);
      s.tile.classList.toggle('next-cast', isNext);
    }
    // Recharge bar: drains while the wand catches its breath
    if (this.rechargeFill) {
      const max = wand.cooldownMax ?? 0;
      this.rechargeFill.style.width =
        cooling && max > 0 ? Math.min(100, (wand.cooldown / max) * 100) + '%' : '0%';
    }
  }
}
