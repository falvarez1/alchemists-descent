import type { Ctx, GameMode } from '@/core/types';
import { VIEW_W, VIEW_H } from '@/config/constants';
import { SPELL_ORDER } from '@/config/params';
import { packRGB } from '@/sim/colors';
import { spawnCircle, drawLine } from '@/sim/brush';

type KeyboardLockApi = {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
};

type FullscreenOptionsWithKeyboardLock = FullscreenOptions & {
  keyboardLock?: 'browser' | 'none';
};

const GRAB_KEY_CODES = new Set(['ShiftLeft', 'ShiftRight', 'KeyC']);
const LEFT_KEY_CODES = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEY_CODES = new Set(['KeyD', 'ArrowRight']);
const UP_KEY_CODES = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEY_CODES = new Set(['KeyS', 'ArrowDown']);
const JUMP_KEY_CODES = new Set(['Space', 'KeyW', 'ArrowUp']);

const GAMEPLAY_KEY_CODES = new Set([
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyC',
  'KeyE',
  'KeyQ',
  'KeyX',
  'KeyF',
  'KeyR',
  'Digit1',
  'Digit2',
  'Tab',
]);

const KEYBOARD_LOCK_CODES = [
  ...GAMEPLAY_KEY_CODES,
  'KeyB',
  'KeyH',
  'KeyM',
  'Escape',
  'Backquote',
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target;
  if (el.isContentEditable) return true;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Mouse + keyboard input and build/play mode switching.
 *
 * Wires all listeners in the constructor. Cross-system effects (casting,
 * respawning, descent kickoff) go through the Ctx services; DOM feedback
 * (mode buttons, HUD visibility, banners, depth readout) is emitted as events.
 */
export class InputManager {
  private keyboardLocked = false;
  private readonly heldKeyCodes = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: Ctx,
  ) {
    ctx.input.releaseHeldInput = () => this.clearHeldInput();

    // ===================== Input: Mouse =====================
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    // RMB belongs to the game (flask throw / eyedropper), not the browser.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Wave D: the wheel swaps the held wand in play mode.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // ===================== Input: Keyboard =====================
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    window.addEventListener('blur', () => this.clearHeldInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearHeldInput();
    });
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());

    // Header mode buttons drive game state directly.
    document.getElementById('mode-build-btn')?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.setMode('build');
    });
    document.getElementById('mode-play-btn')?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.ctx.audio.ensure();
      if (!document.body.classList.contains('builder-open') && this.ctx.state.playtestSource !== 'builder' && this.requestRunLauncher('play-button')) return;
      this.setMode('play');
    });
    document.getElementById('immersive-play-btn')?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      void this.enterImmersivePlay();
    });
    this.syncImmersiveButton();
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

    // Right mouse: a game verb, never the browser menu.
    if (e.button === 2) {
      if (ctx.state.mode === 'play') {
        // Same grip as the reference build: RMB hurls the flask.
        if (!ctx.player.dead) ctx.flask.throwFlask(ctx);
      } else {
        // Sandbox eyedropper: pick up whatever material is under the cursor.
        if (ctx.world.inBounds(coords.x, coords.y)) {
          const t = ctx.world.types[ctx.world.idx(coords.x, coords.y)];
          const btn = document.querySelector<HTMLButtonElement>(
            `.tool-btn[data-mode="element"][data-id="${t}"]`,
          );
          if (btn) btn.click();
          else {
            ctx.state.currentElement = t as never;
            ctx.state.activeInputMode = 'element';
          }
          const name = ctx.params.materials[t]?.name ?? 'Material ' + t;
          ctx.events.emit('toast', { text: 'PICKED: ' + name.toUpperCase() });
        }
      }
      return;
    }

    if (ctx.state.mode === 'play') {
      if (ctx.player.climbing) return;
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
      !ctx.player.climbing &&
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
    e.preventDefault();
    this.selectWand(ctx.wands.active === 0 ? 1 : 0);
  }

  /** Wave D: swap the held wand (Digit1/Digit2 or the mouse wheel). */
  private selectWand(idx: 0 | 1): void {
    const { ctx } = this;
    if (ctx.wands.active === idx) return;
    ctx.wands.active = idx;
    ctx.events.emit('wandChanged');
  }

  private shouldIgnoreKeyboard(e: KeyboardEvent): boolean {
    return (
      e.isComposing ||
      Boolean(document.querySelector('.app-dialog-root, .editor-command-menu.open, .editor-popover.interactive')) ||
      isEditableTarget(e.target)
    );
  }

  private isGameplayKey(code: string): boolean {
    return GAMEPLAY_KEY_CODES.has(code) || code.startsWith('Digit');
  }

  private claimPlayKey(e: KeyboardEvent): void {
    if (this.ctx.state.mode !== 'play') return;
    if (!this.isGameplayKey(e.code)) return;
    e.preventDefault();
  }

  private isTrackedHeldKey(code: string): boolean {
    return (
      LEFT_KEY_CODES.has(code) ||
      RIGHT_KEY_CODES.has(code) ||
      UP_KEY_CODES.has(code) ||
      DOWN_KEY_CODES.has(code) ||
      JUMP_KEY_CODES.has(code) ||
      GRAB_KEY_CODES.has(code)
    );
  }

  private setKeyHeld(code: string, held: boolean): void {
    if (!this.isTrackedHeldKey(code)) return;
    if (held) this.heldKeyCodes.add(code);
    else this.heldKeyCodes.delete(code);
    this.syncHeldKeys();
  }

  private anyHeld(codes: Set<string>): boolean {
    for (const code of codes) if (this.heldKeyCodes.has(code)) return true;
    return false;
  }

  private syncHeldKeys(): void {
    const keys = this.ctx.input.keys;
    keys.left = this.anyHeld(LEFT_KEY_CODES);
    keys.right = this.anyHeld(RIGHT_KEY_CODES);
    keys.up = this.anyHeld(UP_KEY_CODES);
    keys.down = this.anyHeld(DOWN_KEY_CODES);
    keys.jump = this.anyHeld(JUMP_KEY_CODES);
    keys.wallJump = this.heldKeyCodes.has('Space');
    keys.grab = this.anyHeld(GRAB_KEY_CODES);
  }

  private clearHeldInput(): void {
    const { ctx } = this;
    const keys = ctx.input.keys;
    keys.left = false;
    keys.right = false;
    keys.up = false;
    keys.jump = false;
    keys.wallJump = false;
    keys.down = false;
    keys.grab = false;
    this.heldKeyCodes.clear();
    ctx.input.isDrawing = false;
    ctx.input.lastX = null;
    ctx.input.lastY = null;
    ctx.input.buildSpellHeld = false;
    ctx.input.bombCharge = -1;
    ctx.input.siphonHeld = false;
    ctx.input.pourHeld = false;
    ctx.input.drinkHeld = false;
    ctx.player.firing = false;
    ctx.player.climbing = false;
    if (ctx.input.activeChargingBlackHole) {
      ctx.input.activeChargingBlackHole.charging = false;
      ctx.input.activeChargingBlackHole = null;
    }
  }

  private requestRunLauncher(source: 'play-button' | 'tab' | 'fullscreen'): boolean {
    const event = new CustomEvent('run-launcher-request', {
      cancelable: true,
      detail: { source },
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (this.shouldIgnoreKeyboard(e)) return;
    const { ctx } = this;
    this.claimPlayKey(e);

    ctx.audio.ensure();
    if (e.code === 'Tab') {
      e.preventDefault();
      if (
        ctx.state.mode === 'build' &&
        !document.body.classList.contains('builder-open') &&
        ctx.state.playtestSource !== 'builder' &&
        this.requestRunLauncher('tab')
      ) {
        return;
      }
      this.setMode(ctx.state.mode === 'build' ? 'play' : 'build');
      return;
    }

    if (ctx.state.mode !== 'play') {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        e.preventDefault();
        this.setKeyHeld(e.code, true);
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        e.preventDefault();
        this.setKeyHeld(e.code, true);
      } else if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.setKeyHeld(e.code, true);
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        e.preventDefault();
        this.setKeyHeld(e.code, true);
      } else if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1;
        if (n >= 0 && n < SPELL_ORDER.length) {
          ctx.player.spell = SPELL_ORDER[n];
          ctx.input.bombCharge = -1;
        }
      }
      return;
    }

    if (ctx.state.mode === 'play') {
      if (
        e.code === 'KeyA' ||
        e.code === 'ArrowLeft' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowRight' ||
        e.code === 'Space' ||
        e.code === 'KeyW' ||
        e.code === 'ArrowUp' ||
        e.code === 'KeyS' ||
        e.code === 'ArrowDown' ||
        GRAB_KEY_CODES.has(e.code)
      )
        this.setKeyHeld(e.code, true);
      else if (e.code === 'KeyR' && ctx.player.dead) ctx.playerCtl.respawn();
      else if (e.code === 'KeyE' && !ctx.player.climbing) {
        // Context-sensitive E: a lever in reach starts the hand-pull (both
        // hands busy — no siphon); otherwise the hold siphons the flask.
        const pulling = !e.repeat && ctx.mechanisms.interact(ctx);
        if (!pulling) ctx.input.siphonHeld = true;
      }
      else if (e.code === 'KeyQ' && !ctx.player.climbing) ctx.input.pourHeld = true;
      else if (e.code === 'KeyX' && !ctx.player.climbing) ctx.input.drinkHeld = true;
      else if (e.code === 'KeyF' && !ctx.player.dead && !ctx.player.climbing)
        ctx.flask.throwFlask(ctx);
      else if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1;
        // Wave D: digits pick wands in play, not spells — 1/2 only, 3-7 are dead keys
        if (n === 0 || n === 1) this.selectWand(n);
      }
      return;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const { ctx } = this;
    if (!this.shouldIgnoreKeyboard(e)) this.claimPlayKey(e);

    if (this.isTrackedHeldKey(e.code)) this.setKeyHeld(e.code, false);
    else if (e.code === 'KeyE') ctx.input.siphonHeld = false;
    else if (e.code === 'KeyQ') ctx.input.pourHeld = false;
    else if (e.code === 'KeyX') ctx.input.drinkHeld = false;
  }

  private stageElement(): HTMLElement | null {
    return document.getElementById('canvas-holder');
  }

  private isStageFullscreen(): boolean {
    const stage = this.stageElement();
    return Boolean(stage && document.fullscreenElement === stage);
  }

  private async requestStageFullscreen(target: HTMLElement): Promise<void> {
    if (document.fullscreenElement === target) return;
    if (document.fullscreenElement) {
      this.ctx.events.emit('toast', { text: 'EXIT OTHER FULLSCREEN FIRST' });
      return;
    }
    if (!target.requestFullscreen) {
      this.ctx.events.emit('toast', { text: 'FULLSCREEN UNAVAILABLE' });
      return;
    }

    try {
      await target.requestFullscreen({
        navigationUI: 'hide',
        keyboardLock: 'browser',
      } as FullscreenOptionsWithKeyboardLock);
    } catch (firstError) {
      const name = firstError instanceof DOMException ? firstError.name : '';
      if (name !== 'NotSupportedError' && name !== 'TypeError') {
        console.warn('Fullscreen request failed', firstError);
        this.ctx.events.emit('toast', { text: 'FULLSCREEN BLOCKED' });
        return;
      }
      try {
        await target.requestFullscreen({ navigationUI: 'hide' });
      } catch (fallbackError) {
        console.warn('Fullscreen fallback failed', { firstError, fallbackError });
        this.ctx.events.emit('toast', { text: 'FULLSCREEN BLOCKED' });
      }
    }
  }

  private async enterImmersivePlay(): Promise<void> {
    this.ctx.audio.ensure();
    if (
      this.ctx.state.mode !== 'play' &&
      !document.body.classList.contains('builder-open') &&
      this.ctx.state.playtestSource !== 'builder' &&
      this.requestRunLauncher('fullscreen')
    ) {
      this.syncImmersiveButton();
      return;
    }
    const target = this.stageElement() ?? this.canvas;
    await this.requestStageFullscreen(target);

    this.setMode('play');
    await this.lockKeyboard();
    this.syncImmersiveButton();
  }

  private async lockKeyboard(): Promise<void> {
    if (!this.isStageFullscreen()) {
      this.keyboardLocked = false;
      return;
    }
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
    if (!keyboard?.lock) {
      this.keyboardLocked = false;
      this.ctx.events.emit('toast', { text: 'FULLSCREEN ACTIVE' });
      return;
    }
    try {
      await keyboard.lock(KEYBOARD_LOCK_CODES);
      this.keyboardLocked = true;
      this.ctx.events.emit('toast', { text: 'KEYBOARD LOCK ACTIVE' });
    } catch {
      this.keyboardLocked = false;
      this.ctx.events.emit('toast', { text: 'FULLSCREEN ACTIVE' });
    }
  }

  private unlockKeyboard(): void {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
    keyboard?.unlock?.();
    this.keyboardLocked = false;
  }

  private exitImmersive(): void {
    this.unlockKeyboard();
    const stage = this.stageElement();
    if (stage && document.fullscreenElement === stage) {
      void document.exitFullscreen().catch(() => undefined);
    }
    this.syncImmersiveButton();
  }

  private onFullscreenChange(): void {
    if (!this.isStageFullscreen()) {
      this.unlockKeyboard();
      this.clearHeldInput();
    }
    this.syncImmersiveButton();
  }

  private syncImmersiveButton(): void {
    const btn = document.getElementById('immersive-play-btn');
    if (!btn) return;
    const fullscreen = this.isStageFullscreen();
    btn.classList.toggle('lit', fullscreen);
    btn.textContent = fullscreen
      ? this.keyboardLocked
        ? 'KEYS LOCKED'
        : 'FULLSCREEN'
      : 'FULLSCREEN PLAY';
    btn.title = fullscreen
      ? 'Fullscreen play is active. Long-press Esc or leave play mode to exit.'
      : 'Enter fullscreen play with keyboard lock when the browser supports it';
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
      this.clearHeldInput();
      this.exitImmersive();
    }
  }
}
