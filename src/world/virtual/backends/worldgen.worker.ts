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
const canceled = new Set<number>();

worker.addEventListener('message', (event) => {
  const msg = event.data;
  try {
    if (msg.kind === 'init' || msg.kind === 'updateDef') {
      def = msg.def;
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
      if (canceled.has(msg.req.jobId)) return;
      const chunk = generateVirtualChunk(def, msg.req.cx, msg.req.cy);
      const transferable = toTransferableChunk(chunk, msg.req.requestedPlanes);
      worker.postMessage({ kind: 'chunk', jobId: msg.req.jobId, chunk: transferable.chunk }, transferable.transfer);
      return;
    }
    if (msg.kind === 'generateWindow') {
      const start = now();
      let chunks = 0;
      let bytes = 0;
      for (const [cx, cy] of sortedWindowCoords(msg.req)) {
        if (canceled.has(msg.req.jobId)) {
          worker.postMessage({ kind: 'canceled', jobId: msg.req.jobId });
          return;
        }
        const chunk = generateVirtualChunk(def, cx, cy);
        const transferable = toTransferableChunk(chunk, msg.req.requestedPlanes);
        chunks++;
        bytes += transferable.chunk.metrics.bytes;
        worker.postMessage({ kind: 'chunk', jobId: msg.req.jobId, chunk: transferable.chunk }, transferable.transfer);
      }
      worker.postMessage({
        kind: 'windowDone',
        jobId: msg.req.jobId,
        metrics: { chunks, generatedMs: now() - start, bytes },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const jobId = 'req' in msg ? msg.req.jobId : 'jobId' in msg ? msg.jobId : undefined;
    worker.postMessage({ kind: 'error', jobId, message: error.message, stack: error.stack });
  }
});

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
