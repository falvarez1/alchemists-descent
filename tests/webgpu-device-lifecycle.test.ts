import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GpuAdapterLike, GpuDeviceLike } from '@/render/WebGpuDeviceLifecycle';
import { WebGpuDeviceLifecycle } from '@/render/WebGpuDeviceLifecycle';

function pendingDevice(): GpuDeviceLike & { lose: (reason?: string, message?: string) => void } {
  let resolveLost!: (info: { reason?: string; message?: string }) => void;
  const lost = new Promise<{ reason?: string; message?: string }>((resolve) => {
    resolveLost = resolve;
  });
  return {
    lost,
    destroy: () => resolveLost({ reason: 'destroyed', message: 'Device was destroyed.' }),
    lose: (reason = 'unknown', message = 'lost') => resolveLost({ reason, message }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebGpuDeviceLifecycle', () => {
  it('recovers from simulated loss with a fresh adapter', async () => {
    const firstDevice = pendingDevice();
    const replacementDevice = pendingDevice();
    const firstAdapter: GpuAdapterLike = { requestDevice: vi.fn(async () => firstDevice) };
    const replacementAdapter: GpuAdapterLike = { requestDevice: vi.fn(async () => replacementDevice) };
    const requestAdapter = vi.fn(async () => replacementAdapter);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });

    const lifecycle = new WebGpuDeviceLifecycle();
    lifecycle.trackDevice(firstDevice, firstAdapter);

    const recovery = await lifecycle.simulateLossAndRecover();

    expect(recovery.ok).toBe(true);
    expect(recovery.device).toBe(replacementDevice);
    expect(recovery.status).toMatchObject({ state: 'recovered', generation: 2, lostCount: 1 });
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(firstAdapter.requestDevice).not.toHaveBeenCalled();
    expect(replacementAdapter.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to the cached adapter when fresh adapter recovery fails', async () => {
    const firstDevice = pendingDevice();
    const cachedAdapter: GpuAdapterLike = { requestDevice: vi.fn(async () => pendingDevice()) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn(async () => null) } });

    const lifecycle = new WebGpuDeviceLifecycle();
    lifecycle.trackDevice(firstDevice, cachedAdapter);
    firstDevice.destroy?.();
    await lifecycle.waitForLoss();

    const recovery = await lifecycle.recover();

    expect(recovery).toMatchObject({
      ok: false,
      device: null,
      error: 'requestAdapter returned null',
      status: { state: 'failed', generation: 1, lostCount: 1 },
    });
    expect(cachedAdapter.requestDevice).not.toHaveBeenCalled();
  });

  it('rejects a replacement device that is already lost', async () => {
    const lostDevice: GpuDeviceLike = {
      lost: Promise.resolve({ reason: 'unknown', message: 'replacement lost before use' }),
    };
    const adapter: GpuAdapterLike = { requestDevice: vi.fn(async () => lostDevice) };
    const lifecycle = new WebGpuDeviceLifecycle();

    const recovery = await lifecycle.recover(adapter);

    expect(recovery.ok).toBe(false);
    expect(recovery.device).toBeNull();
    expect(recovery.error).toContain('replacement device lost immediately');
    expect(recovery.status).toMatchObject({
      state: 'failed',
      generation: 0,
      lostCount: 1,
      lastLossReason: 'unknown',
      lastLossMessage: 'replacement lost before use',
    });
  });
});
