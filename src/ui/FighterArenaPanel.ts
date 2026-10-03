import '@/styles/arena.css';
import { FIGHTER_DEFS, FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import { ARENA_TIPS, FOE_PRESETS, YARD_STATIONS, type FoePreset, type YardStation } from '@/content/fighterArena';
import { FIGHTER_TECHNIQUES } from '@/content/fighterTechniques';
import type { AbilitySlot } from '@/core/fighters';
import type { Ctx, EnemyKind } from '@/core/types';
import { BODY_RANGES, NEUTRAL_BODY, bodyBars } from '@/core/fighterBody';
import { getBindings, keyLabel } from '@/input/bindings';
import { YARD, resetFighterArena, standFighterAt } from '@/world/fighterArena';
import { openFighterRoster } from '@/ui/fighterRosterHost';
import { ArenaBotsPanel } from '@/ui/ArenaBotsPanel';
import { ArenaDuelPanel } from '@/ui/ArenaDuelPanel';
import { resetDuelStage, standAtSpawn } from '@/world/duelStage';
import { FIGHTER_LOADOUTS, loadoutSave } from '@/content/fighterLoadouts';

/** The fighters the panel steps through: the classic Alchemist (null) first, then the ten. */
const CYCLE: ReadonlyArray<FighterId | null> = [null, ...FIGHTER_ORDER];
/** Foes that fly: they spawn up in the air, the rest on the floor. */
const FLYERS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['bat', 'imp', 'wisp']);
const LEVEL_ID = 'fighter-test';
const DUEL_LEVEL_ID = 'fighter-duel';
/** The station names as the Go buttons print them. */
const STATION_SHORT: Readonly<Record<YardStation, string>> = { muster: 'Muster', ring: 'Ring', gallery: 'Gallery', kiln: 'Kiln', bluff: 'Bluff', cistern: 'Cistern', cell: 'Cell' };
const SPAWN_GROUND = 3;

interface MoveRow {
  root: HTMLElement;
  status: HTMLElement;
  uses: HTMLElement;
  name: HTMLElement;
  key: HTMLElement;
  tip: HTMLElement;
  where: HTMLButtonElement;
  seen?: HTMLInputElement;
}

/**
 * THE PROVING YARD's panel (docs/FIGHTERS.md): while the yard is the level, a card on the right edge that
 * steps through the fighters ([ and ]), lists the one in hand's three abilities with what to try and WHERE, ticks
 * each off as it fires, and carries the tools a tester wants: foes to hit (and shooters to be shot at), a refill
 * and an unlimited toggle, hurt / heal, a safe mode (foes ignore you and nothing lands), "take me there" for every
 * station, a reset that rebuilds the yard, and the way out.
 *
 * A developer's instrument, drawn in the game's HUD voice. It reads `ctx.fighters.view` and presses nothing itself:
 * Z and T are the player's.
 */
export class FighterArenaPanel {
  private readonly root = document.createElement('aside');
  private readonly body = document.createElement('div');
  private readonly name = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly rows: Record<'passive' | AbilitySlot, MoveRow>;
  private readonly unlimited: HTMLInputElement;
  private readonly safe: HTMLInputElement;
  private readonly signature: HTMLInputElement;
  private readonly foesLabel = el('div', 'fa-label', 'Foes');
  private readonly bots: ArenaBotsPanel;
  private readonly duel: ArenaDuelPanel;
  private readonly barsEl = el('div', 'fa-bars');
  private readonly moveRead = el('div', 'fa-moveread');
  /** The fighter's movement technique: its name and how, a Go button, its state and a count of uses. */
  private readonly techEl = el('div', 'fa-tech');
  private readonly techName = el('span', 'fa-tech-name');
  private readonly techState = el('span', 'fa-status');
  private readonly techUses = el('span', 'fa-uses');
  private readonly techHow = el('div', 'fa-tip');
  private readonly techGo = el('button', 'fa-where') as HTMLButtonElement;
  /** The movement readout: this run's peak speed, the last jump's apex and the airtime, read off the player each frame. */
  private readonly lab = { peak: 0, wasGrounded: true, startY: 0, minY: 0, airTicks: 0, lastApex: 0, lastAir: 0, lastPeakAtJump: 0 };
  private raf = 0;
  private frame = 0;
  private shown = false;
  private equipped: FighterId | null | undefined;
  private readonly lastUsed: Record<AbilitySlot, number> = { tactical: -1, ultimate: -1 };
  private readonly uses: Record<AbilitySlot, number> = { tactical: 0, ultimate: 0 };
  private readonly offs: Array<() => void> = [];

  constructor(private readonly ctx: Ctx) {
    this.root.id = 'fighter-arena';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'The Proving Yard');

    const head = el('div', 'fa-head');
    head.append(el('span', 'fa-title', 'THE PROVING YARD'));
    const fold = el('button', 'fa-fold', '–') as HTMLButtonElement;
    fold.type = 'button';
    fold.title = 'Fold the panel';
    fold.addEventListener('click', () => {
      this.root.classList.toggle('collapsed');
      fold.textContent = this.root.classList.contains('collapsed') ? '+' : '–';
    });
    head.append(fold);

    // ---- the fighter in hand
    const who = el('div', 'fa-who');
    const prev = button('fa-step', '‹', () => this.step(-1), 'Previous fighter ( [ )');
    const next = button('fa-step', '›', () => this.step(1), 'Next fighter ( ] )');
    const names = el('div', 'fa-names');
    this.name.className = 'fa-name';
    this.title.className = 'fa-subtitle';
    names.append(this.name, this.title);
    const roster = button('fa-roster', 'Roster', () => this.openRoster(), 'Open the roster');
    who.append(prev, names, next, roster);

    // ---- the body (docs/arena/FIGHTER-PHYSICS.md): ten stats against the Alchemist's line, and what the body does right now
    const bodyCard = el('div', 'fa-section fa-body-card');
    const bodyHead = el('div', 'fa-label', 'Body');
    this.moveRead.title = 'Speed now, peak speed since you chose the fighter, the last jump (height in cells, time in the air), the levitation tank';
    this.techGo.type = 'button';
    this.techGo.addEventListener('mousedown', (event) => event.preventDefault());
    const techTop = el('div', 'fa-move-top');
    techTop.append(el('kbd', 'key', '↯'), this.techName, this.techGo, this.techUses, this.techState);
    this.techEl.append(techTop, this.techHow);
    bodyCard.append(bodyHead, this.barsEl, this.moveRead, this.techEl);
    bodyHead.append(button('fa-mini', 'reset peak', () => { this.lab.peak = 0; this.lab.lastApex = 0; this.lab.lastAir = 0; }, 'Clear the peak speed and the last jump'));

    // ---- the three abilities
    const moves = el('div', 'fa-moves');
    this.rows = {
      passive: this.makeRow('passive'),
      tactical: this.makeRow('tactical'),
      ultimate: this.makeRow('ultimate'),
    };
    moves.append(this.rows.passive.root, this.rows.tactical.root, this.rows.ultimate.root);

    // ---- foes
    const foes = el('div', 'fa-section');
    foes.append(this.foesLabel);
    const foeRow = el('div', 'fa-buttons');
    for (const preset of FOE_PRESETS) foeRow.append(button('fa-btn', preset.label, () => this.spawn(preset), `${preset.count} x ${preset.kind}`));
    foeRow.append(button('fa-btn', 'Wound all', () => this.woundFoes(), 'Take every foe to 40% health (Sable\'s Bloodsense reads wounds)'));
    foeRow.append(button('fa-btn', 'Clear', () => this.clearFoes(), 'Remove every foe and shot'));
    foes.append(foeRow);

    // ---- stations
    const where = el('div', 'fa-section');
    where.append(el('div', 'fa-label', 'Take me to'));
    const whereRow = el('div', 'fa-buttons');
    for (const id of Object.keys(YARD_STATIONS) as YardStation[]) {
      whereRow.append(button('fa-btn', YARD_STATIONS[id].name.replace(/^The /, ''), () => standFighterAt(this.ctx, id), YARD_STATIONS[id].blurb));
    }
    where.append(whereRow);

    // ---- tools
    const tools = el('div', 'fa-section');
    tools.append(el('div', 'fa-label', 'Tools'));
    const toolRow = el('div', 'fa-buttons');
    toolRow.append(
      button('fa-btn', 'Refill', () => this.ctx.fighters?.refill(), 'Skip the cooldowns and fill the ultimate'),
      button('fa-btn', 'Own wands', () => this.ownWands(), 'Swap to the signature wands, cards and flasks of the fighter in hand (what it carries in a duel)'),
      button('fa-btn', 'Heal', () => this.heal(), 'Full health'),
      button('fa-btn', 'Hurt 25', () => this.ctx.playerCtl.damage(25, 0, 0, 'proving-yard'), 'Take a blow (Brann\'s Pressure, Rusk\'s armor, Edda\'s shield)'),
      button('fa-btn', 'Start', () => this.toStart(), 'Back to the dais (the yard) or your spawn (the duel stage)'),
      button('fa-btn', 'Reset', () => this.resetYard(), 'Rebuild the hall or the stage: the barricade, the keg, the oil, the potions; in a duel, a new bout'),
      button('fa-btn', 'Other stage', () => this.otherStage(), 'The Duel Stage from the yard, the Proving Yard from the stage'),
      button('fa-btn fa-leave', 'Leave', () => window.dispatchEvent(new Event('expedition-title-request')), 'Back to the title'),
    );
    const toggles = el('div', 'fa-toggles');
    this.unlimited = toggle('Unlimited abilities', 'Refill every cooldown and the ultimate as they run down');
    this.safe = toggle('Safe mode', 'Foes ignore you and nothing hurts you (the arrival grace, held open)');
    this.signature = toggle('Signature wands', 'Choosing a fighter here also hands it its own wands, cards and flasks (what it carries in a duel). Off: the yard keeps whatever you hold.');
    this.signature.checked = true;
    toggles.append(this.unlimited.parentElement as HTMLElement, this.safe.parentElement as HTMLElement, this.signature.parentElement as HTMLElement);
    tools.append(toolRow, toggles);

    this.bots = new ArenaBotsPanel(ctx);
    this.duel = new ArenaDuelPanel(ctx);
    this.body.className = 'fa-body';
    foes.classList.add('fa-yard-only');
    where.classList.add('fa-yard-only');
    this.bots.root.classList.add('fa-yard-only');
    this.duel.root.classList.add('fa-duel-only');
    this.body.append(who, bodyCard, moves, this.bots.root, this.duel.root, foes, where, tools);
    this.root.append(head, this.body);
    (document.getElementById('canvas-holder') ?? document.body).append(this.root);

    window.addEventListener('keydown', this.onKey);
    this.offs.push(() => window.removeEventListener('keydown', this.onKey));
    this.offs.push(ctx.events.on('levelChanged', () => { this.equipped = undefined; }));
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---- the panel's rows ----------------------------------------------------------------------------------

  private makeRow(slot: 'passive' | AbilitySlot): MoveRow {
    const root = el('div', `fa-move fa-${slot}`);
    const top = el('div', 'fa-move-top');
    const key = el('kbd', 'key', slot === 'passive' ? '·' : '');
    const name = el('span', 'fa-move-name');
    const status = el('span', 'fa-status');
    const where = button('fa-where', '', () => undefined) as HTMLButtonElement;
    const uses = el('span', 'fa-uses');
    top.append(key, name, where, uses, status);
    const tip = el('div', 'fa-tip');
    root.append(top, tip);
    const row: MoveRow = { root, status, uses, name, key, tip, where };
    if (slot === 'passive') {
      // the passive cannot be counted: the tester ticks it off once they have watched it work
      const seen = toggle('Seen', 'Tick it off once you have watched the passive work');
      seen.addEventListener('change', () => root.classList.toggle('done', seen.checked));
      top.insertBefore(seen.parentElement as HTMLElement, status);
      row.seen = seen;
    }
    return row;
  }

  // ---- the fighters ---------------------------------------------------------------------------------------

  private step(dir: -1 | 1): void {
    const at = CYCLE.indexOf(this.ctx.fighters?.id ?? null);
    this.equip(CYCLE[((at < 0 ? 0 : at) + dir + CYCLE.length) % CYCLE.length]);
  }

  private equip(id: FighterId | null): void {
    this.ctx.fighters?.equip(id);
    this.ctx.run?.chooseFighter(id);
    this.ctx.audio.sfx('ui.click');
    if (id !== null && this.signature.checked) this.ownWands(false);
  }

  private openRoster(): void {
    openFighterRoster(this.ctx, this.ctx.fighters?.id ?? null, (id) => this.equip(id));
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.shown || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (document.querySelector('#fighter-roster.visible')) return;
    if (event.code === 'BracketLeft') { event.preventDefault(); this.step(-1); }
    else if (event.code === 'BracketRight') { event.preventDefault(); this.step(1); }
  };

  // ---- the tools ------------------------------------------------------------------------------------------

  private spawn(preset: FoePreset): void {
    const ctx = this.ctx;
    for (let i = 0; i < preset.count; i++) {
      let x: number;
      let y: number;
      if (preset.at === 'gallery') {
        x = YARD.gallery.x0 + 14 + i * 18;
        y = YARD.gallery.y - 3;
      } else if (preset.at === 'cell') {
        x = YARD.cell.cx + (i - (preset.count - 1) / 2) * 30;
        y = YARD.cell.y;
      } else {
        // the ring, alternating sides of the middle, never on a cover pillar
        const side = i % 2 === 0 ? 1 : -1;
        x = YARD.ring.cx + side * (60 + Math.floor(i / 2) * 34) + (FLYERS.has(preset.kind) ? 0 : 20);
        y = FLYERS.has(preset.kind) ? YARD.floor - 46 : YARD.ring.y - SPAWN_GROUND;
      }
      ctx.enemyCtl.spawn(preset.kind, Math.round(x), Math.round(y));
      const e = ctx.enemies[ctx.enemies.length - 1];
      if (e) { e.sleeping = false; e.alerted = false; }
    }
  }

  private clearFoes(): void {
    this.ctx.enemies.length = 0;
    this.ctx.projectiles.length = 0;
  }

  private woundFoes(): void {
    for (const e of this.ctx.enemies) e.hp = Math.max(1, Math.round(e.maxHp * 0.4));
  }

  private heal(): void {
    const p = this.ctx.player;
    p.hp = p.maxHp;
    p.dead = false;
  }

  private resetYard(): void {
    if (this.ctx.levels.current?.def.id === DUEL_LEVEL_ID) {
      resetDuelStage(this.ctx);
      if (this.ctx.arena?.active) this.ctx.arena.reset();
      else standAtSpawn(this.ctx, 0);
    } else resetFighterArena(this.ctx);
    this.uses.tactical = 0;
    this.uses.ultimate = 0;
  }

  /** The fighter's signature loadout, now (a duel hands it over by itself; in the yard it is a button). */
  private ownWands(announce = true): void {
    const id = this.ctx.fighters?.id;
    if (!id) return;
    this.ctx.wands.loadLoadout(loadoutSave(id));
    this.ctx.flask.clearSlots();
    FIGHTER_LOADOUTS[id].flasks.forEach((f, i) => { this.ctx.flask.setSlot(i, f.material, f.count); });
    if (announce) this.ctx.events.emit('toast', { text: `${FIGHTER_DEFS[id].name}: ${FIGHTER_LOADOUTS[id].idea}` });
  }

  private toStart(): void {
    if (this.ctx.levels.current?.def.id === DUEL_LEVEL_ID) standAtSpawn(this.ctx, 0);
    else standFighterAt(this.ctx, 'muster');
  }

  /** The Proving Yard and the Duel Stage are two test levels: leaving one for the other starts a fresh test run on it, with the fighter in hand. */
  private otherStage(): void {
    const ctx = this.ctx;
    const to = ctx.levels.current?.def.id === DUEL_LEVEL_ID ? LEVEL_ID : DUEL_LEVEL_ID;
    const fighter = ctx.fighters?.id ?? undefined;
    ctx.levels.startRun(ctx, { mode: 'test', worldSource: 'campaign-level', levelId: to, loadout: 'advanced', fighter });
  }

  // ---- the frame loop ---------------------------------------------------------------------------------------

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop);
    const ctx = this.ctx;
    const levelId = ctx.levels.current?.def.id;
    const active = ctx.state.mode === 'play' && (levelId === LEVEL_ID || levelId === DUEL_LEVEL_ID) && !document.body.classList.contains('entry-active');
    this.root.dataset.level = levelId === DUEL_LEVEL_ID ? 'duel' : 'yard';
    if (active !== this.shown) {
      this.shown = active;
      this.root.hidden = !active;
      // arriving as a fighter chosen at the door: it carries its own wands from the first step
      if (active && ctx.fighters?.id && this.signature.checked) void ctx.fighters.whenReady().then(() => this.ownWands(false));
      if (!active) { ctx.state.arrivalGraceUntil = 0; this.safe.checked = false; }
    }
    if (!active) return;
    // The tools that act every frame, even between the panel's slower redraws.
    if (this.safe.checked) ctx.state.arrivalGraceUntil = ctx.state.frameCount + 120;
    const fighters = ctx.fighters;
    if (!fighters) return;
    if (this.unlimited.checked && (!fighters.view.tactical.ready || !fighters.view.ultimate.ready)) fighters.refill();
    // Count the uses on every frame (a use lasts one tick), draw on every sixth.
    const view = fighters.view;
    for (const slot of ['tactical', 'ultimate'] as const) {
      const at = view[slot].usedAt;
      if (at !== this.lastUsed[slot]) {
        if (at >= 0) this.uses[slot]++;
        this.lastUsed[slot] = at;
      }
    }
    this.sampleMovement();
    if (this.frame % 6 === 0) { this.bots.update(); if (levelId === DUEL_LEVEL_ID) this.duel.update(); }
    if (this.frame++ % 6 !== 0 && this.equipped === fighters.id) return;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const fighters = ctx.fighters;
    if (!fighters) return;
    const view = fighters.view;
    const id = fighters.id;
    const bindings = getBindings();
    if (this.equipped !== id) {
      this.equipped = id;
      this.uses.tactical = 0;
      this.uses.ultimate = 0;
      this.lastUsed.tactical = view.tactical.usedAt;
      this.lastUsed.ultimate = view.ultimate.usedAt;
      this.lab.peak = 0; this.lab.lastApex = 0; this.lab.lastAir = 0;
      this.fillFighter(id, keyLabel(bindings.tactical), keyLabel(bindings.ultimate));
    }
    this.root.style.setProperty('--fa-accent', id ? FIGHTER_DEFS[id].accent : '#d5b982');
    this.drawBody();
    const tech = view.technique;
    this.techState.textContent = tech.state === 'idle' ? '' : tech.state.toUpperCase();
    this.techState.dataset.state = tech.state === 'idle' ? 'passive' : 'active';
    this.techUses.textContent = tech.uses > 0 ? `✓ ×${tech.uses}` : '';
    this.techEl.classList.toggle('done', tech.uses > 0);
    const p = ctx.player;
    const lab = this.lab;
    this.moveRead.textContent = `Speed ${(Math.abs(p.vx) * 60).toFixed(0)}  ·  peak ${(lab.peak * 60).toFixed(0)}  ·  last jump ${lab.lastApex.toFixed(0)} up, ${lab.lastAir.toFixed(2)} s  ·  LEV ${Math.round((p.levit / Math.max(1, p.maxLevit)) * 100)}%`;
    this.statusOf('tactical', view.tactical.ready, view.tactical.active, view.tactical.cooldownSeconds, 1, view.tactical.name);
    this.statusOf('ultimate', view.ultimate.ready, view.ultimate.active, view.ultimate.cooldownSeconds, view.ultimate.charge, view.ultimate.name);
    this.rows.tactical.uses.textContent = this.uses.tactical > 0 ? `✓ ×${this.uses.tactical}` : '';
    this.rows.ultimate.uses.textContent = this.uses.ultimate > 0 ? `✓ ×${this.uses.ultimate}` : '';
    this.rows.tactical.root.classList.toggle('done', this.uses.tactical > 0);
    this.rows.ultimate.root.classList.toggle('done', this.uses.ultimate > 0);
    const foes = ctx.enemies.length;
    this.foesLabel.textContent = foes === 0 ? 'Foes' : `Foes · ${foes} in the yard`;
  }

  /** One frame of the movement lab: peak speed, the apex and airtime of each jump. Cells and seconds (60 ticks). */
  private sampleMovement(): void {
    const p = this.ctx.player;
    const lab = this.lab;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > lab.peak && Math.abs(p.vx) > 0) lab.peak = speed;
    const grounded = p.grounded === true || p.climbing === true || p.inLiquid === true;
    if (lab.wasGrounded && !grounded) { lab.startY = p.y; lab.minY = p.y; lab.airTicks = 0; lab.lastPeakAtJump = Math.abs(p.vx); }
    if (!grounded) { lab.airTicks++; if (p.y < lab.minY) lab.minY = p.y; }
    if (!lab.wasGrounded && grounded && lab.airTicks > 6) { lab.lastApex = lab.startY - lab.minY; lab.lastAir = lab.airTicks / 60; }
    lab.wasGrounded = grounded;
  }

  private drawBody(): void {
    const body = this.ctx.fighters?.body ?? NEUTRAL_BODY;
    const neutralAt = (f: keyof typeof BODY_RANGES): number => ((1 - BODY_RANGES[f].min) / (BODY_RANGES[f].max - BODY_RANGES[f].min)) * 100;
    const keys: Array<keyof typeof BODY_RANGES> = ['mass', 'maxHp', 'run', 'friction', 'airControl', 'jump', 'gravity', 'fall', 'jetFuel', 'dealt'];
    const rows = this.barsEl.children;
    const bars = bodyBars(body);
    if (rows.length !== bars.length) {
      this.barsEl.replaceChildren(...bars.map((bar, i) => {
        const row = el('div', 'fa-bar');
        const track = el('div', 'fa-bar-track');
        const fill = el('i', 'fa-bar-fill');
        const mark = el('b', 'fa-bar-mark');
        mark.style.left = `${neutralAt(keys[i])}%`;
        track.append(fill, mark);
        row.append(el('span', 'fa-bar-label', bar.label), track, el('span', 'fa-bar-value', ''));
        return row;
      }));
    }
    bars.forEach((bar, i) => {
      const row = this.barsEl.children[i] as HTMLElement;
      (row.querySelector('.fa-bar-fill') as HTMLElement).style.width = `${Math.round(bar.unit * 100)}%`;
      (row.querySelector('.fa-bar-value') as HTMLElement).textContent = `x${bar.value.toFixed(2)}`;
      row.dataset.dir = bar.value > 1.04 ? 'up' : bar.value < 0.96 ? 'down' : 'flat';
    });
  }

  private statusOf(slot: AbilitySlot, ready: boolean, active: number, seconds: number, charge: number, name: string): void {
    const row = this.rows[slot];
    row.name.textContent = name;
    let text: string;
    let state: string;
    if (active > 0) { text = 'ACTIVE'; state = 'active'; }
    else if (ready) { text = 'READY'; state = 'ready'; }
    else if (slot === 'ultimate' && charge < 1) { text = `CHARGING ${Math.floor(charge * 100)}%`; state = 'charging'; }
    else { text = `COOLING ${seconds}s`; state = 'cooling'; }
    row.status.textContent = text;
    row.status.dataset.state = state;
  }

  /** The fighter changed: the names, the keys, the tips and where to go. */
  private fillFighter(id: FighterId | null, tacticalKey: string, ultimateKey: string): void {
    const move = id ? FIGHTER_TECHNIQUES[id] : null;
    this.techEl.hidden = move === null;
    if (move) {
      this.techName.textContent = move.name;
      this.techHow.textContent = `${move.how} ${move.why}`;
      this.techGo.textContent = `Go: ${STATION_SHORT[move.where]}`;
      this.techGo.onclick = () => standFighterAt(this.ctx, move.where);
    }
    this.name.textContent = id ? FIGHTER_DEFS[id].name : 'The Alchemist';
    this.title.textContent = id ? `${FIGHTER_DEFS[id].title} · ${FIGHTER_DEFS[id].role}` : 'No fighter: no passive, no abilities';
    const rows = this.rows;
    rows.tactical.key.textContent = tacticalKey;
    rows.ultimate.key.textContent = ultimateKey;
    if (rows.passive.seen) { rows.passive.seen.checked = false; rows.passive.root.classList.remove('done'); }
    if (!id) {
      for (const slot of ['passive', 'tactical', 'ultimate'] as const) {
        rows[slot].name.textContent = slot === 'passive' ? 'Nothing' : '—';
        rows[slot].tip.textContent = 'The classic Alchemist has only the wands, the flask and the world. A baseline to compare the others against.';
        rows[slot].where.textContent = '';
        rows[slot].where.hidden = true;
      }
      rows.passive.status.textContent = '';
      return;
    }
    const def = FIGHTER_DEFS[id];
    const tips = ARENA_TIPS[id];
    for (const slot of ['passive', 'tactical', 'ultimate'] as const) {
      const row = rows[slot];
      row.name.textContent = def[slot].name;
      row.tip.textContent = tips[slot].try;
      row.tip.title = def[slot].description;
      row.where.hidden = false;
      row.where.textContent = `Go: ${STATION_SHORT[tips[slot].where]}`;
      row.where.title = `Stand at ${YARD_STATIONS[tips[slot].where].name}`;
      const station = tips[slot].where;
      row.where.onclick = () => standFighterAt(this.ctx, station);
    }
    rows.passive.status.textContent = 'PASSIVE';
    rows.passive.status.dataset.state = 'passive';
  }

  dispose(): void {
    this.duel.dispose();
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    this.root.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  // A click must not take the keyboard: Space is the jump, and a focused button would press itself with it.
  node.addEventListener('mousedown', (event) => event.preventDefault());
  if (title) node.title = title;
  return node;
}

/** A labelled checkbox; returns the input (its label is its parent). */
function toggle(label: string, title: string): HTMLInputElement {
  const wrap = el('label', 'fa-toggle');
  wrap.title = title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => input.blur());
  wrap.append(input, el('span', 'fa-toggle-text', label));
  return input;
}
