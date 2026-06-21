import type { Ctx, MaterialParams, SpellId, SpellParams } from '@/core/types';
import { formatStep } from '@/core/strings';
import { GLOBAL_PARAM_DEFAULTS } from '@/config/params';
import { bindRange, type Binding } from '@/ui/domBind';

/** Initial GameStateData.brushSize (Game.ts) — the reset target for the brush slider. */
const BRUSH_DEFAULT = 6;
import { ensureSandboxWorldDetached, resetCombatTransients } from '@/core/runtimeState';

// ===================== Adaptive UI Form Inspectors =====================

/**
 * Slider spec for one live-param key — shared by the Sandbox inspector and
 * the Builder's MATERIAL window so their ranges can never drift.
 */
export function paramSliderSpec(propKey: string, value?: number): {
  min: number;
  max: number;
  step: number;
  label: string;
} {
  let min = 0,
    max = 1,
    step = 0.05,
    label = propKey;
  // burn/particle lifetimes run to several seconds (oil=175, fire particleLife=300),
  // so cap these high enough to actually reach those values — a 100-frame max
  // silently clamped them BELOW their own defaults.
  if (propKey === 'burnDuration' || propKey === 'particleLife') { min = 5; max = 360; step = 5; }
  else if (propKey === 'blastRadius' || propKey === 'fuseTicks' || propKey === 'collapseLimit' || propKey === 'baseRadius') { min = 5; max = 100; step = 1; }
  if (propKey === 'velocityForce' || propKey === 'explosionRadius') { min = 1; max = 20; step = 0.5; }
  if (propKey === 'range') { min = 20; max = 250; step = 5; }
  if (propKey === 'branches') { min = 0; max = 6; step = 1; }
  if (propKey === 'pellets') { min = 1; max = 9; step = 1; }
  if (propKey === 'freezeRadius' || propKey === 'radius') { min = 1; max = 24; step = 1; }
  if (propKey === 'count') { min = 1; max = 32; step = 1; }
  if (propKey === 'damage') { min = 1; max = 100; step = 1; }
  if (propKey === 'manaCost') { min = 0; max = 100; step = 1; }
  if (propKey === 'cooldown') { min = 0; max = 180; step = 1; }
  if (propKey === 'heat') { min = 1; max = 60; step = 1; }
  if (propKey === 'chargeRate') { min = 0.05; max = 2; step = 0.05; }
  if (propKey === 'coagulation') { min = 0; max = 0.02; step = 0.001; }
  // Sub-step material rates: the default 0..1/0.05 grid leaves these stuck at the
  // far left and snapping to 0 on the first nudge — give them resolvable ranges.
  if (propKey === 'evaporationSpeed') { min = 0; max = 0.1; step = 0.001; }
  // Player-feel dials
  if (propKey === 'groundStopSnap' || propKey === 'jumpCut') { min = 0; max = 0.6; step = 0.01; }
  if (propKey === 'groundStopDecay' || propKey === 'airStopDecay' || propKey === 'moveSoftStart' || propKey === 'levitDrag' || propKey === 'levitHorizControl') { min = 0; max = 1; step = 0.02; }
  if (propKey === 'airGlideSpeed') { min = 0; max = 4; step = 0.1; }
  if (propKey === 'maxRunCap') { min = 1; max = 8; step = 0.1; }
  if (propKey === 'jumpHoldWindow' || propKey === 'levitRampFrames') { min = 0; max = 30; step = 1; }
  if (propKey === 'recoilBase' || propKey === 'kickImpulse' || propKey === 'kickRange' || propKey === 'kickCooldown' || propKey === 'kickDamage') { min = 0; max = 100; step = 1; }
  if (propKey === 'igniteChance') { min = 0; max = 0.2; step = 0.005; }
  if (propKey === 'dispersion') { min = 0; max = 0.5; step = 0.005; }
  if (propKey === 'bloomWeight') label = 'Bloom Scale (%)';
  // Safety net for any other value smaller than one step (an invisible thumb at
  // the far left): derive a usable grid from the value's order of magnitude.
  if (value !== undefined && Number.isFinite(value) && value > 0 && value < step) {
    const mag = Math.pow(10, Math.floor(Math.log10(value)));
    step = mag;
    max = mag * 20;
    min = 0;
  }
  return { min, max, step, label };
}

/**
 * Right-hand inspector panel: per-material / per-spell parameter sliders
 * (mutating the live `ctx.params` profiles in place), the global sim
 * sliders, the clear-world button and the sound toggle.
 */
export class Inspector {
  /** Tears down the previous context-inspector paramsChanged subscription before each rebuild. */
  private contextInspectorOff: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    this.wireGlobalControls();
    this.wireGpuComposeToggle();
    this.wireWebGpuComposeToggle();
    this.wireClearButton();
    this.wireSoundToggle();
  }

  generateContextInspector(id: string | number, mode: 'element' | 'spell'): void {
    // Drop the subscription from the previously inspected material/spell before
    // rebuilding, so we never leak listeners that point at destroyed DOM.
    this.contextInspectorOff?.();
    this.contextInspectorOff = null;
    const container = document.getElementById('material-dynamic-controls')!;
    container.innerHTML = '';

    const isSpell = (mode === 'spell');
    const profile: SpellParams | MaterialParams | undefined = isSpell
      ? this.ctx.params.spells[id as SpellId]
      : this.ctx.params.materials[id as number];
    if (!profile) return;

    document.getElementById('context-inspector-header')!.textContent = isSpell ? "Spell Parameters" : "Material Parameters";

    const title = document.createElement('div');
    title.className = 'material-title-tag';
    title.style.borderLeftColor = isSpell ? 'var(--accent-purple)' : 'var(--accent-blue)';
    title.textContent = profile.name + " Config";
    container.appendChild(title);

    const group = document.createElement('div');
    group.className = 'control-panel-group';

    // Numeric view of the live profile: every key except 'name' holds a number,
    // and slider edits write straight back into the shared params object.
    const fields = profile as unknown as Record<string, number>;

    Object.keys(profile).forEach(propKey => {
      if (propKey === 'name') return;
      const { min, max, step, label: labelText } = paramSliderSpec(propKey, fields[propKey]);

      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
          <div class="control-label-wrapper">
              <label style="text-transform: capitalize;">${labelText.replace(/([A-Z])/g, ' $1')}</label>
              <span id="dyn-val-${propKey}" class="val-display">${propKey === 'bloomWeight' ? (fields[propKey] * 100).toFixed(0) + '%' : formatStep(fields[propKey], step)}</span>
          </div>
          <input type="range" id="dyn-input-${propKey}" min="${min}" max="${max}" step="${step}" value="${fields[propKey]}">
      `;
      group.appendChild(wrapper);
    });
    container.appendChild(group);

    const formatVal = (propKey: string, val: number): string =>
      propKey === 'bloomWeight' ? (val * 100).toFixed(0) + '%' : formatStep(val, paramSliderSpec(propKey, val).step);

    Object.keys(profile).forEach(propKey => {
      if (propKey === 'name') return;
      document.getElementById(`dyn-input-${propKey}`)!.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value); fields[propKey] = val;
        document.getElementById(`dyn-val-${propKey}`)!.textContent = formatVal(propKey, val);
        // Re-sync other mirrors of this material/spell AND let the tuning store
        // persist the edit (these per-material sliders are the one tuning surface
        // that didn't emit this before).
        this.ctx.events.emit('paramsChanged');
      });
    });

    // Re-read the live profile whenever anything else changes it (console `param`,
    // Builder mirror, a reset) so these sliders mirror the global ones and never
    // show a stale number while their material/spell stays selected.
    this.contextInspectorOff = this.ctx.events.on('paramsChanged', () => {
      Object.keys(profile).forEach(propKey => {
        if (propKey === 'name') return;
        const input = document.getElementById(`dyn-input-${propKey}`) as HTMLInputElement | null;
        const valEl = document.getElementById(`dyn-val-${propKey}`);
        if (!input || !valEl) return;
        // Skip a slider mid-drag so we don't snap it out from under the user (matches bindRange.resync).
        if (document.activeElement !== input) input.value = String(fields[propKey]);
        valEl.textContent = formatVal(propKey, fields[propKey]);
      });
    });
  }

  private wireGlobalControls(): void {
    const ctx = this.ctx;
    const g = ctx.params.global;
    // A slider edit emits paramsChanged so other mirrors (and these very sliders,
    // if changed from elsewhere) stay in sync — the bindings seed from the live
    // value and resync on that event, so the panel can never show a stale number.
    const changed = (): void => { ctx.events.emit('paramsChanged'); };
    const def = GLOBAL_PARAM_DEFAULTS;
    const bindings: Binding[] = [
      bindRange({ slider: 'brush-size', readout: 'brush-value', get: () => ctx.state.brushSize,
        set: (v) => { ctx.state.brushSize = Math.round(v); }, fmt: (v) => Math.round(v) + 'px', onInput: changed, defaultValue: BRUSH_DEFAULT }),
      bindRange({ slider: 'g-speed', readout: 'g-speed-value', get: () => g.simSpeed,
        set: (v) => { g.simSpeed = v; }, fmt: (v) => v.toFixed(1) + 'x', onInput: changed, defaultValue: def.simSpeed }),
      bindRange({ slider: 'g-bright', readout: 'g-bright-value', get: () => g.maxBrightness,
        set: (v) => { g.maxBrightness = v; }, fmt: (v) => v.toFixed(1), onInput: changed, defaultValue: def.maxBrightness }),
      bindRange({ slider: 'g-ambient', readout: 'g-ambient-value', get: () => g.ambient,
        set: (v) => { g.ambient = v; }, fmt: (v) => v.toFixed(2), onInput: changed, defaultValue: def.ambient }),
    ];
    // Re-read the live params whenever ANYTHING changes them (console `param`,
    // Builder sliders, a reset) so this panel mirrors them without a reload.
    ctx.events.on('paramsChanged', () => bindings.forEach((b) => b.resync()));
  }

  private wireGpuComposeToggle(): void {
    const post = this.ctx.state.postFx;
    const gpuBtn = document.getElementById('gpu-compose-toggle') as HTMLButtonElement | null;
    if (!gpuBtn) return;
    const syncGpuBtn = (): void => {
      gpuBtn.classList.toggle('lit', post.gpuCompose);
    };
    gpuBtn.addEventListener('click', () => {
      post.gpuCompose = !post.gpuCompose;
      syncGpuBtn();
      gpuBtn.blur(); // a focused button would eat Space/Enter mid-play
    });
    syncGpuBtn();
  }

  private wireWebGpuComposeToggle(): void {
    const render = this.ctx.state.render;
    const btn = document.getElementById('webgpu-compose-toggle') as HTMLButtonElement | null;
    if (!btn) return;
    const canToggle = (): boolean => render.backend === 'webgpu' || render.backend === 'auto';
    const bootIntoWebGpuCompose = (): void => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      url.searchParams.set('renderBackend', 'webgpu');
      url.searchParams.set('enableWebGpuLiveCompose', '1');
      btn.classList.add('lit');
      btn.setAttribute('aria-pressed', 'true');
      btn.disabled = true;
      btn.title = 'Reloading with WebGPU raw WGSL compose enabled';
      this.ctx.events.emit('toast', { text: 'RELOADING WITH WEBGPU COMPOSE' });
      window.location.assign(url.toString());
    };
    const syncBtn = (): void => {
      btn.classList.toggle('lit', render.compose);
      btn.setAttribute('aria-pressed', String(render.compose));
      btn.title = canToggle()
        ? `WebGPU raw WGSL compose: ${render.compose ? 'on' : 'off'}`
        : 'Click to reload with WebGPU raw WGSL compose enabled';
    };
    btn.addEventListener('click', () => {
      if (!canToggle()) {
        bootIntoWebGpuCompose();
        return;
      }
      render.compose = !render.compose;
      syncBtn();
      btn.blur();
    });
    syncBtn();
  }

  private wireClearButton(): void {
    const ctx = this.ctx;
    document.getElementById('clear-btn')!.addEventListener('click', () => {
      ensureSandboxWorldDetached(ctx);
      ctx.world.clear();
      resetCombatTransients(ctx, { simulationAccumulator: true });
      ctx.enemies.length = 0;
      ctx.fx.screenShake = 0;
      ctx.waves.num = 0; ctx.waves.active = false; ctx.waves.intermission = 150; ctx.waves.kills = 0;
      ctx.state.score = 0; ctx.events.emit('scoreChanged', { score: ctx.state.score });
      if (ctx.state.mode === 'play' && !ctx.player.dead) {
        const sp = ctx.playerCtl.findSpawnPoint();
        ctx.player.x = sp.x; ctx.player.y = sp.y; ctx.player.vx = 0; ctx.player.vy = 0;
      }
    });
  }

  private wireSoundToggle(): void {
    const ctx = this.ctx;
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    const paint = (on: boolean): void => {
      btn.textContent = on ? 'SND ON' : 'SND OFF';
      btn.classList.toggle('muted', !on);
    };
    btn.addEventListener('click', () => {
      const on = ctx.audio.toggle();
      if (on) ctx.audio.ensure(); // original: turning sound on (re)creates the AudioContext
      paint(on);
    });
    paint(ctx.audio.enabled); // seed from the real state, not the hard-coded "SND ON"
  }
}
