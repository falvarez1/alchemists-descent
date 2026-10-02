import { FIGHTER_DEFS, FIGHTER_ORDER, type FighterId } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import { DUEL, resetDuelStage } from '@/world/duelStage';
import { ArenaBotsPanel } from '@/ui/ArenaBotsPanel';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';

/**
 * THE DUEL section of the arena panel (docs/arena/ARENA-RULES.md 1): pick a rival and add it, give either fighter a brain and a skill,
 * watch both health bars and the bout's state, and start another bout. Presentation only: `ctx.arena` (src/arena) does the work.
 */
export class ArenaDuelPanel {
  readonly root = document.createElement('div');
  private readonly pick = document.createElement('select');
  private readonly add = document.createElement('button');
  private readonly remove = document.createElement('button');
  private readonly rematch = document.createElement('button');
  private readonly watch = document.createElement('button');
  private readonly bars: Array<{ name: HTMLElement; fill: HTMLElement; hp: HTMLElement }> = [];
  private readonly status = document.createElement('div');
  private readonly mine: ArenaBotsPanel;
  private readonly theirs: ArenaBotsPanel;
  private last = '';

  constructor(private readonly ctx: Ctx) {
    this.root.className = 'fa-section fa-duel';
    this.mine = new ArenaBotsPanel(ctx, 0, 'Your mind');
    this.theirs = new ArenaBotsPanel(ctx, 1, "The rival's mind");
    const label = document.createElement('div');
    label.className = 'fa-label';
    label.textContent = 'The duel';

    const row = document.createElement('div');
    row.className = 'fa-buttons';
    this.pick.className = 'fa-select';
    this.pick.setAttribute('aria-label', 'Rival fighter');
    for (const id of FIGHTER_ORDER) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = FIGHTER_DEFS[id].name;
      this.pick.append(o);
    }
    this.pick.value = 'brann-rook';
    this.add.type = 'button';
    this.add.className = 'fa-btn';
    this.add.textContent = 'Add rival';
    this.add.addEventListener('mousedown', (e) => e.preventDefault());
    this.add.addEventListener('click', () => { void this.addRival(); });
    this.remove.type = 'button';
    this.remove.className = 'fa-btn';
    this.remove.textContent = 'Remove';
    this.remove.addEventListener('mousedown', (e) => e.preventDefault());
    this.remove.addEventListener('click', () => { ctx.arena?.removeRival(1); this.update(true); });
    this.watch.type = 'button';
    this.watch.className = 'fa-btn';
    this.watch.textContent = 'Watch';
    this.watch.title = 'Put a computer brain on BOTH fighters (skill 3) and start a bout: watch two fighters fight';
    this.watch.addEventListener('mousedown', (e) => e.preventDefault());
    this.watch.addEventListener('click', () => { void this.watchBout(); });
    row.append(this.pick, this.add, this.remove, this.watch);

    const lines: HTMLElement[] = [];
    for (let i = 0; i < 2; i++) {
      const line = document.createElement('div');
      line.className = 'fa-vs';
      const name = document.createElement('span');
      name.className = 'fa-vs-name';
      const track = document.createElement('span');
      track.className = 'fa-vs-track';
      const fill = document.createElement('span');
      fill.className = 'fa-vs-fill';
      track.append(fill);
      const hp = document.createElement('span');
      hp.className = 'fa-vs-hp';
      line.append(name, track, hp);
      lines.push(line);
      this.bars.push({ name, fill, hp });
    }
    this.status.className = 'fa-think fa-bout';
    this.rematch.type = 'button';
    this.rematch.className = 'fa-btn';
    this.rematch.textContent = 'Rematch';
    this.rematch.title = 'A new bout: both fighters whole at their spawns';
    this.rematch.addEventListener('mousedown', (e) => e.preventDefault());
    this.rematch.addEventListener('click', () => this.newBout());
    this.root.append(label, row, ...lines, this.status, this.rematch, this.mine.root, this.theirs.root);
  }

  private async addRival(): Promise<void> {
    const arena = this.ctx.arena;
    if (!arena) return;
    arena.setSpawns(DUEL.spawns);
    const id = this.pick.value as FighterId;
    // slot 0 starts the bout at its own spawn too
    await arena.addRival(id, DUEL.spawns[1].x, DUEL.spawns[1].y);
    arena.reset();
    // the rival comes with a mind (skill 3), so something happens at once; your own fighter stays yours (Watch gives it one too)
    rivalDriverFor(this.ctx, 1)?.install('basic', 3);
    this.update(true);
  }

  /** Both fighters computer-driven: a rival if there is none, a fresh bout, a brain each. */
  private async watchBout(): Promise<void> {
    const arena = this.ctx.arena;
    if (!arena) return;
    if (!arena.active) await this.addRival();
    else this.newBout();
    botDriverFor(this.ctx).install('basic', 3);
    rivalDriverFor(this.ctx, 1)?.install('basic', 3);
    this.update(true);
  }

  private newBout(): void {
    const arena = this.ctx.arena;
    if (!arena?.active) return;
    resetDuelStage(this.ctx);
    arena.reset();
    this.update(true);
  }

  /** Redraw from the arena (the panel calls it a few times a second). */
  update(force = false): void {
    const ctx = this.ctx;
    const arena = ctx.arena;
    const on = arena?.active === true;
    this.add.disabled = false;
    this.remove.disabled = !on;
    this.rematch.disabled = !on;
    const parts: string[] = [];
    for (let s = 0; s < 2; s++) {
      const b = arena?.bundle(s);
      const bar = this.bars[s];
      if (!b) { bar.name.textContent = s === 0 ? 'You' : 'No rival'; bar.fill.style.width = '0%'; bar.hp.textContent = ''; parts.push('-'); continue; }
      const p = b.player;
      const id = arena?.fighterId(s) ?? null;
      bar.name.textContent = id ? FIGHTER_DEFS[id].name.split(' ')[0] : 'Alchemist';
      const frac = Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
      bar.fill.style.width = `${(frac * 100).toFixed(0)}%`;
      bar.fill.dataset.low = frac < 0.3 ? '1' : '0';
      bar.hp.textContent = p.dead ? 'DOWN' : `${Math.round(p.hp)}`;
      parts.push(`${Math.round(p.hp)}`);
    }
    const bout = arena?.bout;
    let text = 'Add a rival to start a bout.';
    if (bout && on) {
      if (bout.state === 'fighting') text = `Fighting · ${((ctx.state.frameCount - bout.startedAt) / 60).toFixed(0)} s`;
      else if (bout.state === 'won') {
        const w = bout.winner ?? 0;
        const id = arena?.fighterId(w) ?? null;
        text = `${id ? FIGHTER_DEFS[id].name : 'The Alchemist'} wins in ${((bout.endedAt - bout.startedAt) / 60).toFixed(1)} s`;
      }
    }
    const key = `${on}|${text}|${parts.join(',')}`;
    if (!force && key === this.last) { this.mine.update(); this.theirs.update(); return; }
    this.last = key;
    this.status.textContent = text;
    this.mine.update(force);
    this.theirs.update(force);
  }
}
