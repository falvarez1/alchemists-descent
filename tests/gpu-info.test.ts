import { describe, expect, it } from 'vitest';

import { classifyGpu, describeGpu, gpuDisplayName } from '@/render/gpuInfo';

describe('GPU classification', () => {
  it('flags on-die Intel and AMD parts as integrated', () => {
    expect(classifyGpu('ANGLE (Intel, Intel(R) Arc(TM) Pro 140T GPU (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(classifyGpu('ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon(TM) Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(classifyGpu('intel xe-lpg')).toBe('integrated');
  });

  it('leaves dedicated cards alone', () => {
    expect(classifyGpu('ANGLE (NVIDIA, NVIDIA RTX PRO 3000 Blackwell Generation Laptop GPU (0x00002DB8) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (Intel, Intel(R) Arc(TM) Pro A60 Graphics (0x000056B2) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('intel xe-hpg')).toBe('discrete');
  });

  it('separates software rasterizers and unknowns', () => {
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
    expect(classifyGpu('')).toBe('unknown');
  });

  it('pulls a readable name out of the ANGLE string', () => {
    expect(gpuDisplayName('ANGLE (Intel, Intel(R) Arc(TM) Pro 140T GPU (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)'))
      .toBe('Intel(R) Arc(TM) Pro 140T GPU');
    expect(describeGpu('Apple M3').name).toBe('Apple M3');
  });
});
