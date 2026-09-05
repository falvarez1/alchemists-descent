import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpeditionStorage } from '@/game/persistence/ExpeditionStorage';
import { checksumSave, validEnvelope } from '@/game/persistence/codec';
import type { PendingExpeditionSave, SaveRequest, SaveResponse } from '@/game/persistence/codec';
import type { ExpeditionSave } from '@/game/Levels';

class StorageWorker {
  static current: StorageWorker;
  messages: SaveRequest[] = [];
  onmessage: ((e: MessageEvent<SaveResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() { StorageWorker.current = this; }
  postMessage(message: SaveRequest): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  respond(ok = true, revision = 0): void {
    const request = this.messages.at(-1)!;
    this.onmessage?.({ data: { ...request, ok, revision, save: null, error: ok ? undefined : 'QuotaExceededError' } } as MessageEvent<SaveResponse>);
  }
}
const payload = { metadata: {}, levels: [] } as unknown as PendingExpeditionSave;
const stores: ExpeditionStorage[] = [];
function create(): ExpeditionStorage {
  vi.stubGlobal('Worker', StorageWorker); vi.stubGlobal('indexedDB', {});
  const storage = new ExpeditionStorage(() => {}); stores.push(storage); return storage;
}
afterEach(() => { stores.splice(0).forEach(s => s.dispose()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('durable checkpoint failure contracts', () => {
  it('only reports ready after the worker acknowledges the durable write', async () => {
    const storage = create(); StorageWorker.current.respond(); await storage.ready;
    storage.save(payload); expect(storage.status.state).toBe('saving');
    StorageWorker.current.respond(true, 4);
    expect(await storage.flush()).toMatchObject({ state: 'ready', revision: 4 });
  });
  it('surfaces quota failure, completes waiters, and permits an explicit retry', async () => {
    const storage = create(); StorageWorker.current.respond(); await storage.ready;
    storage.save(payload); StorageWorker.current.respond(false);
    expect(await storage.flush()).toMatchObject({ state: 'error', error: 'QuotaExceededError' });
    storage.save(payload); StorageWorker.current.respond(true, 2);
    expect(await storage.flush()).toMatchObject({ state: 'ready', revision: 2 });
  });
  it('terminates a crashed worker and never leaves later flushes hanging', async () => {
    const storage = create(); StorageWorker.current.onerror?.();
    expect(StorageWorker.current.terminated).toBe(true);
    storage.save(payload);
    expect((await storage.flush()).state).toBe('error');
  });
  it('bounds an unresponsive worker and retains an explicit error state', async () => {
    vi.useFakeTimers(); const storage = create();
    await vi.advanceTimersByTimeAsync(30001);
    expect((await storage.flush()).state).toBe('error');
    expect(StorageWorker.current.terminated).toBe(true);
  });
  it('archives incompatible runs through a separate transaction action', async () => {
    const storage = create(); StorageWorker.current.respond(); await storage.ready;
    storage.archive(); expect(StorageWorker.current.messages.at(-1)?.action).toBe('archive');
    StorageWorker.current.respond(); expect((await storage.flush()).state).toBe('ready');
  });
  it('rejects damaged envelopes while allowing a checksum-verified checkpoint', () => {
    const data = { v: 1, levels: [] } as unknown as ExpeditionSave;
    const record = { schema: 2, revision: 1, savedAt: 1, data, checksum: checksumSave(data) };
    expect(validEnvelope(record)).toBe(true);
    expect(validEnvelope({ ...record, checksum: record.checksum ^ 1 })).toBe(false);
  });
});
