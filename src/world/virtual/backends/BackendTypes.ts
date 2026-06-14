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
  available: boolean;
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
