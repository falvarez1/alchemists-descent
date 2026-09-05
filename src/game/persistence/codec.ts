import type { ExpeditionSave, SavedLevelBlob } from '@/game/Levels';
import { bytesToBase64, rleEncode } from '@/core/rle';
import { Cell } from '@/sim/CellType';

export interface PendingLevelSave {
  metadata: Omit<SavedLevelBlob, 'rle' | 'life' | 'charge' | 'explored'>;
  types: Uint8Array;
  life: Int16Array;
  charge: Uint16Array;
  explored: Uint8Array;
}

export interface PendingExpeditionSave {
  metadata: Omit<ExpeditionSave, 'levels'>;
  levels: Array<SavedLevelBlob | PendingLevelSave>;
}

/** Runs in the persistence worker, never across a mutating world buffer. */
export function encodeExpedition(pending: PendingExpeditionSave): ExpeditionSave {
  return {
    ...pending.metadata,
    levels: pending.levels.map((level) => {
      if (!('metadata' in level)) return level;
      const life: Array<[number, number]> = [];
      const charge: Array<[number, number]> = [];
      for (let i = 0; i < level.types.length; i++) {
        const type = level.types[i];
        if (level.life[i] !== 0 && type !== Cell.Fire && type !== Cell.Ember && type !== Cell.Smoke && type !== Cell.Steam) {
          life.push([i, level.life[i]]);
        }
        if (level.charge[i] !== 0) charge.push([i, level.charge[i]]);
      }
      return { ...level.metadata, rle: rleEncode(level.types), explored: bytesToBase64(level.explored), life, charge };
    }),
  };
}

export interface SaveEnvelope {
  schema: 2;
  revision: number;
  savedAt: number;
  checksum: number;
  data: ExpeditionSave;
}

export function checksumSave(data: ExpeditionSave): number {
  const json = JSON.stringify(data);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function validEnvelope(value: unknown): value is SaveEnvelope {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SaveEnvelope>;
  return record.schema === 2 && typeof record.revision === 'number' && !!record.data &&
    record.data.v === 1 && Array.isArray(record.data.levels) && record.checksum === checksumSave(record.data);
}

export type SaveRequest = { id: number; epoch: number } & (
  | { action: 'load'; legacy: string | null }
  | { action: 'save'; payload: PendingExpeditionSave }
  | { action: 'clear' }
  | { action: 'archive' }
);

export interface SaveResponse {
  id: number;
  epoch: number;
  action: SaveRequest['action'];
  ok: boolean;
  revision?: number;
  save?: ExpeditionSave | null;
  recovered?: boolean;
  error?: string;
}
