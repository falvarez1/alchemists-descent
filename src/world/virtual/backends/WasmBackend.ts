import type {
  GenerateChunkRequest,
  GenerateWindowRequest,
  VirtualWorldDef,
} from '@/world/virtual/types';
import type {
  BackendInfo,
  GenerateChunkResult,
  GenerateWindowResult,
  VirtualWorldBackend,
} from '@/world/virtual/backends/BackendTypes';

export class WasmBackend implements VirtualWorldBackend {
  readonly info: BackendInfo = {
    kind: 'wasm',
    label: 'Wasm Kernels',
    available: typeof WebAssembly !== 'undefined',
    authoritativeCells: true,
    details: { threaded: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated },
  };

  async init(_def: VirtualWorldDef): Promise<void> {
    throw new Error('Wasm virtual world kernels are not implemented yet');
  }

  async updateDef(_def: VirtualWorldDef): Promise<void> {
    throw new Error('Wasm virtual world kernels are not implemented yet');
  }

  async generateChunk(_req: GenerateChunkRequest): Promise<GenerateChunkResult> {
    throw new Error('Wasm virtual world kernels are not implemented yet');
  }

  async generateWindow(_req: GenerateWindowRequest): Promise<GenerateWindowResult> {
    throw new Error('Wasm virtual world kernels are not implemented yet');
  }

  cancel(_jobId: number): void {
    // No-op until implemented.
  }

  dispose(): void {
    // No-op until implemented.
  }
}
