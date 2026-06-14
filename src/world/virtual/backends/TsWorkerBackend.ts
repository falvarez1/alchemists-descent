import type {
  GenerateChunkRequest,
  GenerateWindowRequest,
  TransferableVirtualChunk,
  VirtualWorldDef,
  WindowMetrics,
} from '@/world/virtual/types';
import type {
  BackendInfo,
  GenerateChunkResult,
  GenerateWindowResult,
  VirtualWorkerRequest,
  VirtualWorkerResponse,
  VirtualWorldBackend,
} from '@/world/virtual/backends/BackendTypes';

interface PendingWindow {
  chunks: TransferableVirtualChunk[];
  resolve: (result: GenerateWindowResult) => void;
  reject: (error: Error) => void;
}

export class TsWorkerBackend implements VirtualWorldBackend {
  readonly info: BackendInfo = {
    kind: 'ts-worker',
    label: 'TypeScript Worker',
    available: typeof Worker !== 'undefined',
    authoritativeCells: true,
    details: {},
  };

  private worker: Worker | null = null;
  private readyResolvers: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private pendingChunks = new Map<number, { resolve: (result: GenerateChunkResult) => void; reject: (error: Error) => void }>();
  private pendingWindows = new Map<number, PendingWindow>();

  async init(def: VirtualWorldDef): Promise<void> {
    this.ensureWorker();
    return this.sendReady({ kind: 'init', def });
  }

  async updateDef(def: VirtualWorldDef): Promise<void> {
    this.ensureWorker();
    return this.sendReady({ kind: 'updateDef', def });
  }

  generateChunk(req: GenerateChunkRequest): Promise<GenerateChunkResult> {
    this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pendingChunks.set(req.jobId, { resolve, reject });
      this.post({ kind: 'generateChunk', req });
    });
  }

  generateWindow(req: GenerateWindowRequest): Promise<GenerateWindowResult> {
    this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pendingWindows.set(req.jobId, { chunks: [], resolve, reject });
      this.post({ kind: 'generateWindow', req });
    });
  }

  cancel(jobId: number): void {
    this.post({ kind: 'cancel', jobId });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    const error = new Error('Virtual world backend disposed');
    for (const pending of this.readyResolvers) pending.reject(error);
    this.readyResolvers.length = 0;
    for (const pending of this.pendingChunks.values()) pending.reject(error);
    this.pendingChunks.clear();
    for (const pending of this.pendingWindows.values()) pending.reject(error);
    this.pendingWindows.clear();
  }

  private ensureWorker(): void {
    if (this.worker) return;
    if (typeof Worker === 'undefined') throw new Error('Web Workers are not available in this environment');
    this.worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<VirtualWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    this.worker.addEventListener('error', (event) => {
      this.rejectAll(new Error(event.message || 'Virtual world worker error'));
    });
  }

  private sendReady(message: Extract<VirtualWorkerRequest, { kind: 'init' | 'updateDef' }>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyResolvers.push({ resolve, reject });
      this.post(message);
    });
  }

  private post(message: VirtualWorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private handleMessage(message: VirtualWorkerResponse): void {
    if (message.kind === 'ready') {
      const pending = this.readyResolvers.shift();
      pending?.resolve();
      return;
    }
    if (message.kind === 'chunk') {
      const pendingChunk = this.pendingChunks.get(message.jobId);
      if (pendingChunk) {
        this.pendingChunks.delete(message.jobId);
        pendingChunk.resolve({ chunk: message.chunk });
        return;
      }
      const pendingWindow = this.pendingWindows.get(message.jobId);
      if (pendingWindow) pendingWindow.chunks.push(message.chunk);
      return;
    }
    if (message.kind === 'windowDone') {
      this.resolveWindow(message.jobId, message.metrics);
      return;
    }
    if (message.kind === 'canceled') {
      this.rejectJob(message.jobId, new Error(`Virtual world job ${message.jobId} canceled`));
      return;
    }
    if (message.kind === 'error') {
      const error = new Error(message.message);
      if (message.jobId !== undefined) this.rejectJob(message.jobId, error);
      else this.rejectAll(error);
    }
  }

  private resolveWindow(jobId: number, metrics: WindowMetrics): void {
    const pending = this.pendingWindows.get(jobId);
    if (!pending) return;
    this.pendingWindows.delete(jobId);
    pending.resolve({ chunks: pending.chunks, metrics });
  }

  private rejectJob(jobId: number, error: Error): void {
    const chunk = this.pendingChunks.get(jobId);
    if (chunk) {
      this.pendingChunks.delete(jobId);
      chunk.reject(error);
    }
    const window = this.pendingWindows.get(jobId);
    if (window) {
      this.pendingWindows.delete(jobId);
      window.reject(error);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.readyResolvers) pending.reject(error);
    this.readyResolvers.length = 0;
    for (const pending of this.pendingChunks.values()) pending.reject(error);
    this.pendingChunks.clear();
    for (const pending of this.pendingWindows.values()) pending.reject(error);
    this.pendingWindows.clear();
  }
}
