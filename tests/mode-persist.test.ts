import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentAppMode, readAppMode, saveAppMode } from '@/game/modePersist';

// The unit env is plain node; stub the two globals modePersist touches.
const g = globalThis as unknown as { sessionStorage: Storage; document: unknown };
let savedSession: Storage;
let savedDoc: unknown;

function fakeSession(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

function installBody(classes: string[]): void {
  g.document = { body: { classList: { contains: (c: string) => classes.includes(c) } } };
}

beforeEach(() => {
  savedSession = g.sessionStorage;
  savedDoc = g.document;
  g.sessionStorage = fakeSession();
});
afterEach(() => {
  g.sessionStorage = savedSession;
  g.document = savedDoc;
});

describe('modePersist', () => {
  describe('saveAppMode / readAppMode', () => {
    it('persists play and builder', () => {
      saveAppMode('play');
      expect(readAppMode()).toBe('play');
      saveAppMode('builder');
      expect(readAppMode()).toBe('builder');
    });

    it('is durable, not one-shot: repeated reads keep returning it', () => {
      saveAppMode('builder');
      expect(readAppMode()).toBe('builder');
      expect(readAppMode()).toBe('builder');
    });

    it('sandbox clears the token (the default needs no restore)', () => {
      saveAppMode('play');
      saveAppMode('sandbox');
      expect(readAppMode()).toBeNull();
    });

    it('returns null when nothing was saved', () => {
      expect(readAppMode()).toBeNull();
    });

    it('ignores a corrupt token value', () => {
      g.sessionStorage.setItem('ad-mode', 'bogus');
      expect(readAppMode()).toBeNull();
    });
  });

  describe('currentAppMode', () => {
    it('builder-open wins over the underlying play/build state', () => {
      installBody(['builder-open']);
      expect(currentAppMode('build')).toBe('builder');
      expect(currentAppMode('play')).toBe('builder');
    });

    it('maps play and build when the builder is closed', () => {
      installBody(['some-other-class']);
      expect(currentAppMode('play')).toBe('play');
      expect(currentAppMode('build')).toBe('sandbox');
    });
  });
});
