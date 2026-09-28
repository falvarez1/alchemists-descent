import type { Critter, Ctx } from '@/core/types';
import type { OrganismHost } from './common';
import { stepGlowworm } from './glowworm';
import { stepPuffer } from './puffer';
import { stepSnapjaw } from './snapjaw';
import { stepCrawler } from './crawler';
import { stepLeech } from './leech';
import { stepAshmoth } from './ashmoth';
import { stepLightMoth } from './lightmoth';
import { stepSkater } from './skater';

export type { OrganismHost } from './common';
export { isOrganism, ORGANISM_KINDS, SESSILE_KINDS } from './types';

/** One tick of an organism's life. Returns false when it should leave the world. */
export function stepOrganism(ctx: Ctx, c: Critter, host: OrganismHost): boolean {
  switch (c.kind) {
    case 'glowworm': return stepGlowworm(ctx, c, host);
    case 'puffer': return stepPuffer(ctx, c, host);
    case 'snapjaw': return stepSnapjaw(ctx, c, host);
    case 'isopod': case 'emberbeetle': case 'frostmite': case 'glassbeetle': case 'lensmite': return stepCrawler(ctx, c, host);
    case 'leech': return stepLeech(ctx, c, host);
    case 'ashmoth': return stepAshmoth(ctx, c);
    case 'snowmoth': case 'prismmoth': return stepLightMoth(ctx, c);
    case 'brineskater': return stepSkater(ctx, c);
    default: return true;
  }
}
