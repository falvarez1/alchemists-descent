import type { Ctx } from '@/core/types';
import {
  GLOBAL_PARAMS,
  GLOBAL_PARAM_DEFAULTS,
  MATERIAL_PARAMS,
  MATERIAL_PARAM_DEFAULTS,
  SPELL_PARAMS,
  SPELL_PARAM_DEFAULTS,
  PLAYER_PARAMS,
  PLAYER_TUNING_DEFAULTS,
} from '@/config/params';
import { GEN_TUNE, GEN_TUNE_DEFAULTS } from '@/config/gen';
import { PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS } from '@/config/pacing';

/**
 * Live-tuning persistence.
 *
 * Every tuning dial (Sandbox Global Controls, the Builder's player-physics and
 * worldgen-look sliders, material/spell params, GEN_TUNE) writes straight into a
 * MUTABLE module singleton (`config/params.ts`, `config/gen.ts`). Those modules
 * re-evaluate to their shipped defaults on every page load — so an HMR reload or
 * a manual refresh used to wipe whatever you'd just dialed in.
 *
 * This module snapshots those singletons to localStorage (debounced, on the
 * shared `paramsChanged` event) and rehydrates them at boot. It stores a SPARSE
 * diff vs the shipped defaults, so the blob stays tiny AND any dial you never
 * touched still tracks future changes to its shipped default.
 */

const KEY = 'ad:tuning:v1';
const SAVE_DEBOUNCE_MS = 500;
/** Mirrors Inspector's BRUSH_DEFAULT (Game seeds GameStateData.brushSize to 6). */
const BRUSH_DEFAULT = 6;

type Scalar = number | boolean;
type Flat = Record<string, Scalar>;
type Bag = Record<string, unknown>;

interface TuningSnapshot {
  global?: Flat;
  player?: Flat;
  pacing?: Flat;
  gen?: Flat;
  materials?: Record<string, Flat>;
  spells?: Record<string, Flat>;
  brushSize?: number;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private-mode / sandboxed iframe access throws on touch — tuning must never break.
    return null;
  }
}

// The live/default tuning objects are concretely typed (no string index
// signature), so funnel them through this one cast rather than at every call.
const bag = (o: object): Bag => o as Bag;

/** Sparse diff: only keys whose live value differs from the shipped default, and
 *  only finite numbers / booleans. Skips the 'name' label. */
function diffFlat(liveObj: object, defaultsObj: object): Flat | null {
  const live = bag(liveObj);
  const defaults = bag(defaultsObj);
  const out: Flat = {};
  let any = false;
  for (const k of Object.keys(defaults)) {
    if (k === 'name') continue;
    const dv = defaults[k];
    const lv = live[k];
    if (typeof dv === 'number' && typeof lv === 'number' && Number.isFinite(lv) && lv !== dv) {
      out[k] = lv;
      any = true;
    } else if (typeof dv === 'boolean' && typeof lv === 'boolean' && lv !== dv) {
      out[k] = lv;
      any = true;
    }
  }
  return any ? out : null;
}

/** Apply a stored diff back onto a live object — only keys that STILL exist in
 *  the defaults (drops renamed/removed dials) and only when the stored type matches. */
function applyFlat(liveObj: object, defaultsObj: object, diff: Flat | undefined): void {
  if (!diff) return;
  const live = bag(liveObj);
  const defaults = bag(defaultsObj);
  for (const k of Object.keys(diff)) {
    if (k === 'name' || !(k in defaults)) continue;
    const dv = defaults[k];
    const v = diff[k];
    if (typeof dv === 'number' && typeof v === 'number' && Number.isFinite(v)) live[k] = v;
    else if (typeof dv === 'boolean' && typeof v === 'boolean') live[k] = v;
  }
}

export function captureTuning(ctx?: Ctx): TuningSnapshot {
  const snap: TuningSnapshot = {};
  const g = diffFlat(GLOBAL_PARAMS, GLOBAL_PARAM_DEFAULTS);
  if (g) snap.global = g;
  const p = diffFlat(PLAYER_PARAMS, PLAYER_TUNING_DEFAULTS);
  if (p) snap.player = p;
  const pacing = diffFlat(PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS);
  if (pacing) snap.pacing = pacing;
  const gen = diffFlat(GEN_TUNE, GEN_TUNE_DEFAULTS);
  if (gen) snap.gen = gen;

  const materials: Record<string, Flat> = {};
  for (const id of Object.keys(MATERIAL_PARAMS)) {
    const def = MATERIAL_PARAM_DEFAULTS[Number(id)];
    const live = MATERIAL_PARAMS[Number(id)];
    if (!def || !live) continue;
    const d = diffFlat(live, def);
    if (d) materials[id] = d;
  }
  if (Object.keys(materials).length) snap.materials = materials;

  const spells: Record<string, Flat> = {};
  for (const id of Object.keys(SPELL_PARAMS) as Array<keyof typeof SPELL_PARAMS>) {
    const def = SPELL_PARAM_DEFAULTS[id];
    const live = SPELL_PARAMS[id];
    if (!def || !live) continue;
    const d = diffFlat(live, def);
    if (d) spells[id] = d;
  }
  if (Object.keys(spells).length) snap.spells = spells;

  if (ctx && Number.isFinite(ctx.state.brushSize) && ctx.state.brushSize !== BRUSH_DEFAULT) {
    snap.brushSize = ctx.state.brushSize;
  }
  return snap;
}

function restoreSnapshot(snap: TuningSnapshot, ctx?: Ctx): void {
  applyFlat(GLOBAL_PARAMS, GLOBAL_PARAM_DEFAULTS, snap.global);
  applyFlat(PLAYER_PARAMS, PLAYER_TUNING_DEFAULTS, snap.player);
  applyFlat(PROGRESSION_PACING, PROGRESSION_PACING_DEFAULTS, snap.pacing);
  applyFlat(GEN_TUNE, GEN_TUNE_DEFAULTS, snap.gen);
  if (snap.materials) {
    for (const id of Object.keys(snap.materials)) {
      const def = MATERIAL_PARAM_DEFAULTS[Number(id)];
      const live = MATERIAL_PARAMS[Number(id)];
      if (def && live) applyFlat(live, def, snap.materials[id]);
    }
  }
  if (snap.spells) {
    for (const id of Object.keys(snap.spells) as Array<keyof typeof SPELL_PARAMS>) {
      const def = SPELL_PARAM_DEFAULTS[id];
      const live = SPELL_PARAMS[id];
      if (def && live) applyFlat(live, def, snap.spells[id]);
    }
  }
  if (ctx && typeof snap.brushSize === 'number' && Number.isFinite(snap.brushSize)) {
    ctx.state.brushSize = Math.round(snap.brushSize);
  }
}

/** Rehydrate the live tuning singletons from storage. Call ONCE at boot, after
 *  the param modules have evaluated (so the *_DEFAULTS snapshots are the shipped
 *  values and the sparse diff is always measured against them). */
export function loadTuning(ctx?: Ctx): void {
  const store = safeStorage();
  if (!store) return;
  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const snap = JSON.parse(raw) as TuningSnapshot;
    if (snap && typeof snap === 'object') restoreSnapshot(snap, ctx);
  } catch {
    // malformed / hand-edited — ignore; the next save overwrites it.
  }
}

function writeNow(ctx?: Ctx): void {
  const store = safeStorage();
  if (!store) return;
  try {
    const snap = captureTuning(ctx);
    if (Object.keys(snap).length === 0) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify(snap));
  } catch {
    // quota / serialization — drop this write, never break tuning.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — coalesces a slider drag into a single write. */
export function saveTuning(ctx?: Ctx): void {
  if (!safeStorage()) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow(ctx);
  }, SAVE_DEBOUNCE_MS);
}

/** Force any pending debounced save out immediately (page is going away). */
export function flushTuning(ctx?: Ctx): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeNow(ctx);
}

/** Forget all persisted tuning (the live singletons keep their current values
 *  until the next reload, which then boots from shipped defaults). */
export function clearTuning(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Boot wiring: rehydrate, then persist (debounced) on every paramsChanged and
 *  flush before the page unloads so an HMR reload or refresh can't drop the last
 *  edit sitting in the debounce window. */
export function installTuningPersistence(ctx: Ctx): () => void {
  loadTuning(ctx);
  const offParamsChanged = ctx.events.on('paramsChanged', () => saveTuning(ctx));
  let removeWindowListeners = (): void => undefined;
  if (typeof window !== 'undefined') {
    const onPageHide = (): void => flushTuning(ctx);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushTuning(ctx);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    removeWindowListeners = () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }
  return () => {
    offParamsChanged();
    removeWindowListeners();
    flushTuning(ctx);
  };
}
