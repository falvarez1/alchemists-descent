import { SLOT, matsFor, rgbOf } from '@/render/player/fighterLook';
import type { FighterLook, LookCtx } from '@/render/player/fighterLook';

/** Gold piping down the coat's front edge, at the collar and at the cuffs: the long coat reads as hers, not the alchemist's. */
function piping(c: LookCtx): void {
  const { r, s, f } = c;
  const G = SLOT.trim;
  const topX = s.chest.x + f * 1.5, topY = s.chest.y - 0.2;
  const botX = s.hip.x + f * 1.9, botY = s.hip.y + 1.0;
  r.stroke(topX, topY, botX, botY, G, 1.4, false, 0.4);
  r.stroke(s.chest.x - f * 0.6, s.chest.y - 1.1, s.chest.x + f * 1.5, s.chest.y - 0.9, G, 1.8, true);
  r.stamp(s.frontHand.x - (s.frontHand.x - s.frontElbow.x) * 0.25, s.frontHand.y - (s.frontHand.y - s.frontElbow.y) * 0.25, 0.9, 0.35, Math.atan2(s.frontHand.y - s.frontElbow.y, s.frontHand.x - s.frontElbow.x) + 1.57, G, 1.6, false, 13);
}

/**
 * Ilyra Voss, the Cinder Alchemist: a teal long coat with gold piping, a wide cream hat, a long silver braid,
 * flasks on a bandolier and a brass flintlock. Her glow is cinder-orange, not the alchemist's cyan.
 */
export const look: FighterLook = {
  id: 'ilyra-voss',
  mats: matsFor({
    coat: { keys: [0x07191b, 0x0f3a3b, 0x1b6a66, 0x2f9a8c, 0x72d4c0], gloss: 0.18, rim: 0.85, outline: 0x040a0b },
    coatD: { keys: [0x050f11, 0x0b2628, 0x13403f, 0x1f5f5a, 0x3a8a80], gloss: 0.1, rim: 0.7, outline: 0x040a0b },
    // The hat's felt (the alchemist's "mantle" slot): cream, with a warm shadow.
    mantle: { keys: [0x3a3226, 0x7a6c52, 0xb8a888, 0xe8dcc0, 0xfff7e2], gloss: 0.1, rim: 0.8, outline: 0x120f0a },
    leather: { keys: [0x120a06, 0x2a1810, 0x4a2c1c, 0x6e4630, 0x96654a], gloss: 0.25, rim: 0.6, outline: 0x060403 },
    trim: { keys: [0x3a2606, 0x8a5c10, 0xd49a2a, 0xffd46a, 0xfff0b0], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140a02 },
    skin: { keys: [0x3a1c14, 0x7a4a38, 0xc08468, 0xeab894, 0xffe0c4], gloss: 0.15, rim: 0.6, outline: 0x160a06 },
    hair: { keys: [0x3c4150, 0x7e869a, 0xb8c0d0, 0xe6eaf2, 0xffffff], gloss: 0.3, shine: 14, rim: 0.7, outline: 0x15171f },
    boot: { keys: [0x070404, 0x1a0f0b, 0x2e1c14, 0x4a2e22], gloss: 0.4, shine: 14, rim: 0.6, outline: 0x030202 },
    glow: { keys: [0x5a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1 },
    rune: { keys: [0x5a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1 },
  }),
  accent: rgbOf(0xefa860),
  outfit: 'coat',
  headgear: 'wide',
  hair: 'braid',
  face: 'open',
  wand: 'pistol',
  mantle: false,
  bandolier: true,
  pouches: true,
  extras: { torso: piping },
};
