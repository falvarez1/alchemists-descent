import { describe, expect, it } from 'vitest';
import { createEmptyDocument, sanitizeImportedDoc } from '@/builder/document';
import type { EditorDocument } from '@/builder/document';
import { rleEncode } from '@/core/rle';
import { WIDTH, HEIGHT } from '@/config/constants';

// Locks the save/share-ingestion hardening from the 2026-06-17 code review:
// every Builder document load path routes through sanitizeImportedDoc.
function baseDoc(): EditorDocument {
  return createEmptyDocument('test', 'earthen');
}

describe('document sanitizer — save/share ingestion (review hardening)', () => {
  it('preserves an authored ambient light level (no longer floored to 0)', () => {
    const doc = baseDoc();
    doc.mood = { ambient: 0.3, ambience: '' };
    const out = sanitizeImportedDoc(doc);
    expect(out).not.toBeNull();
    expect(out!.mood.ambient).toBeCloseTo(0.3, 5);
  });

  it('clamps ambient to the authoring range [0.02, 0.6]', () => {
    const hi = baseDoc();
    hi.mood = { ambient: 9, ambience: '' };
    expect(sanitizeImportedDoc(hi)!.mood.ambient).toBeCloseTo(0.6, 5);
    const lo = baseDoc();
    lo.mood = { ambient: 0.001, ambience: '' };
    expect(sanitizeImportedDoc(lo)!.mood.ambient).toBeCloseTo(0.02, 5);
  });

  it('enforces one global id namespace across object and light families', () => {
    const doc = baseDoc();
    doc.objects = [
      { id: 'x', kind: 'spawn', x: 12, y: 12, rotation: 0, locked: false, hidden: false, params: {} },
    ];
    doc.lights = [
      {
        id: 'x',
        x: 24,
        y: 24,
        color: '#ffffff',
        intensity: 1,
        radius: 60,
        bloom: 0,
        flicker: 0,
        falloff: 'soft',
        occluded: true,
        locked: false,
        hidden: false,
      },
    ];
    const out = sanitizeImportedDoc(doc)!;
    expect(out.objects).toHaveLength(1);
    expect(out.lights).toHaveLength(1);
    expect(out.objects[0].id).toBe('x');
    // The light shared the object's id; the importer must re-id it so the
    // validator's single-namespace duplicate check can never fire.
    expect(out.lights[0].id).not.toBe('x');
  });

  it('accepts a full-grid terrain RLE and rejects a short one', () => {
    const ok = baseDoc();
    ok.world = { rle: rleEncode(new Uint8Array(WIDTH * HEIGHT)) };
    expect(sanitizeImportedDoc(ok)).not.toBeNull();

    const short = baseDoc();
    short.world = { rle: rleEncode(new Uint8Array(WIDTH * HEIGHT - 64)) };
    expect(sanitizeImportedDoc(short)).toBeNull();
  });
});
