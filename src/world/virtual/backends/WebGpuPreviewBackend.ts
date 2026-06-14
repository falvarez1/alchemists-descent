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

export class WebGpuPreviewBackend implements VirtualWorldBackend {
  readonly info: BackendInfo;

  constructor() {
    this.info = {
      kind: 'webgpu-preview',
      label: 'WebGPU Preview',
      available: typeof navigator !== 'undefined' && 'gpu' in navigator,
      authoritativeCells: false,
      details: {},
    };
  }

  async init(_def: VirtualWorldDef): Promise<void> {
    throw new Error('WebGPU preview backend is a planned accelerator and is not implemented yet');
  }

  async updateDef(_def: VirtualWorldDef): Promise<void> {
    throw new Error('WebGPU preview backend is a planned accelerator and is not implemented yet');
  }

  async generateChunk(_req: GenerateChunkRequest): Promise<GenerateChunkResult> {
    throw new Error('WebGPU preview backend does not produce authoritative chunks');
  }

  async generateWindow(_req: GenerateWindowRequest): Promise<GenerateWindowResult> {
    throw new Error('WebGPU preview backend is not implemented yet');
  }

  cancel(_jobId: number): void {
    // No-op until implemented.
  }

  dispose(): void {
    // No-op until implemented.
  }
}
