export type WebGpuDeviceLifecycleState =
  | 'idle'
  | 'active'
  | 'lost'
  | 'recovering'
  | 'recovered'
  | 'failed';

interface GpuDeviceLostInfoLike {
  reason?: string;
  message?: string;
}

export interface GpuDeviceLike {
  readonly lost: Promise<GpuDeviceLostInfoLike>;
  destroy?(): void;
}

export interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<GpuAdapterLike | null>;
  };
}

export interface WebGpuDeviceLifecycleStatus {
  state: WebGpuDeviceLifecycleState;
  generation: number;
  lostCount: number;
  lastLossReason: string | null;
  lastLossMessage: string | null;
  canSimulateLoss: boolean;
}

export interface WebGpuRecoveryResult {
  ok: boolean;
  status: WebGpuDeviceLifecycleStatus;
  device: GpuDeviceLike | null;
  error?: string;
}

export class WebGpuDeviceLifecycle {
  private adapter: GpuAdapterLike | null = null;
  private device: GpuDeviceLike | null = null;
  private state: WebGpuDeviceLifecycleState = 'idle';
  private generation = 0;
  private lostCount = 0;
  private lastLossReason: string | null = null;
  private lastLossMessage: string | null = null;
  private currentLostPromise: Promise<void> | null = null;

  trackDevice(device: GpuDeviceLike, adapter: GpuAdapterLike | null = this.adapter): void {
    this.adapter = adapter;
    this.device = device;
    this.state = this.lostCount > 0 ? 'recovered' : 'active';
    this.generation++;
    const generation = this.generation;
    this.currentLostPromise = device.lost.then((info) => {
      if (this.generation !== generation) return;
      this.state = 'lost';
      this.lostCount++;
      this.lastLossReason = info.reason ?? null;
      this.lastLossMessage = info.message ?? null;
    });
  }

  status(): WebGpuDeviceLifecycleStatus {
    return {
      state: this.state,
      generation: this.generation,
      lostCount: this.lostCount,
      lastLossReason: this.lastLossReason,
      lastLossMessage: this.lastLossMessage,
      canSimulateLoss: typeof this.device?.destroy === 'function',
    };
  }

  async waitForLoss(): Promise<WebGpuDeviceLifecycleStatus> {
    await this.currentLostPromise;
    return this.status();
  }

  async recover(adapterOverride?: GpuAdapterLike): Promise<WebGpuRecoveryResult> {
    this.state = 'recovering';
    try {
      const adapter = adapterOverride ?? (await (navigator as NavigatorWithGpu).gpu?.requestAdapter()) ?? this.adapter;
      if (!adapter) {
        this.state = 'failed';
        return { ok: false, status: this.status(), device: null, error: 'requestAdapter returned null' };
      }
      const device = await adapter.requestDevice();
      this.trackDevice(device, adapter);
      return { ok: true, status: this.status(), device };
    } catch (error) {
      this.state = 'failed';
      return {
        ok: false,
        status: this.status(),
        device: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async simulateLossAndRecover(): Promise<WebGpuRecoveryResult> {
    if (!this.device || typeof this.device.destroy !== 'function') {
      return { ok: false, status: this.status(), device: null, error: 'device.destroy unavailable' };
    }
    this.device.destroy();
    await this.waitForLoss();
    return this.recover();
  }
}
