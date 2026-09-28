import type { Ctx } from '@/core/types';
import type { GpuInfo } from '@/render/gpuInfo';

const DISMISS_KEY = 'ad.gpuNotice.dismissed';

// ===================== Integrated-GPU notice =====================
/**
 * The page already asks for the high-performance adapter, but on Windows the
 * browser's GPU process runs on whichever adapter Windows assigns the browser.
 * When the first play session lands on an integrated chip, say so once, name
 * the chip, and give the one setting that fixes it. Dismissal is remembered
 * per adapter, so switching GPUs and landing back on the iGPU asks again.
 */
export class GpuNotice {
  private root: HTMLDivElement | null = null;
  private readonly off: () => void;

  constructor(ctx: Ctx, private readonly gpu: () => GpuInfo | undefined) {
    this.off = ctx.events.on('modeChanged', ({ mode }) => {
      if (mode === 'play') this.maybeShow();
    });
  }

  dispose(): void {
    this.off();
    this.root?.remove();
    this.root = null;
  }

  private maybeShow(): void {
    if (this.root) return;
    const gpu = this.gpu();
    if (!gpu || gpu.kind !== 'integrated') return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === gpu.renderer) return;
    } catch {
      // storage blocked: show it, it just won't stay dismissed
    }
    const root = document.createElement('div');
    root.className = 'gpu-notice';
    root.setAttribute('role', 'status');
    Object.assign(root.style, {
      position: 'fixed',
      left: '50%',
      bottom: '22px',
      transform: 'translateX(-50%)',
      zIndex: '9000',
      maxWidth: 'min(560px, calc(100vw - 32px))',
      boxSizing: 'border-box',
      padding: '12px 14px',
      background: 'rgba(12, 14, 20, 0.92)',
      border: '1px solid #3a4454',
      borderRadius: '6px',
      color: '#dfe6ee',
      font: "13px/1.45 system-ui, 'Segoe UI', sans-serif",
      pointerEvents: 'auto',
      boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    });
    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '4px';
    title.textContent = `Running on integrated graphics (${gpu.name})`;
    const body = document.createElement('div');
    body.textContent =
      'If this machine also has a dedicated GPU (NVIDIA / AMD), point your browser at it: ' +
      'Windows Settings › System › Display › Graphics › your browser › Options › High performance, ' +
      'then fully restart the browser. The game already requests the fast GPU, but Windows decides.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Got it';
    Object.assign(close.style, {
      marginTop: '8px',
      padding: '3px 12px',
      background: '#26303e',
      color: '#dfe6ee',
      border: '1px solid #45536a',
      borderRadius: '4px',
      cursor: 'pointer',
      font: 'inherit',
    });
    close.addEventListener('click', () => {
      try {
        localStorage.setItem(DISMISS_KEY, gpu.renderer);
      } catch {
        // storage blocked: dismiss for this page only
      }
      close.blur();
      root.remove();
      this.root = null;
    });
    root.append(title, body, close);
    document.body.appendChild(root);
    this.root = root;
  }
}
