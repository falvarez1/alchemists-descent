import type { ExpeditionSave } from '@/game/Levels';
import type { PendingExpeditionSave, SaveRequest, SaveResponse } from './codec';

export interface ExpeditionStorageStatus {
  backend: 'indexeddb-worker' | 'legacy';
  state: 'loading' | 'ready' | 'saving' | 'error';
  revision: number;
  error: string | null;
  recovered: boolean;
}

/** Owns async I/O; the game owns the authoritative world and copies only at a tick boundary. */
export class ExpeditionStorage {
  readonly ready: Promise<void>;
  readonly status: ExpeditionStorageStatus;
  cached: ExpeditionSave | null = null;
  private worker: Worker | null = null;
  private sequence = 0;
  private epoch = 0;
  private pending = new Set<number>();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly flushWaiters = new Set<() => void>();
  private resolveReady: () => void = () => {};

  constructor(private readonly notify: (text: string) => void) {
    const enabled = typeof Worker !== 'undefined' && typeof indexedDB !== 'undefined';
    this.status = { backend: enabled ? 'indexeddb-worker' : 'legacy', state: enabled ? 'loading' : 'ready', revision: 0, error: null, recovered: false };
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    if (!enabled) { this.resolveReady(); return; }
    try {
      this.worker = new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module', name: 'expedition-persistence' });
      this.worker.onmessage = (event: MessageEvent<SaveResponse>) => this.receive(event.data);
      this.worker.onerror = () => this.fail('The expedition storage worker stopped. Reload to retry; your previous checkpoint is retained.', true);
      let legacy: string | null = null;
      try { legacy = localStorage.getItem('noita-expedition'); } catch { /* IndexedDB can still work. */ }
      this.send({ action: 'load', legacy, id: ++this.sequence, epoch: this.epoch });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Expedition storage could not start', true);
    }
  }

  save(payload: PendingExpeditionSave): void {
    if (!this.worker) { if (this.status.backend !== 'legacy') this.notify('Save unavailable. Reload to reconnect to your previous checkpoint.'); return; }
    this.status.state = 'saving';
    const transfers: Transferable[] = [];
    for (const level of payload.levels) {
      if (!('metadata' in level)) continue;
      transfers.push(level.types.buffer, level.life.buffer, level.charge.buffer, level.explored.buffer);
    }
    this.send({ action: 'save', payload, id: ++this.sequence, epoch: this.epoch }, transfers);
  }

  clear(): void {
    this.epoch++;
    this.cached = null;
    this.status.revision = 0;
    this.resolveReady();
    if (this.worker) this.send({ action: 'clear', id: ++this.sequence, epoch: this.epoch });
  }

  archive(): void {
    this.epoch++;
    this.cached = null;
    if (this.worker) this.send({ action: 'archive', id: ++this.sequence, epoch: this.epoch });
  }

  async flush(): Promise<ExpeditionStorageStatus> {
    await this.ready;
    if (this.pending.size > 0) await new Promise<void>((resolve) => this.flushWaiters.add(resolve));
    return { ...this.status };
  }

  private send(message: SaveRequest, transfers: Transferable[] = []): void {
    this.pending.add(message.id);
    this.armTimeout();
    try { this.worker?.postMessage(message, transfers); }
    catch (error) { this.fail(error instanceof Error ? error.message : 'Checkpoint could not be queued', true); }
  }

  private receive(response: SaveResponse): void {
    this.pending.delete(response.id);
    this.armTimeout();
    if (response.epoch !== this.epoch) { this.finishWaiters(); return; }
    if (!response.ok) { this.fail(response.error ?? 'Checkpoint could not be saved'); return; }
    this.cached = response.save ?? null;
    this.status.revision = response.revision ?? this.status.revision;
    this.status.state = this.pending.size > 0 ? 'saving' : 'ready';
    this.status.error = null;
    if (response.action === 'load') {
      this.status.recovered = response.recovered === true;
      this.resolveReady();
      if (response.recovered) this.notify('Recovered your previous expedition checkpoint.');
    }
    // A legacy save is removed only after a successful durable import/write.
    if (this.cached) {
      try { localStorage.removeItem('noita-expedition'); } catch { /* Keep a harmless backup. */ }
    }
    this.finishWaiters();
  }

  private finishWaiters(): void {
    if (this.pending.size > 0) return;
    for (const resolve of this.flushWaiters) resolve();
    this.flushWaiters.clear();
  }

  private armTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = this.pending.size > 0 ? setTimeout(() => this.fail('Checkpoint storage did not respond. Reload to retry; the last durable checkpoint is retained.', true), 30000) : null;
  }

  private fail(message: string, fatal = false): void {
    this.status.state = 'error';
    this.status.error = message;
    if (fatal) { this.worker?.terminate(); this.worker = null; this.pending.clear(); }
    this.armTimeout();
    this.finishWaiters();
    this.resolveReady();
    this.notify(`Save unavailable: ${message}`);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.armTimeout();
    this.finishWaiters();
    this.resolveReady();
  }
}
