import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentAppMode, saveModeForReload, takeSavedMode } from '@/game/modePersist';

// The unit env is plain node; stub the two globals modePersist touches.
const g = globalThis as unknown as { sessionStorage: unknown; document: unknown };
let savedSession: unknown;
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
  describe('save / take round-trip', () => {
    it('persists play and builder', () => {
      saveModeForReload('play');
      expect(takeSavedMode()).toBe('play');
      saveModeForReload('builder');
      expect(takeSavedMode()).toBe('builder');
    });

    it('is one-shot: a second take returns null', () => {
      saveModeForReload('builder');
      expect(takeSavedMode()).toBe('builder');
      expect(takeSavedMode()).toBeNull();
    });

    it('sandbox clears the token (the default needs no restore)', () => {
      saveModeForReload('play');
      saveModeForReload('sandbox');
      expect(takeSavedMode()).toBeNull();
    });

    it('returns null when nothing was saved', () => {
      expect(takeSavedMode()).toBeNull();
    });

    it('ignores a corrupt token value', () => {
      g.sessionStorage = (() => {
        const s = fakeSession();
        s.setItem('ad-mode-before-reload', 'bogus');
        return s;
      })();
      expect(takeSavedMode()).toBeNull();
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
