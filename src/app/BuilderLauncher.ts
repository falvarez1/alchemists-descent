import type { Ctx } from '@/core/types';
import { createBuilderHost } from '@/app/BuilderHost';
import type { BuilderHost } from '@/app/BuilderHost';

interface LazyBuilder {
  open(): void;
  dispose(): void;
  toggleFromLauncher?: () => void;
}

type BuilderWindow = Window & { __game?: { ctx: Ctx }; __builderLoadError?: unknown };

const DISPOSED_LOAD_ERROR = 'BuilderLauncher disposed during lazy load';

/**
 * Shell-owned Builder entry point. Keeps `Game` from importing Builder while
 * preserving the header button and dev reload behavior.
 */
export class BuilderLauncher {
  private readonly button: HTMLButtonElement;
  private readonly createdButton: boolean;
  private builderPromise: Promise<LazyBuilder> | null = null;
  private builder: LazyBuilder | null = null;
  private readonly host: BuilderHost;
  private disposed = false;

  constructor(private readonly ctx: Ctx) {
    this.host = createBuilderHost(ctx);
    const existing = document.getElementById('mode-builder-btn') as HTMLButtonElement | null;
    this.button = existing ?? document.createElement('button');
    this.createdButton = existing === null;
    this.button.id = 'mode-builder-btn';
    this.button.textContent = 'BUILDER';
    this.button.addEventListener('click', this.onClick);
    if (this.createdButton) document.querySelector('.mode-switch')?.appendChild(this.button);
  }

  dispose(): void {
    this.disposed = true;
    this.button.removeEventListener('click', this.onClick);
    const builder = this.builder;
    builder?.dispose();
    this.builder = null;
    if (this.createdButton) this.button.remove();
    if (import.meta.env.DEV) {
      const debugCtx = this.ctx as Ctx & { builder?: LazyBuilder };
      if (debugCtx.builder === builder) delete debugCtx.builder;
    }
  }

  open(): void {
    if (this.disposed) return;
    void this.load()
      .then((builder) => {
        if (!this.disposed) builder.open();
      })
      .catch(() => undefined);
  }

  private readonly onClick = (): void => {
    if (this.disposed) return;
    void this.load()
      .then((builder) => {
        if (this.disposed) return;
        if (builder.toggleFromLauncher) builder.toggleFromLauncher();
        else builder.open();
      })
      .catch(() => undefined);
  };

  private load(): Promise<LazyBuilder> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED_LOAD_ERROR));
    if (this.builderPromise) return this.builderPromise;
    this.button.disabled = true;
    this.button.classList.add('loading');
    this.button.classList.remove('load-error');
    this.button.textContent = 'BUILDER';
    this.button.removeAttribute('title');
    this.builderPromise = import('@/builder/Builder')
      .then(({ Builder }) => {
        if (this.disposed) throw new Error(DISPOSED_LOAD_ERROR);
        const builder = new Builder({ ctx: this.ctx, host: this.host }) as LazyBuilder;
        this.builder = builder;
        if (import.meta.env.DEV) {
          (this.ctx as Ctx & { builder?: LazyBuilder }).builder = builder;
        }
        return builder;
      })
      .catch((error) => {
        if (!this.disposed) {
          console.error('Builder failed to load', error);
          (window as BuilderWindow).__builderLoadError = error;
          this.button.classList.add('load-error');
          this.button.textContent = 'BUILDER !';
          this.button.title = 'Builder failed to load. Check the console, then click to retry.';
          this.host.toast('BUILDER LOAD FAILED');
        }
        this.builderPromise = null;
        throw error;
      })
      .finally(() => {
        this.button.disabled = false;
        this.button.classList.remove('loading');
      });
    return this.builderPromise;
  }
}
