import type {
  GenerateChunkRequest,
  GenerateWindowRequest,
  TransferableVirtualChunk,
  VirtualWorldDef,
  WindowMetrics,
} from '@/world/virtual/types';

export type VirtualBackendKind = 'ts-worker' | 'webgpu-preview' | 'wasm';

export interface BackendInfo {
  kind: VirtualBackendKind;
  label: string;
  /** The platform capability this backend needs is present (Worker / navigator.gpu / WebAssembly). */
  available: boolean;
  /**
   * This backend is actually built and may be selected for generation. A backend can be
   * `available` (the platform supports it) yet not `implemented` (we haven't written it),
   * e.g. the WASM kernels: `WebAssembly` exists in every browser but the kernels do not.
   */
  implemented: boolean;
  /**
   * Produces byte-identical authoritative chunk cells/colors/life/charge. Only an
   * authoritative backend may feed playtest materialization; a preview backend is visual-only.
   */
  authoritativeCells: boolean;
  details: Record<string, string | number | boolean>;
}

export interface GenerateChunkResult {
  chunk: TransferableVirtualChunk;
}

export interface GenerateWindowResult {
  chunks: TransferableVirtualChunk[];
  metrics: WindowMetrics;
}

export interface VirtualWorldBackend {
  readonly info: BackendInfo;
  init(def: VirtualWorldDef): Promise<void>;
  updateDef(def: VirtualWorldDef): Promise<void>;
  generateChunk(req: GenerateChunkRequest): Promise<GenerateChunkResult>;
  generateWindow(req: GenerateWindowRequest): Promise<GenerateWindowResult>;
  cancel(jobId: number): void;
  dispose(): void;
}

export type VirtualWorkerRequest =
  | { kind: 'init'; def: VirtualWorldDef }
  | { kind: 'updateDef'; def: VirtualWorldDef }
  | { kind: 'generateChunk'; req: GenerateChunkRequest }
  | { kind: 'generateWindow'; req: GenerateWindowRequest }
  | { kind: 'cancel'; jobId: number };

export type VirtualWorkerResponse =
  | { kind: 'ready' }
  | { kind: 'chunk'; jobId: number; chunk: TransferableVirtualChunk }
  | { kind: 'windowDone'; jobId: number; metrics: WindowMetrics }
  | { kind: 'canceled'; jobId: number }
  | { kind: 'error'; jobId?: number; message: string; stack?: string };
