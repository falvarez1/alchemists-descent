import type { EventMap } from '@/core/events';
import type { AuthoredLight, BiomeId, Ctx, GameMode, PlaytestSource } from '@/core/types';

export interface BuilderModeSnapshot {
  mode: GameMode;
  paused: boolean;
  currentBiome: BiomeId;
  worldSeed: number;
  playtestSource: PlaytestSource | null;
  hasCurrentLevel: boolean;
}

export interface BuilderCameraSnapshot {
  x: number;
  y: number;
  zoom: number;
  zoomLock: number | null;
}

export type BuilderHostEventMap = Pick<EventMap, 'modeChanged' | 'worldEdited'>;
export type BuilderHostEventType = keyof BuilderHostEventMap;

export type BuilderPauseReason = 'authoring-session' | 'open-intent-modal' | 'settle-preview' | 'playtest-lifecycle';

export interface BuilderPauseClaim {
  readonly id: number;
  readonly reason: BuilderPauseReason;
  readonly held: boolean;
}

export interface BuilderPauseClaimOptions {
  /**
   * Used only when ownership is intentionally transferred from another Builder
   * pause owner, such as the open-intent modal handing its pause to the editor.
   */
  inheritExisting?: boolean;
}

export interface BuilderVisualStatePatch {
  editorLights?: AuthoredLight[] | null;
  wandLightPreviewEnabled?: boolean;
}

export interface BuilderHost {
  getModeSnapshot(): BuilderModeSnapshot;
  getCameraSnapshot(): BuilderCameraSnapshot;
  subscribe<K extends BuilderHostEventType>(type: K, handler: (payload: BuilderHostEventMap[K]) => void): () => void;
  toast(text: string): void;
  notifyParamsChanged(): void;
  claimPause(reason: BuilderPauseReason, options?: BuilderPauseClaimOptions): BuilderPauseClaim;
  releasePause(claim: BuilderPauseClaim | null): void;
  setPaused(paused: boolean, reason: BuilderPauseReason): void;
  snapCameraTo(x: number, y: number): void;
  setCameraZoomLock(value: number | null): void;
  setBuilderVisualState(patch: BuilderVisualStatePatch): void;
}

class RuntimeBuilderHost implements BuilderHost {
  private nextPauseClaimId = 1;
  private readonly activePauseClaims = new Set<number>();

  constructor(private readonly ctx: Ctx) {}

  getModeSnapshot(): BuilderModeSnapshot {
    return {
      mode: this.ctx.state.mode,
      paused: this.ctx.state.paused,
      currentBiome: this.ctx.state.currentBiome,
      worldSeed: this.ctx.state.worldSeed >>> 0,
      playtestSource: this.ctx.state.playtestSource,
      hasCurrentLevel: this.ctx.levels.current !== null,
    };
  }

  getCameraSnapshot(): BuilderCameraSnapshot {
    return {
      x: this.ctx.camera.x,
      y: this.ctx.camera.y,
      zoom: this.ctx.camera.zoom,
      zoomLock: this.ctx.camera.zoomLock,
    };
  }

  subscribe<K extends BuilderHostEventType>(type: K, handler: (payload: BuilderHostEventMap[K]) => void): () => void {
    return this.ctx.events.on(type, handler);
  }

  toast(text: string): void {
    this.ctx.events.emit('toast', { text });
  }

  notifyParamsChanged(): void {
    this.ctx.events.emit('paramsChanged');
  }

  claimPause(reason: BuilderPauseReason, options: BuilderPauseClaimOptions = {}): BuilderPauseClaim {
    const alreadyPaused = this.ctx.state.paused;
    const held = !alreadyPaused || options.inheritExisting === true;
    const claim: BuilderPauseClaim = {
      id: this.nextPauseClaimId++,
      reason,
      held,
    };
    if (!held) return claim;
    this.activePauseClaims.add(claim.id);
    this.ctx.state.paused = true;
    return claim;
  }

  releasePause(claim: BuilderPauseClaim | null): void {
    if (!claim?.held || !this.activePauseClaims.delete(claim.id)) return;
    this.ctx.state.paused = false;
  }

  setPaused(paused: boolean, _reason: BuilderPauseReason): void {
    this.ctx.state.paused = paused;
  }

  snapCameraTo(x: number, y: number): void {
    this.ctx.camera.snapTo(x, y);
  }

  setCameraZoomLock(value: number | null): void {
    this.ctx.camera.zoomLock = value;
  }

  setBuilderVisualState(patch: BuilderVisualStatePatch): void {
    if ('editorLights' in patch) this.ctx.state.editorLights = patch.editorLights ?? null;
    if (patch.wandLightPreviewEnabled !== undefined) {
      this.ctx.state.builderWandLightPreview.enabled = patch.wandLightPreviewEnabled;
    }
  }
}

export function createBuilderHost(ctx: Ctx): BuilderHost {
  return new RuntimeBuilderHost(ctx);
}
