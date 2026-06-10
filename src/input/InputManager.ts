import type { Ctx, GameMode } from '@/core/types';
import { VIEW_W, VIEW_H } from '@/config/constants';
import { SPELL_ORDER } from '@/config/params';
import { packRGB } from '@/sim/colors';
import { spawnCircle, drawLine } from '@/sim/brush';

/**
 * Mouse + keyboard input and build/play mode switching.
 *
 * Wires all listeners in the constructor. Cross-system effects (casting,
 * respawning, descent kickoff) go through the Ctx services; DOM feedback
 * (mode buttons, HUD visibility, banners, depth readout) is emitted as events.
 */
export class InputManager {
  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: Ctx,
  ) {
    // ===================== Input: Mouse =====================
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    // Wave D: the wheel swaps the held wand in play mode.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });

    // ===================== Input: Keyboard =====================
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Header mode buttons drive game state directly.
    document.getElementById('mode-build-btn')?.addEventListener('click', () => this.setMode('build'));
    document.getElementById('mode-play-btn')?.addEventListener('click', () => {
      this.ctx.audio.ensure();
      this.setMode('play');
    });
  }

  private getMouseGridCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const zx = 0.5 + (u - 0.5) / this.ctx.camera.zoom;
    const zy = 0.5 + (v - 0.5) / this.ctx.camera.zoom;
    return {
      x: Math.floor(zx * VIEW_W) + this.ctx.camera.renderX,
      y: Math.floor(zy * VIEW_H) + this.ctx.camera.renderY,
    };
  }

  private onMouseDown(e: MouseEvent): void {
    const { ctx } = this;
    ctx.audio.ensure();
    const coords = this.getMouseGridCoords(e);
    ctx.input.mouse.x = coords.x;
    ctx.input.mouse.y = coords.y;

    if (ctx.state.mode === 'play') {
      if (!ctx.player.dead) ctx.player.firing = true;
      return;
    }

    if (ctx.state.activeInputMode === 'spell') {
      ctx.input.buildSpellHeld = true;
      ctx.spells.castBuildSpell(ctx.state.currentSpell, coords.x, coords.y);
    } else {
      ctx.input.isDrawing = true;
      ctx.input.lastX = coords.x;
      ctx.input.lastY = coords.y;
      spawnCircle(ctx, coords.x, coords.y, ctx.state.currentElement);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const { ctx } = this;
    const coords = this.getMouseGridCoords(e);
    ctx.input.mouse.x = coords.x;
    ctx.input.mouse.y = coords.y;

    const bh = ctx.input.activeChargingBlackHole;
    if (bh && bh.charging && ctx.state.mode === 'build') {
      bh.x = coords.x;
      bh.y = coords.y;
      return;
    }

    if (ctx.state.mode === 'play') return;
    if (!ctx.input.isDrawing || ctx.state.activeInputMode === 'spell') return;
    drawLine(ctx, ctx.input.lastX!, ctx.input.lastY!, coords.x, coords.y, ctx.state.currentElement);
    ctx.input.lastX = coords.x;
    ctx.input.lastY = coords.y;
  }

  private onMouseUp(): void {
    const { ctx } = this;
    ctx.input.isDrawing = false;
    ctx.input.lastX = null;
    ctx.input.lastY = null;
    ctx.input.buildSpellHeld = false;
    // Release a charged bomb throw
    if (
      ctx.input.bombCharge >= 0 &&
      ctx.state.mode === 'play' &&
      !ctx.player.dead &&
      ctx.player.spell === 'bomb'
    ) {
      const sp = ctx.params.spells.bomb;
      if (ctx.player.mana >= sp.manaCost && ctx.player.cooldown === 0) {
        ctx.player.mana -= sp.manaCost;
        ctx.player.cooldown = sp.cooldown;
        const tip = ctx.spells.wandTip();
        const a = ctx.player.aimAngle;
        const power = sp.velocityForce! * (0.35 + ctx.input.bombCharge * 1.25);
        ctx.projectiles.push({
          x: tip.x,
          y: tip.y,
          vx: Math.cos(a) * power,
          vy: Math.sin(a) * power - 0.6,
          type: 'bomb',
          life: Math.floor(sp.fuseTicks!),
          age: 0,
          charging: false,
          hostile: false,
        });
        ctx.audio.tone(180 + ctx.input.bombCharge * 240, 120, 0.14, 'triangle', 0.10);
      }
    }
    ctx.input.bombCharge = -1;
    ctx.player.firing = false;
    if (ctx.input.activeChargingBlackHole) {
      ctx.input.activeChargingBlackHole.charging = false;
      ctx.input.activeChargingBlackHole = null;
    }
  }

  private onWheel(e: WheelEvent): void {
    const { ctx } = this;
    if (ctx.state.mode !== 'play' || e.deltaY === 0) return;
    this.selectWand(ctx.wands.active === 0 ? 1 : 0);
  }

  /** Wave D: swap the held wand (Digit1/Digit2 or the mouse wheel). */
  private selectWand(idx: 0 | 1): void {
    const { ctx } = this;
    if (ctx.wands.active === idx) return;
    ctx.wands.active = idx;
    ctx.events.emit('wandChanged');
  }

  private onKeyDown(e: KeyboardEvent): void {
    const { ctx } = this;
    ctx.audio.ensure();
    if (e.code === 'Tab') {
      e.preventDefault();
      this.setMode(ctx.state.mode === 'build' ? 'play' : 'build');
      return;
    }

    if (e.code === 'KeyA' || e.code === 'ArrowLeft') ctx.input.keys.left = true;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') ctx.input.keys.right = true;
    else if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
      e.preventDefault();
      ctx.input.keys.jump = true;
    } else if (e.code === 'KeyS' || e.code === 'ArrowDown') ctx.input.keys.down = true;
    else if (e.code === 'KeyR' && ctx.player.dead) ctx.playerCtl.respawn();
    else if (e.code === 'KeyE' && ctx.state.mode === 'play') {
      // Context-sensitive E: a lever in reach flips on the press; otherwise
      // (and additionally) the hold starts the flask siphon.
      if (!e.repeat) ctx.mechanisms.interact(ctx);
      ctx.input.siphonHeld = true;
    }
    else if (e.code === 'KeyQ' && ctx.state.mode === 'play') ctx.input.pourHeld = true;
    else if (e.code === 'KeyX' && ctx.state.mode === 'play') ctx.input.drinkHeld = true;
    else if (e.code === 'KeyF' && ctx.state.mode === 'play' && !ctx.player.dead) ctx.flask.throwFlask(ctx);
    else if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5)) - 1;
      if (ctx.state.mode === 'play') {
        // Wave D: digits pick wands in play, not spells — 1/2 only, 3-7 are dead keys
        if (n === 0 || n === 1) this.selectWand(n);
      } else if (n >= 0 && n < SPELL_ORDER.length) {
        ctx.player.spell = SPELL_ORDER[n];
        ctx.input.bombCharge = -1;
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const { ctx } = this;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') ctx.input.keys.left = false;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') ctx.input.keys.right = false;
    else if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') ctx.input.keys.jump = false;
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') ctx.input.keys.down = false;
    else if (e.code === 'KeyE') ctx.input.siphonHeld = false;
    else if (e.code === 'KeyQ') ctx.input.pourHeld = false;
    else if (e.code === 'KeyX') ctx.input.drinkHeld = false;
  }

  // ===================== Mode Switching =====================
  setMode(mode: GameMode): void {
    const { ctx } = this;
    if (mode === ctx.state.mode) return;
    ctx.state.mode = mode;
    ctx.events.emit('modeChanged', { mode });

    if (mode === 'play') {
      // Play mode IS the descent: generate (or resume) the current level.
      // On first entry this swaps in D1 and positions the player at its spawn.
      ctx.levels.startDescent(ctx);
      // Defensive legacy fallback: only if no level took over the spawn.
      if (ctx.levels.current === null && (!ctx.state.playerSpawned || ctx.player.dead)) {
        const sp = ctx.playerCtl.findSpawnPoint();
        ctx.player.x = sp.x;
        ctx.player.y = sp.y;
        ctx.player.vx = 0;
        ctx.player.vy = 0;
        ctx.player.fx = 0;
        ctx.player.fy = 0;
        ctx.player.hp = ctx.player.maxHp;
        ctx.player.mana = ctx.player.maxMana;
        ctx.player.levit = ctx.player.maxLevit;
        ctx.player.dead = false;
        ctx.player.invuln = 60;
        ctx.events.emit('playerRespawned');
        ctx.state.playerSpawned = true;
        ctx.particles.burst(sp.x, sp.y - 7, 22, null, () => packRGB(200, 160, 255), 2.7, {
          glow: 2.2,
          grav: -0.01,
        });
      }
    } else {
      ctx.player.firing = false;
      ctx.input.keys.left = ctx.input.keys.right = ctx.input.keys.jump = false;
      ctx.input.siphonHeld = ctx.input.pourHeld = ctx.input.drinkHeld = false;
    }
  }
}
