import type { Ctx } from '@/core/types';
import { CARD_DEFS } from '@/combat/wands/cards';
import { nextWandSentence } from '@/combat/wands/sentenceView';
import { COLOR_FN, unpackB, unpackG, unpackR } from '@/sim/colors';
import { cardIconName, makeIconCanvas } from '@/ui/icons';

/** Non-null getElementById — all HUD elements exist statically in index.html. */
function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

const BENCH_OBJECTIVE_FRAMES = 720;
const WAYSTONE_OBJECTIVE_RADIUS_SQ = 72 * 72;

export function contextualObjectiveText(ctx: Ctx, fallback: string, benchNudgeFrames = 0): string {
  if (ctx.state.mode !== 'play') return fallback;
  const runtime = ctx.levels.current;
  if (!runtime) return fallback;
  if (benchNudgeFrames > 0 && runtime.refuge && ctx.wands.collection.length > 0) return 'BENCH AVAILABLE IN REFUGE';
  const nearUnlitWaystone = runtime.waystones.some((waystone) => {
    if (waystone.lit) return false;
    const dx = waystone.x - ctx.player.x;
    const dy = waystone.y - ctx.player.y;
    return dx * dx + dy * dy <= WAYSTONE_OBJECTIVE_RADIUS_SQ;
  });
  if (nearUnlitWaystone && !runtime.keyTaken) return 'LIGHT WAYSTONE: BRING FIRE';
  if (runtime.portal) return runtime.keyTaken ? 'RETURN TO THE PORTAL' : 'FIND THE GOLDEN KEY';
  return fallback;
}

export function cardGrantBenchCue(ctx: Ctx): string {
  if (ctx.state.mode !== 'play') return 'NEW SPELL CARD';
  const refuge = ctx.levels.current?.refuge;
  if (!refuge) return 'NEW SPELL CARD - FIND REFUGE';
  const dx = refuge.x - ctx.player.x;
  const dy = refuge.y - ctx.player.y;
  const dist = Math.max(1, Math.round(Math.hypot(dx, dy)));
  if (dist <= 48) return 'BENCH AVAILABLE IN REFUGE';
  const dirs: string[] = [];
  if (Math.abs(dx) > 18) dirs.push(dx > 0 ? 'EAST' : 'WEST');
  if (Math.abs(dy) > 18) dirs.push(dy > 0 ? 'BELOW' : 'ABOVE');
  return 'BENCH IN REFUGE' + (dirs.length > 0 ? ' ' + dirs.join(' ') : '') + ' - ' + dist + ' STEPS';
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
  private readonly flaskSlots: Array<{ root: HTMLElement; fill: HTMLElement; count: HTMLElement }> = [];
  /** Filled hotbar tiles of the ACTIVE wand (+ costs and slot positions). */
  private hotbarSlots: Array<{ tile: HTMLElement; cost: number; slotIdx: number }> = [];
  /** The active wand's recharge bar fill (rebuilt with the hotbar). */
  private rechargeFill: HTMLElement | null = null;
  /** Readable spell sentence for the active wand's next click. */
  private castCaption: HTMLElement | null = null;
  /** Rolling gold display: ticks toward the true score instead of snapping. */
  private displayedGold = 0;
  /** Frame the last dry-fire flash started (clears the class after it). */
  private dryFlashUntil = 0;
  private objectiveBase = 'FIND THE GOLDEN KEY';
  private benchObjectiveUntil = 0;

  // Static HUD nodes resolved once (all exist in index.html). update() runs
  // every other tick (~30Hz), so caching these avoids repeated getElementById
  // lookups on the hottest UI function instead of re-resolving each frame.
  private readonly hpFill = el('hp-fill');
  private readonly manaFill = el('mana-fill');
  private readonly levitFill = el('levit-fill');
  private readonly hudGold = el('hud-gold');
  private readonly keyIndicator = el('key-indicator');
  private readonly hudCards = el('hud-cards');
  private readonly flaskFill = el('flask-fill');
  private readonly damageVignette = el('damage-vignette');
  private readonly objectiveNode = el('objective');
  private readonly interactionHintNode = el('interaction-hint');
  private readonly disposers: Array<() => void> = [];
  private readonly timeouts = new Set<number>();

  constructor(private ctx: Ctx) {
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

    this.disposers.push(ctx.events.on('waveStarted', ({ num }) => {
      el('wave-num').textContent = 'WAVE ' + num;
    }));

    this.disposers.push(ctx.events.on('waveBanner', ({ big, small }) => this.showBanner(big, small)));

    // The descent: depth readout + arrival banner whenever a level is entered.
    this.disposers.push(ctx.events.on('levelChanged', ({ depth, name }) => {
      el('wave-num').textContent = 'D' + depth;
      this.showBanner('D' + depth + ' — ' + name, 'THE DESCENT CONTINUES');
    }));

    this.disposers.push(ctx.events.on('waystoneLit', () => {
      this.showBanner('WAYSTONE LIT', 'CHECKPOINT SET — VITALS RESTORED');
    }));

    this.disposers.push(ctx.events.on('recipeDiscovered', ({ name, bounty }) => {
      this.showBanner(name + ' BREWED', 'GRIMOIRE UPDATED — +' + bounty + ' oz');
    }));

    // Wandsmith: a found card announces itself; the bench (B) slots it.
    // The satchel chip flashes so the income lands in the treasure row too.
    this.disposers.push(ctx.events.on('cardGranted', ({ name }) => {
      this.showBanner(name + ' ACQUIRED', cardGrantBenchCue(this.ctx));
      this.benchObjectiveUntil = this.ctx.state.frameCount + BENCH_OBJECTIVE_FRAMES;
      this.ctx.events.emit('refugePing');
      this.renderObjective();
      const chip = el('cards-chip');
      chip.classList.remove('flash');
      void chip.offsetWidth; // restart the one-shot animation
      chip.classList.add('flash');
    }));

    // Descent meta layer: the objective line + short center toasts.
    this.disposers.push(ctx.events.on('objectiveChanged', ({ text }) => {
      this.objectiveBase = text;
      this.renderObjective();
    }));

    // The Kiln Colossus is slain: roll victory after the explosion lands.
    this.disposers.push(ctx.events.on('runComplete', ({ gold }) => {
      this.setHudTimeout(() => {
        el('vic-gold').textContent = String(gold);
        el('victory-overlay').classList.add('visible');
        ctx.state.paused = true;
        ctx.audio.learn();
      }, 1400);
    }));
    const onVictoryReturn = (): void => window.location.reload();
    el('vic-return').addEventListener('click', onVictoryReturn);
    this.disposers.push(() => el('vic-return').removeEventListener('click', onVictoryReturn));
    this.disposers.push(ctx.events.on('toast', ({ text }) => {
      const stack = el('toast-stack');
      const node = document.createElement('div');
      node.className = 'toast';
      node.textContent = text;
      stack.appendChild(node);
      while (stack.children.length > 4) stack.removeChild(stack.firstChild!);
      this.setHudTimeout(() => node.remove(), 2700);
    }));

    // The hotbar mirrors the active wand; any loadout change rebuilds it.
    this.disposers.push(ctx.events.on('wandChanged', () => this.buildHotbar()));

    this.disposers.push(ctx.events.on('enemiesLeft', ({ count }) => {
      el('enemies-left').textContent = String(count);
    }));

    this.disposers.push(ctx.events.on('playerDied', ({ depth, level, gold }) => {
      // Prep the overlay text but DON'T show it yet — the wizard ragdolls first.
      el('go-wave').textContent = 'D' + depth + ' - ' + level.toUpperCase();
      el('go-gold').textContent = String(gold);
    }));
    this.disposers.push(ctx.events.on('playerCorpseSettled', () => {
      // The corpse has come to rest (tombstone is up) — now offer the respawn.
      el('gameover-overlay').classList.add('visible');
    }));

    this.disposers.push(ctx.events.on('playerRespawned', () => {
      el('gameover-overlay').classList.remove('visible');
    }));
    this.disposers.push(ctx.events.on('playerDeathCleared', () => {
      el('gameover-overlay').classList.remove('visible');
    }));

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
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const timeout of this.timeouts) window.clearTimeout(timeout);
    this.timeouts.clear();
    el('gold-chip-icon').replaceChildren();
    el('cards-chip-icon').replaceChildren();
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
      root.append(fill, key, count);
      belt.appendChild(root);
      this.flaskSlots.push({ root, fill, count });
    }
  }

  private showBanner(big: string, small: string): void {
    el('banner-big').textContent = big;
    el('banner-small').textContent = small;
    const banner = el('wave-banner');
    banner.classList.add('show');
    this.setHudTimeout(() => banner.classList.remove('show'), 2200);
  }

  private renderObjective(): void {
    const left = Math.max(0, this.benchObjectiveUntil - this.ctx.state.frameCount);
    const text = contextualObjectiveText(this.ctx, this.objectiveBase, left);
    const node = this.objectiveNode;
    if (node.textContent !== text) node.textContent = text;
  }

  /** Tier-2 contextual hint: the nearest interactable's "what to do" line. */
  private renderInteractionHint(ctx: Ctx): void {
    const text = ctx.hints.current?.line ?? '';
    const node = this.interactionHintNode;
    if (node.textContent !== text) node.textContent = text;
    node.classList.toggle('visible', text !== '');
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
    const player = ctx.player;
    this.renderObjective();
    this.renderInteractionHint(ctx);
    this.hpFill.style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
    // player.mana mirrors the active wand's tank (WandSystem guarantee), so
    // the mana bar tracks the wand with no extra wiring here.
    this.manaFill.style.width = Math.max(0, (player.mana / player.maxMana) * 100) + '%';
    this.levitFill.style.width = Math.max(0, (player.levit / player.maxLevit) * 100) + '%';

    // Critical-state bar language: HP pulses near death, LEV blinks on fumes,
    // the mana track recovers from its dry-fire flinch.
    this.hpFill.classList.toggle('critical', !player.dead && player.hp / player.maxHp < 0.25);
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
      } else {
        const c = COLOR_FN[slot.material]();
        rendered.fill.style.backgroundColor = 'rgb(' + unpackR(c) + ', ' + unpackG(c) + ', ' + unpackB(c) + ')';
        const name = ctx.params.materials[slot.material]?.name ?? 'Unknown material';
        rendered.root.title = `Flask ${i + 1}: ${name} (${slot.count}/${slot.capacity})`;
      }
    }

    const hurt = 1 - (player.hp / player.maxHp);
    this.damageVignette.style.opacity = String(player.dead ? 0.85 : Math.max(0, (hurt - 0.4) * 1.3));

    // Cast cursor: the cards the NEXT click will fire pulse amber, so the
    // left-to-right cast cycle is something you can watch, not guess at.
    const wand = ctx.wands.wands[ctx.wands.active];
    const cooling = wand.cooldown > 0;
    const next = ctx.wands.nextCastSlots();
    const sentence = nextWandSentence(wand.cards, wand.castIndex);
    const groupUnaffordable = player.mana < sentence.manaCost;
    if (this.castCaption) {
      this.castCaption.textContent = groupUnaffordable
        ? sentence.label + ' - Needs ' + sentence.manaCost + ' mana, tank has ' + Math.floor(player.mana)
        : sentence.label + ' - ' + sentence.detail;
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
