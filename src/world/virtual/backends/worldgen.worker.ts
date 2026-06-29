import { generateVirtualChunk } from '@/world/virtual/ChunkGenerator';
import type { VirtualWorldDef } from '@/world/virtual/types';
import { toTransferableChunk } from '@/world/virtual/transfer';
import type { VirtualWorkerRequest, VirtualWorkerResponse } from '@/world/virtual/backends/BackendTypes';

type WorkerLike = {
  postMessage(message: VirtualWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<VirtualWorkerRequest>) => void): void;
};

const worker = self as unknown as WorkerLike;
let def: VirtualWorldDef | null = null;
let defVersion = 0;
const canceled = new Set<number>();

worker.addEventListener('message', (event) => {
  void handleMessage(event.data);
});

async function handleMessage(msg: VirtualWorkerRequest): Promise<void> {
  try {
    if (msg.kind === 'init' || msg.kind === 'updateDef') {
      def = msg.def;
      defVersion++;
      canceled.clear();
      worker.postMessage({ kind: 'ready' });
      return;
    }
    if (msg.kind === 'cancel') {
      canceled.add(msg.jobId);
      worker.postMessage({ kind: 'canceled', jobId: msg.jobId });
      return;
    }
    if (!def) throw new Error('Virtual world worker has not been initialized');
    if (msg.kind === 'generateChunk') {
      const jobDef = def;
      if (canceled.has(msg.req.jobId)) {
        // Settle the backend's pending promise (it stays parked in pendingChunks until a
        // chunk/error/canceled message arrives) and drop the id so the set can't grow unbounded.
        worker.postMessage({ kind: 'canceled', jobId: msg.req.jobId });
        canceled.delete(msg.req.jobId);
        return;
      }
      const chunk = generateVirtualChunk(jobDef, msg.req.cx, msg.req.cy);
      const transferable = toTransferableChunk(chunk, msg.req.requestedPlanes);
      worker.postMessage({ kind: 'chunk', jobId: msg.req.jobId, chunk: transferable.chunk }, transferable.transfer);
      return;
    }
    if (msg.kind === 'generateWindow') {
      const jobDef = def;
      const jobDefVersion = defVersion;
      const start = now();
      let chunks = 0;
      let generatedBytes = 0;
      let transferBytes = 0;
      let materialCells = 0;
      let liquidCells = 0;
      let glowCells = 0;
      let sceneCount = 0;
      let sinceYield = 0;
      for (const [cx, cy] of sortedWindowCoords(msg.req)) {
        if (jobDefVersion !== defVersion) {
          worker.postMessage({ kind: 'canceled', jobId: msg.req.jobId });
          canceled.delete(msg.req.jobId);
          return;
        }
        if (canceled.has(msg.req.jobId)) {
          worker.postMessage({ kind: 'canceled', jobId: msg.req.jobId });
          canceled.delete(msg.req.jobId);
          return;
        }
        const chunk = generateVirtualChunk(jobDef, cx, cy);
        const transferable = toTransferableChunk(chunk, msg.req.requestedPlanes);
        chunks++;
        generatedBytes += transferable.chunk.metrics.generatedBytes;
        transferBytes += transferable.chunk.metrics.transferBytes;
        materialCells += transferable.chunk.metrics.materialCells;
        liquidCells += transferable.chunk.metrics.liquidCells;
        glowCells += transferable.chunk.metrics.glowCells;
        sceneCount += transferable.chunk.metrics.sceneCount;
        worker.postMessage({ kind: 'chunk', jobId: msg.req.jobId, chunk: transferable.chunk }, transferable.transfer);
        sinceYield++;
        if (sinceYield >= 2) {
          sinceYield = 0;
          await yieldToWorkerQueue();
        }
      }
      if (jobDefVersion !== defVersion) {
        worker.postMessage({ kind: 'canceled', jobId: msg.req.jobId });
        canceled.delete(msg.req.jobId);
        return;
      }
      canceled.delete(msg.req.jobId);
      worker.postMessage({
        kind: 'windowDone',
        jobId: msg.req.jobId,
        metrics: { chunks, generatedMs: now() - start, generatedBytes, transferBytes, materialCells, liquidCells, glowCells, sceneCount, bytes: generatedBytes },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const jobId = 'req' in msg ? msg.req.jobId : 'jobId' in msg ? msg.jobId : undefined;
    worker.postMessage({ kind: 'error', jobId, message: error.message, stack: error.stack });
  }
}

function sortedWindowCoords(req: Extract<VirtualWorkerRequest, { kind: 'generateWindow' }>['req']): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  for (let cy = req.cy0; cy <= req.cy1; cy++) {
    for (let cx = req.cx0; cx <= req.cx1; cx++) coords.push([cx, cy]);
  }
  coords.sort((a, b) => {
    const da = Math.abs(a[0] - req.centerCx) + Math.abs(a[1] - req.centerCy);
    const db = Math.abs(b[0] - req.centerCx) + Math.abs(b[1] - req.centerCy);
    return da - db || a[1] - b[1] || a[0] - b[0];
  });
  return coords;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldToWorkerQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
