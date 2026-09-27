/**
 * Which GPU the browser actually handed us. Both backends already ask for
 * `powerPreference: 'high-performance'`, but on Windows the browser's GPU
 * process runs on whatever adapter Windows assigns it (Settings › System ›
 * Display › Graphics), so a dual-GPU laptop can still land on the integrated
 * chip. We can't switch adapters from a page; we can notice and say how.
 */
export type GpuClass = 'integrated' | 'discrete' | 'software' | 'unknown';

export interface GpuInfo {
  /** The unmasked renderer string, e.g. "ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x7D55) Direct3D11 ...)". */
  renderer: string;
  /** A short human name pulled out of the renderer string. */
  name: string;
  kind: GpuClass;
}

const SOFTWARE = /SwiftShader|llvmpipe|Basic Render Driver|Software Rasterizer|softpipe/i;
// Intel discrete cards carry a letter-series model (Arc A770, Arc Pro A60,
// Arc B580) or, through WebGPU's adapterInfo, an "-hpg" architecture;
// everything else Intel ships (UHD, Iris, "Arc(TM) Graphics", Arc 140V,
// Arc Pro 140T, xe-lpg) is on-die.
const INTEL_DISCRETE = /Arc(?:\(TM\))?\s+(?:Pro\s+)?[AB]\d{2,3}|xe2?-hpg/i;
// AMD APUs: "Radeon(TM) Graphics", "Radeon 780M", "Vega 8 Graphics".
const AMD_INTEGRATED = /Radeon(?:\(TM\))?\s+Graphics|Radeon(?:\(TM\))?\s+\d{3}M\b|Vega\s+\d+\s+Graphics/i;
const DISCRETE = /NVIDIA|GeForce|Quadro|RTX|Radeon|Arc/i;

export function classifyGpu(renderer: string): GpuClass {
  if (!renderer) return 'unknown';
  if (SOFTWARE.test(renderer)) return 'software';
  if (/Intel/i.test(renderer)) return INTEL_DISCRETE.test(renderer) ? 'discrete' : 'integrated';
  if (AMD_INTEGRATED.test(renderer)) return 'integrated';
  if (DISCRETE.test(renderer)) return 'discrete';
  return 'unknown';
}

/** "ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "Intel(R) Arc(TM) Graphics". */
export function gpuDisplayName(renderer: string): string {
  const angle = /^ANGLE \(([^,]+),\s*(.+?)(?:\s+\(0x[0-9a-f]+\))?(?:\s+Direct3D.*|\s+OpenGL.*|\s+Vulkan.*|,.*)?\)$/i.exec(renderer);
  return (angle?.[2] ?? renderer).trim();
}

export function describeGpu(renderer: string): GpuInfo {
  return { renderer, name: gpuDisplayName(renderer), kind: classifyGpu(renderer) };
}

export function readWebGlGpu(gl: WebGLRenderingContext | WebGL2RenderingContext | null): GpuInfo {
  if (!gl) return describeGpu('');
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    renderer = '';
  }
  return describeGpu(renderer);
}
