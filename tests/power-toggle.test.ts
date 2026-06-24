import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { isPerkActive, setPerkActive } from '@/content/perks';
import { createDefaultStatus } from '@/entities/status';

function ctxWithPlayer(): Ctx {
  return { player: { perks: {}, status: createDefaultStatus() } } as unknown as Ctx;
}

/**
 * The bench / god-HUD "ACTIVE POWERS" toggles flip perk flags, but the
 * review/god kit also grants a matching temporary status (swift, torch). Turning
 * a power OFF must clear its twin status too, or the effect lingers for up to a
 * minute and reads as a delayed toggle.
 */
describe('active power toggles', () => {
  it('clears the twin status when a status-backed power is switched off', () => {
    const ctx = ctxWithPlayer();

    setPerkActive(ctx, 'swiftfoot', true);
    ctx.player.status.swift = 3600;
    setPerkActive(ctx, 'swiftfoot', false);
    expect(isPerkActive(ctx, 'swiftfoot')).toBe(false);
    expect(ctx.player.status.swift).toBe(0);

    setPerkActive(ctx, 'torchbearer', true);
    ctx.player.status.torch = 3600;
    setPerkActive(ctx, 'torchbearer', false);
    expect(ctx.player.status.torch).toBe(0);
  });

  it('leaves unrelated statuses untouched for powers with no status twin', () => {
    const ctx = ctxWithPlayer();
    setPerkActive(ctx, 'might', true);
    ctx.player.status.swift = 600;
    ctx.player.status.torch = 600;

    setPerkActive(ctx, 'might', false);

    expect(isPerkActive(ctx, 'might')).toBe(false);
    expect(ctx.player.status.swift).toBe(600);
    expect(ctx.player.status.torch).toBe(600);
  });
});
