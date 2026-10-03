/** Presentation controls, independent of generation, saves and combat. Probes
 * can isolate each detail layer; ?fidelity=0 disables cosmetic overlays and lamp
 * gain. Foreground foliage remains visible because it supplies gameplay cover. */
export const VISUAL_FIDELITY = {
  enabled: typeof window === 'undefined' || new URLSearchParams(window.location.search).get('fidelity') !== '0',
  waterCaustics: .65,
  waterFoam: .85,
  surfaceGrowth: 1,
  materialRims: 1,
  fixtureGlow: 1,
  lampIntensity: 1.9,
};
