import { createDefaultPostFxSettings } from '@/config/params';
import type { Ctx, MaterialParams, PostFxSettings, SpellId, SpellParams } from '@/core/types';

// ===================== Adaptive UI Form Inspectors =====================

/**
 * Slider spec for one live-param key — shared by the Sandbox inspector and
 * the Builder's MATERIAL window so their ranges can never drift.
 */
export function paramSliderSpec(propKey: string): {
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
  if (propKey === 'bloomWeight') label = 'Bloom Scale (%)';
  return { min, max, step, label };
}

type BooleanPostFxKey = 'enabled' | 'bloomEnabled' | 'lensEnabled';
type NumberPostFxKey = Exclude<keyof PostFxSettings, BooleanPostFxKey>;

/**
 * Right-hand inspector panel: per-material / per-spell parameter sliders
 * (mutating the live `ctx.params` profiles in place), the global sim
 * sliders, the clear-world button and the sound toggle.
 */
export class Inspector {
  constructor(private ctx: Ctx) {
    this.wireGlobalControls();
    this.wirePostFxControls();
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
      const { min, max, step, label: labelText } = paramSliderSpec(propKey);

      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
          <div class="control-label-wrapper">
              <label style="text-transform: capitalize;">${labelText.replace(/([A-Z])/g, ' $1')}</label>
              <span id="dyn-val-${propKey}" class="val-display">${propKey === 'bloomWeight' ? (fields[propKey] * 100).toFixed(0) + '%' : fields[propKey]}</span>
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
        document.getElementById(`dyn-val-${propKey}`)!.textContent = propKey === 'bloomWeight' ? (val * 100).toFixed(0) + '%' : String(val);
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

  private wirePostFxControls(): void {
    const post = this.ctx.state.postFx;

    const checkboxSpecs: Array<[string, BooleanPostFxKey]> = [
      ['post-enabled', 'enabled'],
      ['post-bloom-enabled', 'bloomEnabled'],
      ['post-lens-enabled', 'lensEnabled'],
    ];
    const sliderSpecs: Array<{
      id: string;
      valueId: string;
      key: NumberPostFxKey;
      format: (value: number) => string;
    }> = [
      { id: 'post-exposure', valueId: 'post-exposure-value', key: 'exposure', format: (v) => v.toFixed(2) },
      {
        id: 'post-bloom-strength',
        valueId: 'post-bloom-strength-value',
        key: 'bloomStrength',
        format: (v) => v.toFixed(2),
      },
      { id: 'post-bloom-radius', valueId: 'post-bloom-radius-value', key: 'bloomRadius', format: (v) => v.toFixed(2) },
      {
        id: 'post-bloom-threshold',
        valueId: 'post-bloom-threshold-value',
        key: 'bloomThreshold',
        format: (v) => v.toFixed(2),
      },
      { id: 'post-bloom-kick', valueId: 'post-bloom-kick-value', key: 'bloomKickScale', format: (v) => v.toFixed(2) + 'x' },
      { id: 'post-aberration', valueId: 'post-aberration-value', key: 'aberration', format: (v) => v.toFixed(4) },
      {
        id: 'post-aberration-kick',
        valueId: 'post-aberration-kick-value',
        key: 'aberrationKick',
        format: (v) => v.toFixed(4),
      },
      {
        id: 'post-shake-aberration',
        valueId: 'post-shake-aberration-value',
        key: 'shakeAberration',
        format: (v) => v.toFixed(3),
      },
      { id: 'post-grain', valueId: 'post-grain-value', key: 'grain', format: (v) => v.toFixed(3) },
      { id: 'post-hurt-pulse', valueId: 'post-hurt-pulse-value', key: 'hurtPulse', format: (v) => v.toFixed(2) + 'x' },
    ];

    const syncControls = (): void => {
      for (const [id, key] of checkboxSpecs) {
        (document.getElementById(id) as HTMLInputElement).checked = post[key];
      }
      for (const spec of sliderSpecs) {
        const input = document.getElementById(spec.id) as HTMLInputElement;
        input.value = String(post[spec.key]);
        document.getElementById(spec.valueId)!.textContent = spec.format(post[spec.key]);
      }
    };

    for (const [id, key] of checkboxSpecs) {
      document.getElementById(id)!.addEventListener('change', (e) => {
        post[key] = (e.target as HTMLInputElement).checked;
      });
    }

    for (const spec of sliderSpecs) {
      document.getElementById(spec.id)!.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        post[spec.key] = value;
        document.getElementById(spec.valueId)!.textContent = spec.format(value);
      });
    }

    document.getElementById('post-reset')!.addEventListener('click', () => {
      Object.assign(post, createDefaultPostFxSettings());
      syncControls();
    });

    syncControls();
  }

  private wireClearButton(): void {
    const ctx = this.ctx;
    document.getElementById('clear-btn')!.addEventListener('click', () => {
      ctx.world.clear();
      ctx.projectiles.length = 0; ctx.shockwaves.length = 0; ctx.simulation.accumulator = 0; ctx.input.activeChargingBlackHole = null;
      ctx.particles.clear(); ctx.lightning.clear(); ctx.enemies.length = 0;
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
