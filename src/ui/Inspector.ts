import type { Ctx, MaterialParams, SpellId, SpellParams } from '@/core/types';
import { formatStep } from '@/core/strings';
import { resetCombatTransients } from '@/game/transients';
import { ensureSandboxWorldDetached } from '@/game/sandboxWorld';

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
  if (propKey === 'blastRadius' || propKey === 'burnDuration' || propKey === 'particleLife' || propKey === 'fuseTicks' || propKey === 'collapseLimit' || propKey === 'baseRadius') { min = 5; max = 100; step = 1; }
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
  constructor(private ctx: Ctx) {
    this.wireGlobalControls();
    this.wireGpuComposeToggle();
    this.wireWebGpuComposeToggle();
    this.wireClearButton();
    this.wireSoundToggle();
  }

  generateContextInspector(id: string | number, mode: 'element' | 'spell'): void {
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

    Object.keys(profile).forEach(propKey => {
      if (propKey === 'name') return;
      document.getElementById(`dyn-input-${propKey}`)!.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value); fields[propKey] = val;
        document.getElementById(`dyn-val-${propKey}`)!.textContent =
          propKey === 'bloomWeight' ? (val * 100).toFixed(0) + '%' : formatStep(val, paramSliderSpec(propKey, val).step);
      });
    });
  }

  private wireGlobalControls(): void {
    const ctx = this.ctx;
    document.getElementById('brush-size')!.addEventListener('input', (e) => {
      ctx.state.brushSize = parseInt((e.target as HTMLInputElement).value);
      document.getElementById('brush-value')!.textContent = ctx.state.brushSize + "px";
    });
    document.getElementById('g-speed')!.addEventListener('input', (e) => {
      ctx.params.global.simSpeed = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById('g-speed-value')!.textContent = ctx.params.global.simSpeed.toFixed(1) + "x";
    });
    document.getElementById('g-bright')!.addEventListener('input', (e) => {
      ctx.params.global.maxBrightness = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById('g-bright-value')!.textContent = ctx.params.global.maxBrightness.toFixed(1);
    });
    document.getElementById('g-ambient')!.addEventListener('input', (e) => {
      ctx.params.global.ambient = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById('g-ambient-value')!.textContent = ctx.params.global.ambient.toFixed(2);
    });
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
    const syncBtn = (): void => {
      btn.classList.toggle('lit', render.compose);
      btn.setAttribute('aria-pressed', String(render.compose));
      btn.title = canToggle()
        ? `WebGPU raw WGSL compose: ${render.compose ? 'on' : 'off'}`
        : 'WebGPU raw WGSL compose requires booting with ?renderBackend=webgpu';
    };
    btn.addEventListener('click', () => {
      if (!canToggle()) {
        this.ctx.events.emit('toast', { text: 'WEBGPU COMPOSE NEEDS ?renderBackend=webgpu' });
        syncBtn();
        btn.blur();
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
    document.getElementById('sound-toggle')!.addEventListener('click', (e) => {
      const on = ctx.audio.toggle();
      if (on) ctx.audio.ensure(); // original: turning sound on (re)creates the AudioContext
      const btn = e.target as HTMLElement;
      btn.textContent = on ? 'SND ON' : 'SND OFF';
      btn.classList.toggle('muted', !on);
    });
  }
}
