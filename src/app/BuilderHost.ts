import type { EventMap } from '@/core/events';
import type { AuthoredLight, BiomeId, Ctx, GameMode, PlaytestSource } from '@/core/types';
import type { CellPatch } from '@/authoring/cellPatch';
import type { AuthorLinkHandle, AuthorLinkWorldState } from '@/app/AuthorLink';
import type { AuthoredSet } from '@/app/authorLinkObjects';
import type { AuthorLinkStatus } from '@/net/authorLinkProtocol';

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
  /**
   * Forward a terrain stroke to any linked window (AuthorLink). A no-op when
   * no link is active, so Builder never has to branch on it. Routing through
   * the host keeps the editor free of a net-layer import and free of a
   * module-level singleton, which is the whole point of the host migration.
   */
  publishTerrainPatch(patch: CellPatch, label: string): void;
  /** Publish the document's authored records; a linked window re-instantiates them. */
  publishAuthoredSet(set: AuthoredSet): void;
  getLinkStatus(): AuthorLinkStatus | null;
  subscribeLinkStatus(handler: (status: AuthorLinkStatus) => void): () => void;
  /** Null when no link is active. `mismatch` means edits are being refused. */
  getLinkWorldState(): AuthorLinkWorldState | null;
  subscribeLinkWorldState(handler: (state: AuthorLinkWorldState) => void): () => void;
  /** Replace this window's grid with a linked peer's. Destructive; user-initiated only. */
  pullLinkedWorld(): Promise<boolean>;
}

class RuntimeBuilderHost implements BuilderHost {
  private nextPauseClaimId = 1;
  private readonly activePauseClaims = new Set<number>();
  private pauseOverride: boolean | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly link: AuthorLinkHandle | null = null,
  ) {}

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
    const held = !alreadyPaused || this.activePauseClaims.size > 0 || options.inheritExisting === true;
    const claim: BuilderPauseClaim = {
      id: this.nextPauseClaimId++,
      reason,
      held,
    };
    if (!held) return claim;
    this.activePauseClaims.add(claim.id);
    this.pauseOverride = null;
    this.syncPauseState();
    return claim;
  }

  releasePause(claim: BuilderPauseClaim | null): void {
    if (!claim?.held || !this.activePauseClaims.delete(claim.id)) return;
    this.syncPauseState();
  }

  setPaused(paused: boolean, reason: BuilderPauseReason): void {
    if (reason === 'settle-preview' && paused) this.pauseOverride = null;
    else this.pauseOverride = paused;
    this.syncPauseState();
  }

  private syncPauseState(): void {
    this.ctx.state.paused = this.pauseOverride ?? this.activePauseClaims.size > 0;
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

  publishTerrainPatch(patch: CellPatch, label: string): void {
    this.link?.publishTerrainPatch(patch, label);
  }

  publishAuthoredSet(set: AuthoredSet): void {
    this.link?.publishAuthoredSet(set);
  }

  getLinkStatus(): AuthorLinkStatus | null {
    return this.link?.getStatus() ?? null;
  }

  subscribeLinkStatus(handler: (status: AuthorLinkStatus) => void): () => void {
    return this.link?.onStatus(handler) ?? (() => undefined);
  }

  getLinkWorldState(): AuthorLinkWorldState | null {
    return this.link?.getWorldState() ?? null;
  }

  subscribeLinkWorldState(handler: (state: AuthorLinkWorldState) => void): () => void {
    return this.link?.onWorldState(handler) ?? (() => undefined);
  }

  pullLinkedWorld(): Promise<boolean> {
    return this.link?.pullWorldFrom() ?? Promise.resolve(false);
  }
}

export function createBuilderHost(ctx: Ctx, link: AuthorLinkHandle | null = null): BuilderHost {
  return new RuntimeBuilderHost(ctx, link);
}
