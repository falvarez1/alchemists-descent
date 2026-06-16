import { describe, expect, it, vi } from 'vitest';

import {
  WebGpuStorageTextureAccessError,
  resolveThreeStorageTextureAccess,
  type WebGpuTextureViewDescriptorLike,
} from '@/render/WebGpuStorageTextureAccess';

function textureLike() {
  const view = { id: 'base-mip-view' };
  const createView = vi.fn((_descriptor?: WebGpuTextureViewDescriptorLike) => view);
  return { createView, view };
}

function descriptor(format = 'rgba8unorm') {
  return {
    size: { width: 64, height: 32, depthOrArrayLayers: 1 },
    mipLevelCount: 1,
    format,
    usage: 0x0f,
  };
}

describe('resolveThreeStorageTextureAccess', () => {
  it('boxes the pinned Three backend lookup and creates a base-mip-only view', () => {
    const storageTexture = { name: 'storage' };
    const texture = textureLike();
    const renderer = {
      backend: {
        get: vi.fn((resource: unknown) =>
          resource === storageTexture
            ? {
                texture,
                format: 'rgba8unorm',
                textureDescriptorGPU: descriptor(),
              }
            : null,
        ),
      },
    };

    const access = resolveThreeStorageTextureAccess(renderer, storageTexture, {
      expectedFormat: 'rgba8unorm',
      expectedWidth: 64,
      expectedHeight: 32,
      label: 'test-storage',
    });

    expect(access).toMatchObject({
      texture,
      baseMipView: texture.view,
      format: 'rgba8unorm',
      descriptor: { width: 64, height: 32, mipLevelCount: 1, usage: 0x0f },
      source: 'three-r184-backend-get',
    });
    expect(renderer.backend.get).toHaveBeenCalledWith(storageTexture);
    expect(texture.createView).toHaveBeenCalledWith({ baseMipLevel: 0, mipLevelCount: 1 });
  });

  it('uses Three textureDescriptorGPU format metadata', () => {
    const storageTexture = {};
    const texture = textureLike();
    const renderer = {
      backend: {
        get: () => ({
          texture,
          textureDescriptorGPU: descriptor(),
        }),
      },
    };

    const access = resolveThreeStorageTextureAccess(renderer, storageTexture, {
      expectedFormat: 'rgba8unorm',
    });

    expect(access.format).toBe('rgba8unorm');
  });

  it('fails closed when the private backend lookup is unavailable', () => {
    expect(() => resolveThreeStorageTextureAccess({}, {}, { label: 'missing' })).toThrow(
      WebGpuStorageTextureAccessError,
    );
  });

  it('fails closed when Three returns no backend texture data', () => {
    const renderer = {
      backend: {
        get: () => null,
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'no-data' })).toThrow(
      'no-data: Three backend returned no texture data',
    );
  });

  it('fails closed when the backend texture handle is missing', () => {
    const renderer = {
      backend: {
        get: () => ({
          format: 'rgba8unorm',
          textureDescriptorGPU: descriptor(),
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'no-texture' })).toThrow(
      'no-texture: Three backend texture is unavailable',
    );
  });

  it('fails closed when Three exposes no texture descriptor', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'no-format' })).toThrow(
      'no-format: Three backend texture descriptor is unavailable',
    );
  });

  it('fails closed when Three exposes no texture format metadata', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          textureDescriptorGPU: { ...descriptor(), format: undefined },
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'no-format' })).toThrow(
      'no-format: Three backend texture format is unavailable',
    );
  });

  it('fails closed when texture format metadata disagrees with the descriptor', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          format: 'rgba16float',
          textureDescriptorGPU: descriptor('rgba8unorm'),
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'mismatch' })).toThrow(
      'mismatch: texture format metadata mismatch: data=rgba16float, descriptor=rgba8unorm',
    );
  });

  it('fails closed when the texture format drifts', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          format: 'rgba16float',
          textureDescriptorGPU: descriptor('rgba16float'),
        }),
      },
    };

    expect(() =>
      resolveThreeStorageTextureAccess(renderer, {}, { expectedFormat: 'rgba8unorm', label: 'drift' }),
    ).toThrow('drift: expected rgba8unorm storage texture, got rgba16float');
  });

  it('fails closed when the descriptor lacks storage-binding usage', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          format: 'rgba8unorm',
          textureDescriptorGPU: { ...descriptor(), usage: 0x07 },
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'sample-only' })).toThrow(
      'sample-only: texture descriptor is missing STORAGE_BINDING usage',
    );
  });

  it('fails closed when the descriptor dimensions drift', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          format: 'rgba8unorm',
          textureDescriptorGPU: descriptor(),
        }),
      },
    };

    expect(() =>
      resolveThreeStorageTextureAccess(renderer, {}, { expectedWidth: 65, expectedHeight: 32, label: 'size' }),
    ).toThrow('size: expected width 65, got 64');
    expect(() =>
      resolveThreeStorageTextureAccess(renderer, {}, { expectedWidth: 64, expectedHeight: 33, label: 'size' }),
    ).toThrow('size: expected height 33, got 32');
  });

  it('fails closed when the descriptor mip count drifts', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: textureLike(),
          format: 'rgba8unorm',
          textureDescriptorGPU: { ...descriptor(), mipLevelCount: 2 },
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'mips' })).toThrow(
      'mips: expected 1 mip level(s), got 2',
    );
  });

  it('fails closed when a base mip view cannot be created', () => {
    const renderer = {
      backend: {
        get: () => ({
          texture: {
            createView: () => null,
          },
          format: 'rgba8unorm',
          textureDescriptorGPU: descriptor(),
        }),
      },
    };

    expect(() => resolveThreeStorageTextureAccess(renderer, {}, { label: 'no-view' })).toThrow(
      'no-view: failed to create base mip texture view',
    );
  });
});
