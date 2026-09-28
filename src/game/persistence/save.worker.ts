import { checksumSave, encodeExpedition, validEnvelope } from './codec';
import type { SaveEnvelope, SaveRequest, SaveResponse } from './codec';
import type { ExpeditionSave } from '@/game/Levels';

const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('alchemists-descent-expeditions', 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('checkpoints')) request.result.createObjectStore('checkpoints');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Cannot open expedition storage'));
  request.onblocked = () => reject(new Error('Close another older game tab to update expedition storage'));
});

async function read(key: string): Promise<unknown> {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('checkpoints', 'readonly');
    const request = tx.objectStore('checkpoints').get(key);
    request.onsuccess = () => resolve(request.result as unknown);
    request.onerror = () => reject(request.error);
  });
}

async function write(save: ExpeditionSave, previous: SaveEnvelope | null): Promise<SaveEnvelope> {
  const db = await dbPromise;
  const envelope: SaveEnvelope = {
    schema: 2, revision: (previous?.revision ?? 0) + 1, savedAt: Date.now(), checksum: checksumSave(save), data: save,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('checkpoints', 'readwrite');
    const store = tx.objectStore('checkpoints');
    // The previous checkpoint, new checkpoint and manifest commit atomically.
    if (previous) store.put(previous, 'previous');
    store.put(envelope, 'current');
    store.put({ schema: 2, revision: envelope.revision, savedAt: envelope.savedAt }, 'manifest');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Expedition checkpoint transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Expedition storage is full or unavailable'));
  });
  return envelope;
}

let current: SaveEnvelope | null = null;
let queue = Promise.resolve();

async function handle(request: SaveRequest): Promise<SaveResponse> {
  const base = { id: request.id, epoch: request.epoch, action: request.action };
  try {
    if (request.action === 'load') {
      const [head, previous] = await Promise.all([read('current'), read('previous')]);
      const recovered = !validEnvelope(head) && validEnvelope(previous);
      current = validEnvelope(head) ? head : validEnvelope(previous) ? previous : null;
      if (!current && request.legacy) {
        const legacy = JSON.parse(request.legacy) as ExpeditionSave;
        if (legacy?.v !== 1 || !Array.isArray(legacy.levels)) throw new Error('Legacy expedition cannot be read');
        current = await write(legacy, null);
      }
      if (!current && (head || previous)) throw new Error('Both checkpoints are damaged; the stored copies have been retained');
      return { ...base, ok: true, save: current?.data ?? null, revision: current?.revision ?? 0, recovered };
    }
    if (request.action === 'clear' || request.action === 'archive') {
      const db = await dbPromise;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readwrite');
        const store = tx.objectStore('checkpoints');
        if (request.action === 'archive' && current) store.put(current, 'archived-incompatible');
        store.delete('current'); store.delete('previous'); store.delete('manifest');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      current = null;
      return { ...base, ok: true, save: null, revision: 0 };
    }
    const save = encodeExpedition(request.payload);
    current = await write(save, current);
    return { ...base, ok: true, save, revision: current.revision };
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

self.onmessage = (event: MessageEvent<SaveRequest>): void => {
  queue = queue.then(async () => {
    const response = await handle(event.data);
    self.postMessage(response);
  });
};
