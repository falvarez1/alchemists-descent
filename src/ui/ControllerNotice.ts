import type { Ctx } from '@/core/types';

/** Recommend the primary versus input only while no standard controller is connected. */
export class ControllerNotice {
  private root: HTMLDivElement | null = null;
  private dismissed = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly off: () => void;

  constructor(private readonly ctx: Ctx) {
    this.off = ctx.events.on('modeChanged', this.refresh);
    window.addEventListener('gamepadconnected', this.refresh);
    window.addEventListener('gamepaddisconnected', this.refresh);
    this.timer = setInterval(this.refresh, 1000);
  }

  dispose(): void {
    this.off(); clearInterval(this.timer);
    window.removeEventListener('gamepadconnected', this.refresh);
    window.removeEventListener('gamepaddisconnected', this.refresh);
    this.root?.remove(); this.root = null;
  }

  private readonly refresh = (): void => {
    const connected = Array.from(navigator.getGamepads?.() ?? []).some(p => p?.connected && p.mapping === 'standard');
    const relevant = this.ctx.state.mode === 'play' && (this.ctx.arena?.active || this.ctx.versus?.phase === 'playing');
    if (!relevant || connected || this.dismissed) { this.root?.remove(); this.root = null; return; }
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'controller-notice'; root.setAttribute('role', 'status');
    Object.assign(root.style, {
      position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', zIndex: '9000',
      maxWidth: 'min(500px, calc(100vw - 32px))', boxSizing: 'border-box', padding: '12px 14px',
      background: 'rgba(12, 22, 32, .96)', border: '1px solid #65cac5', borderRadius: '6px',
      color: '#e8dcc0', font: '13px/1.45 system-ui, sans-serif', pointerEvents: 'auto',
    });
    const text = document.createElement('div');
    text.textContent = 'For the best Duel and Arena experience, connect an Xbox controller and press a button to activate it.';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Got it';
    Object.assign(close.style, { marginTop: '8px', padding: '4px 12px', background: '#293e51', color: '#e8dcc0', border: '1px solid #65cac5', borderRadius: '4px', font: 'inherit', cursor: 'pointer' });
    close.addEventListener('click', () => { this.dismissed = true; root.remove(); this.root = null; });
    root.append(text, close); document.body.appendChild(root); this.root = root;
  };
}
