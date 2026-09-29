import type { Ctx } from '@/core/types';
import { readTouchControlsPreference, touchControlsEnabled, touchStickVector } from '@/input/touchSupport';
import '@/styles/mobile.css';

interface TouchInputPort {
  canPlay(): boolean;
  key(code: string, held: boolean): void;
  fire(held: boolean): void;
  aim(x: number, y: number): void;
  action(action: 'wand' | 'flask' | 'throw'): void;
}

type Contact = { element: HTMLElement; kind: string; x: number; y: number; radius: number };

/** DOM input adapter. Uses the same gameplay actions as keyboard/controller input. */
export class MobileControls {
  private readonly root = document.createElement('div');
  private readonly abort = new AbortController();
  private readonly coarse = window.matchMedia('(pointer: coarse)');
  private readonly contacts = new Map<number, Contact>();
  private preference = readTouchControlsPreference();
  private enabled = false;
  private playable = false;
  private disposed = false;
  private aim: { x: number; y: number } | null = null;
  private fireHeld = false;
  private aimOnly = false;
  private wake: WakeLockSentinel | null = null;
  private wakePending = false;
  private wakeAttempted = false;
  private readonly tray: HTMLElement;
  private readonly toolsButton: HTMLButtonElement;
  private readonly wandButton: HTMLButtonElement;

  constructor(private readonly ctx: Ctx, private readonly port: TouchInputPort) {
    this.root.id = 'mobile-controls';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Touch controls');
    this.root.innerHTML = `
      <div class="touch-topbar">
        <button type="button" data-touch-menu="tools" aria-expanded="false" aria-controls="touch-tools">Tools</button>
        <button type="button" data-touch-menu="fullscreen">Full screen</button>
        <button type="button" data-touch-menu="pause">Pause</button>
      </div>
      <div id="touch-tools" hidden>
        <p>Hold the left pad to move or climb. Drag the right pad to aim and cast. Hold Jump to fly.</p>
        <button type="button" data-touch-menu="aim" aria-pressed="false">Aim only: off</button>
        <button type="button" data-touch-action="flask">Next flask</button>
        <button type="button" data-touch-action="throw">Throw</button>
        <button type="button" data-touch-key="KeyQ">Pour</button>
        <button type="button" data-touch-key="KeyX">Drink</button>
        <button type="button" data-touch-key="KeyG">Carry / swing</button>
        <button type="button" data-touch-key="KeyV">Glowseed</button>
        <button type="button" data-touch-key="KeyL">Lantern</button>
        <p>Use lifts or sets down objects, talks, and operates mechanisms. Hold Use to fill a flask. Aim only lets you aim without casting.</p>
      </div>
      <div class="touch-left">
        <div class="touch-actions"><button type="button" data-touch-key="ShiftLeft">Grip</button><button type="button" data-touch-key="Space">Jump</button></div>
        <div class="touch-stick" data-touch-stick="move" role="group" aria-label="Movement pad: drag to move, up to climb, down to crouch"><span>Move</span><i></i></div>
      </div>
      <div class="touch-right">
        <div class="touch-actions"><button type="button" data-touch-key="KeyE">Use</button><button type="button" data-touch-key="KeyF">Kick</button><button type="button" data-touch-action="wand">Wand</button></div>
        <div class="touch-stick" data-touch-stick="aim" role="group" aria-label="Aim pad: drag to aim and cast"><span>Aim / cast</span><i></i></div>
      </div>
      <p class="touch-portrait-note">Turn sideways for a larger view</p>`;
    document.getElementById('canvas-holder')?.appendChild(this.root);
    this.tray = this.root.querySelector('#touch-tools')!;
    this.toolsButton = this.root.querySelector('[data-touch-menu="tools"]')!;
    this.wandButton = this.root.querySelector('[data-touch-action="wand"]')!;
    const options = { signal: this.abort.signal };
    this.root.addEventListener('pointerdown', this.onDown, options);
    this.root.addEventListener('pointermove', this.onMove, options);
    this.root.addEventListener('pointerup', this.onUp, options);
    this.root.addEventListener('pointercancel', this.onUp, options);
    this.root.addEventListener('lostpointercapture', this.onUp, options);
    this.root.addEventListener('contextmenu', event => event.preventDefault(), options);
    this.root.addEventListener('click', this.onClick, options);
    this.coarse.addEventListener('change', this.detect, options);
    window.addEventListener('touch-controls-change', event => {
      const value: unknown = (event as CustomEvent).detail;
      if (value === 'auto' || value === 'on' || value === 'off') this.preference = value;
      this.detect();
    }, options);
    window.addEventListener('blur', this.onBackground, options);
    window.addEventListener('pagehide', this.onBackground, options);
    window.addEventListener('resize', () => this.reset(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onBackground();
    }, options);
    this.detect();
  }

  private readonly detect = (): void => {
    this.enabled = touchControlsEnabled(this.preference);
    document.body.classList.toggle('touch-enabled', this.enabled);
    if (!this.enabled) this.reset();
    this.update();
  };

  /** Called before simulation ticks, including while a menu owns the pause. */
  update(): void {
    const playable = this.enabled && !document.hidden && this.port.canPlay();
    if (!playable) {
      if (this.playable) this.reset();
      this.releaseWake();
      this.wakeAttempted = false;
    } else if (!this.playable) {
      void this.keepAwake();
    }
    this.playable = playable;
    if (this.root.hidden === playable) this.root.hidden = !playable;
    if (playable && this.aim) this.port.aim(this.aim.x, this.aim.y);
    const wandLabel = `Wand ${this.ctx.wands.active + 1}`;
    if (this.wandButton.textContent !== wandLabel) this.wandButton.textContent = wandLabel;
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.enabled || !this.port.canPlay() || event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-touch-stick], [data-touch-key], [data-touch-action]');
    if (!element || [...this.contacts.values()].some(contact => contact.element === element)) return;
    event.preventDefault(); // Prevent compatibility mouse input and text selection on held controls.
    this.ctx.audio.ensure(); // Audio unlock must run inside the real user gesture.
    const rect = element.getBoundingClientRect();
    const kind = element.dataset.touchStick ?? element.dataset.touchKey ?? element.dataset.touchAction!;
    const contact = { element, kind, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width * 0.36 };
    this.contacts.set(event.pointerId, contact);
    element.setPointerCapture(event.pointerId);
    element.classList.add('held');
    if (kind === 'move' || kind === 'aim') this.move(contact, event);
    else if (kind === 'wand' || kind === 'flask' || kind === 'throw') this.port.action(kind);
    else this.port.key(kind, true);
  };

  private readonly onMove = (event: PointerEvent): void => {
    const contact = this.contacts.get(event.pointerId);
    if (!contact) return;
    if (!this.port.canPlay()) { this.reset(); return; }
    event.preventDefault();
    this.move(contact, event);
  };

  private move(contact: Contact, event: PointerEvent): void {
    if (contact.kind !== 'move' && contact.kind !== 'aim') return;
    const vector = touchStickVector(event.clientX - contact.x, event.clientY - contact.y, contact.radius);
    contact.element.style.setProperty('--thumb-x', `${vector.x * contact.radius}px`);
    contact.element.style.setProperty('--thumb-y', `${vector.y * contact.radius}px`);
    if (contact.kind === 'move') {
      this.port.key('KeyA', vector.x < -0.25);
      this.port.key('KeyD', vector.x > 0.25);
      this.port.key('ArrowUp', vector.y < -0.45);
      this.port.key('KeyS', vector.y > 0.45);
    } else {
      const aiming = vector.x !== 0 || vector.y !== 0;
      if (aiming) {
        this.aim = vector;
        this.port.aim(vector.x, vector.y);
      }
      this.setFire(aiming && !this.aimOnly);
    }
  }

  private setFire(held: boolean): void {
    if (this.fireHeld === held) return;
    this.fireHeld = held;
    this.port.fire(held);
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (event.type === 'pointercancel' && this.contacts.has(event.pointerId)) {
      this.ctx.input.queuedJump = undefined;
      this.ctx.player.firePressed = false;
    }
    this.releaseContact(event.pointerId);
  };

  private releaseContact(id: number): void {
    const contact = this.contacts.get(id);
    if (!contact) return;
    this.contacts.delete(id); // Delete before releasing capture; lostpointercapture can re-enter.
    contact.element.classList.remove('held');
    contact.element.style.removeProperty('--thumb-x');
    contact.element.style.removeProperty('--thumb-y');
    if (contact.element.hasPointerCapture(id)) contact.element.releasePointerCapture(id);
    if (contact.kind === 'move') {
      for (const code of ['KeyA', 'KeyD', 'ArrowUp', 'KeyS']) this.port.key(code, false);
    } else if (contact.kind === 'aim') this.setFire(false);
    else this.port.key(contact.kind, false);
  }

  /** Also called by InputManager on mode/level transitions and modal ownership changes. */
  reset(): void {
    if (this.contacts.size > 0) {
      this.ctx.input.queuedJump = undefined;
      this.ctx.player.firePressed = false;
    }
    for (const id of this.contacts.keys()) this.releaseContact(id);
    this.aim = null;
    this.setFire(false);
    this.tray.hidden = true;
    this.toolsButton.setAttribute('aria-expanded', 'false');
  }

  private readonly onBackground = (): void => {
    this.reset();
    this.releaseWake();
    if (this.enabled && this.port.canPlay()) window.dispatchEvent(new Event('game-pause-request'));
  };

  private readonly onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.port.canPlay()) return;
    // Keyboard and assistive activation of the same semantic buttons.
    if (event.detail === 0 && button.dataset.touchKey) {
      this.port.key(button.dataset.touchKey, true);
      this.port.key(button.dataset.touchKey, false);
    }
    if (event.detail === 0) {
      const action = button.dataset.touchAction;
      if (action === 'wand' || action === 'flask' || action === 'throw') this.port.action(action);
    }
    switch (button.dataset.touchMenu) {
      case 'tools':
        this.tray.hidden = !this.tray.hidden;
        this.toolsButton.setAttribute('aria-expanded', String(!this.tray.hidden));
        break;
      case 'aim':
        this.aimOnly = !this.aimOnly;
        this.setFire(false);
        button.setAttribute('aria-pressed', String(this.aimOnly));
        button.textContent = `Aim only: ${this.aimOnly ? 'on' : 'off'}`;
        this.root.querySelector('[data-touch-stick="aim"] span')!.textContent = this.aimOnly ? 'Aim' : 'Aim / cast';
        break;
      case 'pause': this.reset(); window.dispatchEvent(new Event('game-pause-request')); break;
      case 'fullscreen': void this.fullscreen(); break;
    }
  };

  private async fullscreen(): Promise<void> {
    const stage = document.getElementById('canvas-holder');
    if (!stage?.requestFullscreen) {
      this.ctx.events.emit('toast', { text: 'Play here in your browser. Full screen is unavailable on this device.' });
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen({ navigationUI: 'hide' });
    } catch { this.ctx.events.emit('toast', { text: 'Full screen unavailable. You can keep playing here.' }); }
  }

  private async keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wake || this.wakePending || this.wakeAttempted) return;
    this.wakeAttempted = true;
    this.wakePending = true;
    try {
      const wake = await navigator.wakeLock.request('screen');
      if (this.disposed || !this.enabled || document.hidden || !this.port.canPlay()) await wake.release();
      else {
        this.wake = wake;
        wake.addEventListener('release', () => { if (this.wake === wake) this.wake = null; }, { once: true });
      }
    } catch { /* Optional: battery saver, insecure origins and older browsers can refuse. */ }
    finally { this.wakePending = false; }
  }

  private releaseWake(): void {
    const wake = this.wake;
    this.wake = null;
    if (wake) void wake.release().catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
    this.releaseWake();
    this.abort.abort();
    this.root.remove();
    document.body.classList.remove('touch-enabled');
  }
}
