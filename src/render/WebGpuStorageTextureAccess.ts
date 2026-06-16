export interface WebGpuTextureViewDescriptorLike {
  baseMipLevel?: number;
  mipLevelCount?: number;
}

export interface WebGpuTextureLike {
  createView(descriptor?: WebGpuTextureViewDescriptorLike): unknown;
}

export interface WebGpuStorageTextureAccess {
  texture: WebGpuTextureLike;
  baseMipView: unknown;
  format: string;
  descriptor: {
    width: number | null;
    height: number | null;
    mipLevelCount: number | null;
    usage: number | null;
  };
  source: 'three-r184-backend-get';
}

export interface WebGpuStorageTextureAccessOptions {
  expectedFormat?: string;
  expectedWidth?: number;
  expectedHeight?: number;
  expectedMipLevelCount?: number;
  label?: string;
}

export class WebGpuStorageTextureAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuStorageTextureAccessError';
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isTextureLike(value: unknown): value is WebGpuTextureLike {
  return typeof objectRecord(value)?.createView === 'function';
}

const GPU_TEXTURE_USAGE_STORAGE_BINDING = 0x08;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function textureSize(descriptor: Record<string, unknown>): { width: number | null; height: number | null } {
  const size = descriptor.size;
  if (Array.isArray(size)) {
    return {
      width: numberOrNull(size[0]),
      height: numberOrNull(size[1]),
    };
  }
  const sizeRecord = objectRecord(size);
  return {
    width: numberOrNull(sizeRecord?.width),
    height: numberOrNull(sizeRecord?.height),
  };
}

function descriptorDetails(textureData: Record<string, unknown>, label: string) {
  const descriptor = objectRecord(textureData.textureDescriptorGPU);
  if (!descriptor) {
    throw new WebGpuStorageTextureAccessError(`${label}: Three backend texture descriptor is unavailable`);
  }

  const descriptorFormat = descriptor.format;
  if (typeof descriptorFormat !== 'string') {
    throw new WebGpuStorageTextureAccessError(`${label}: Three backend texture format is unavailable`);
  }

  const dataFormat = textureData.format;
  if (typeof dataFormat === 'string' && dataFormat !== descriptorFormat) {
    throw new WebGpuStorageTextureAccessError(
      `${label}: texture format metadata mismatch: data=${dataFormat}, descriptor=${descriptorFormat}`,
    );
  }

  const usage = numberOrNull(descriptor.usage);
  if (usage === null || (usage & GPU_TEXTURE_USAGE_STORAGE_BINDING) === 0) {
    throw new WebGpuStorageTextureAccessError(`${label}: texture descriptor is missing STORAGE_BINDING usage`);
  }

  const { width, height } = textureSize(descriptor);
  return {
    format: descriptorFormat,
    width,
    height,
    mipLevelCount: numberOrNull(descriptor.mipLevelCount),
    usage,
  };
}

/**
 * Three r184 exposes the GPUTexture for a StorageTexture only through backend
 * internals. Keep that private lookup boxed here so production compose can
 * fail closed, and future Three upgrades have one contract to revalidate.
 */
export function resolveThreeStorageTextureAccess(
  renderer: unknown,
  storageTexture: unknown,
  options: WebGpuStorageTextureAccessOptions = {},
): WebGpuStorageTextureAccess {
  const label = options.label ?? 'StorageTexture';
  const rendererRecord = objectRecord(renderer);
  const backend = rendererRecord ? objectRecord(rendererRecord.backend) : null;
  const get = backend?.get;
  if (typeof get !== 'function') {
    throw new WebGpuStorageTextureAccessError(`${label}: Three WebGPU backend.get is unavailable`);
  }

  const textureData = objectRecord(get.call(backend, storageTexture));
  if (!textureData) {
    throw new WebGpuStorageTextureAccessError(`${label}: Three backend returned no texture data`);
  }

  const texture = textureData.texture;
  if (!isTextureLike(texture)) {
    throw new WebGpuStorageTextureAccessError(`${label}: Three backend texture is unavailable`);
  }

  const descriptor = descriptorDetails(textureData, label);
  if (options.expectedFormat && descriptor.format !== options.expectedFormat) {
    throw new WebGpuStorageTextureAccessError(
      `${label}: expected ${options.expectedFormat} storage texture, got ${descriptor.format}`,
    );
  }
  if (options.expectedWidth !== undefined && descriptor.width !== options.expectedWidth) {
    throw new WebGpuStorageTextureAccessError(
      `${label}: expected width ${options.expectedWidth}, got ${descriptor.width ?? 'unknown'}`,
    );
  }
  if (options.expectedHeight !== undefined && descriptor.height !== options.expectedHeight) {
    throw new WebGpuStorageTextureAccessError(
      `${label}: expected height ${options.expectedHeight}, got ${descriptor.height ?? 'unknown'}`,
    );
  }
  const expectedMipLevelCount = options.expectedMipLevelCount ?? 1;
  if (descriptor.mipLevelCount !== expectedMipLevelCount) {
    throw new WebGpuStorageTextureAccessError(
      `${label}: expected ${expectedMipLevelCount} mip level(s), got ${descriptor.mipLevelCount ?? 'unknown'}`,
    );
  }

  const baseMipView = texture.createView({ baseMipLevel: 0, mipLevelCount: 1 });
  if (!baseMipView) {
    throw new WebGpuStorageTextureAccessError(`${label}: failed to create base mip texture view`);
  }

  return {
    texture,
    baseMipView,
    format: descriptor.format,
    descriptor,
    source: 'three-r184-backend-get',
  };
}
