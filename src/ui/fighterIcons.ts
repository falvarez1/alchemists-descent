/**
 * The fighters' ability icon set: thirty 24x24 line pictograms (ten fighters x passive / tactical /
 * ultimate), the five role glyphs the roster filter uses, and the three slot glyphs.
 *
 * House style is the editor's (`ui/editor/icons.ts`): inline SVG strings, `currentColor` strokes so the
 * HUD tints an icon with the fighter's accent, round caps and joins, filled dots as solid
 * `currentColor`. Two differences from the editor set: a 24 grid (the HUD draws them at 16-40 px, big
 * enough for a story), and one translucent "tint" fill per glyph (`currentColor` at 26% alpha) that
 * gives the main body some weight on a dark HUD without a second colour.
 *
 * Rules every glyph keeps, so the set reads as one hand:
 *  - ONE stroke weight (1.6), set on the root; nothing overrides it. Rivets and pupils are filled dots.
 *  - Geometry stays inside 2 to 22 on the 24 grid, so a stroke never reaches the edge.
 *  - A glyph is drawn from the ability's NAME and DESCRIPTION (docs/FIGHTERS.md), never from its role.
 *  - Silhouette beats detail: no two glyphs share an outline, so a grid of all thirty stays legible.
 *  - No ids, no `url(#...)`, no style or script: several icons can sit on one page without colliding.
 */

import type { FighterId, FighterRole } from '@/content/fighters';

export type AbilityIconSlot = 'passive' | 'tactical' | 'ultimate';

export type AbilityIconKey = `${FighterId}.${AbilityIconSlot}`;

/** Translucent body fill: the one tint a glyph may carry. */
const T = 'fill="currentColor" fill-opacity=".26"';
/** Solid accent: rivets, pupils, sparks. */
const S = 'fill="currentColor" stroke="none"';

const ABILITY_BODIES: Record<AbilityIconKey, string> = {
  // ---- 01 Ilyra Voss: the Cinder Alchemist ----
  // Volatile Mixture: two different weapons (crossed) feed one flame.
  'ilyra-voss.passive':
    `<path d="M12 2.6c.5 2.8 3.7 4.2 3.7 7.6a3.7 3.7 0 0 1-7.4 0c0-1.6.7-2.6 1.6-3.5.2 1.2.7 1.9 1.4 2.3.5-2.3.2-4 .7-6.4z" ${T}/>` +
    `<path d="M5.5 15.8 18.5 21.2M18.5 15.8 5.5 21.2"/>`,
  // Flash Crucible: a round vial going off in the middle of its own burst.
  'ilyra-voss.tactical':
    `<path d="M12 2.4 13.2 5.4 16.4 4 15.4 7.2 19.6 7.8 16.6 10 21.2 12.6 16.8 13.4M12 2.4 10.8 5.4 7.6 4 8.6 7.2 4.4 7.8 7.4 10 2.8 12.6 7.2 13.4"/>` +
    `<path d="M10.4 8.4H13.6V11A4.6 4.6 0 1 1 10.4 11Z" ${T}/><path d="M9.4 8.4H14.6"/>`,
  // Phoenix Draft: a winged flame, wings swept back.
  'ilyra-voss.ultimate':
    `<path d="M12 8.2c1.4 2 3 3.2 3 5.8a3 3 0 0 1-6 0c0-2.4 1.8-3.6 3-5.8z" ${T}/>` +
    `<path d="M9.3 15.3C6.2 15.3 3.4 12.4 2.6 6.2c1.6 1.4 2.8 1.6 4 1.4-.8 1.4-.2 2.4.8 3 .1 1.2 1.2 2.2 2.3 2.4"/>` +
    `<path d="M14.7 15.3c3.1 0 5.9-2.9 6.7-9.1-1.6 1.4-2.8 1.6-4 1.4.8 1.4.2 2.4-.8 3-.1 1.2-1.2 2.2-2.3 2.4"/>` +
    `<path d="M12 19.2V21.4"/>`,

  // ---- 02 Brann Rook: the Iron Pilgrim ----
  // Pressure Vessel: the dial climbing as the hits land.
  'brann-rook.passive':
    `<circle cx="12" cy="12.5" r="8.7" ${T}/>` +
    `<path d="M6.8 13.4 5.1 13.7M7.7 9.5 6.3 8.5M11.1 7.3 10.8 5.6M15 8.2 16 6.8M17.2 11.6 18.9 11.3"/>` +
    `<path d="M12 12.5 16.4 9.7"/><circle cx="12" cy="12.5" r="1.3" ${S}/>`,
  // Boiler Guard: a riveted iron plate shrugging off what hits it.
  'brann-rook.tactical':
    `<path d="M10.6 2.8H17L19.4 5.2V18.8L17 21.2H10.6L8.2 18.8V5.2Z" ${T}/>` +
    `<circle cx="11.4" cy="6.6" r=".95" ${S}/><circle cx="16.2" cy="6.6" r=".95" ${S}/><circle cx="11.4" cy="17.4" r=".95" ${S}/><circle cx="16.2" cy="17.4" r=".95" ${S}/>` +
    `<path d="M2.5 9 5.6 11 3 13.2M4.6 6.4 6 8.2M4 16.6 5.6 15.4"/>`,
  // Redline: the armoured suit venting steam.
  'brann-rook.ultimate':
    `<path d="M8.6 7.4 4.4 9.6V15.2L8.2 21.2H15.8L19.6 15.2V9.6L15.4 7.4C14.8 9 13.6 9.8 12 9.8S9.2 9 8.6 7.4Z" ${T}/>` +
    `<path d="M9.6 13.4H14.4M10.2 16H13.8"/>` +
    `<path d="M6.4 6.2C5.2 5 7.6 4.2 6.4 3M12 5.6C10.8 4.4 13.2 3.6 12 2.4M17.6 6.2C16.4 5 18.8 4.2 17.6 3"/>`,

  // ---- 03 Sable Fen: the Mire Stalker ----
  // Wounded Spoor: a track left by a wounded foe.
  'sable-fen.passive':
    `<path d="M10.5 13c-2.6 0-4.6 2.2-4.6 4.2 0 1.7 1.3 2.4 2.6 2.4.8 0 1.3-.4 2-.4s1.2.4 2 .4c1.3 0 2.6-.7 2.6-2.4 0-2-2-4.2-4.6-4.2z" ${T}/>` +
    `<circle cx="5.6" cy="11.2" r="1.5" ${S}/><circle cx="8.6" cy="7.9" r="1.5" ${S}/><circle cx="12.6" cy="7.9" r="1.5" ${S}/><circle cx="15.6" cy="11.2" r="1.5" ${S}/>` +
    `<path d="M19 2.8c1 1.5 1.7 2.3 1.7 3.2a1.7 1.7 0 0 1-3.4 0c0-.9.7-1.7 1.7-3.2z" ${T}/>`,
  // Bogline: a hook on a taut line.
  'sable-fen.tactical':
    `<path d="M4.4 19.6 10.4 13.6"/><circle cx="3.5" cy="20.5" r="1.2" ${S}/><circle cx="11.4" cy="12.6" r="1.3"/>` +
    `<path d="M12.3 11.7 15.8 8.2A3 3 0 1 1 16.9 13.1L15.2 12.5"/>`,
  // Bloodsense: an eye whose pupil is a drop of blood.
  'sable-fen.ultimate':
    `<path d="M2.5 12C5 7.6 8.4 5.5 12 5.5s7 2.1 9.5 6.5c-2.5 4.4-5.9 6.5-9.5 6.5S5 16.4 2.5 12z" ${T}/>` +
    `<path d="M12 8.4c1.2 1.7 2.3 2.7 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1.3 1.1-2.3 2.3-4z" ${S}/>`,

  // ---- 04 Mara Quell: the Bell Witch ----
  // Keen Resonance: an ear, footfalls arriving.
  'mara-quell.passive':
    `<path d="M8 10A5 5 0 0 1 18 10C18 13.8 13.6 14.2 13.6 17.6A3.1 3.1 0 0 1 7.4 17.6"/>` +
    `<path d="M11 10.2A2 2 0 0 1 15 10.2C15 11.6 12.9 12 12.9 13.4"/>` +
    `<path d="M4.4 8.2Q6.4 11.4 4.4 14.6"/>`,
  // Resonance Bell: a bell with ring arcs.
  'mara-quell.tactical':
    `<path d="M12 4.5C8.6 4.5 7.3 7.3 7.3 10.2c0 3.6-1.5 4.6-2.3 6.4H19c-.8-1.8-2.3-2.8-2.3-6.4C16.7 7.3 15.4 4.5 12 4.5z" ${T}/>` +
    `<path d="M12 4.5V3"/><circle cx="12" cy="19.4" r="1.5" ${S}/>` +
    `<path d="M4 6.2C2.6 8 2.6 10.4 4 12.2M20 6.2C21.4 8 21.4 10.4 20 12.2"/>`,
  // Dead Chime: a struck tuning fork, the wave going out through the walls.
  'mara-quell.ultimate':
    `<path d="M8.6 3V12.2A3.4 3.4 0 0 0 15.4 12.2V3"/><rect x="10.6" y="15.4" width="2.8" height="6" rx="1.2" ${T}/>` +
    `<path d="M5.2 6.2Q3.2 8.8 5.2 11.4M18.8 6.2Q20.8 8.8 18.8 11.4"/>`,

  // ---- 05 Kest Rel: the Chimney Jack ----
  // Rooftop Runner: a ladder, and the clock it beats.
  'kest-rel.passive':
    `<path d="M5.5 3V21M11 3V21M5.5 7.5H11M5.5 12H11M5.5 16.5H11"/>` +
    `<circle cx="17.4" cy="8" r="3.9" ${T}/><path d="M17.4 5.8V8L19 9"/>`,
  // Smoke Step: a boot kicking off out of its own soot.
  'kest-rel.tactical':
    `<path d="M9.5 3.5H16V10.4C16 12.8 18.6 13.2 20 15 21 16.2 21 17.4 21 19.6H9.5Z" ${T}/><path d="M9.5 16.8H21"/>` +
    `<circle cx="5" cy="17.2" r="2.4"/><circle cx="3.6" cy="12.2" r="1.4"/><path d="M2.5 7.4H6.4"/>`,
  // Updraft: a compact furnace throwing a column of lift.
  'kest-rel.ultimate':
    `<rect x="3.5" y="15" width="17" height="6.5" rx="1.4" ${T}/><path d="M9.6 21.5V19.6a2.4 2.4 0 0 1 4.8 0V21.5"/>` +
    `<path d="M12 16.4c.5 1.2 1.7 1.7 1.7 2.9a1.7 1.7 0 0 1-3.4 0c0-1.2 1.2-1.7 1.7-2.9z" ${S}/>` +
    `<path d="M12 12.6V3.6M8.6 7 12 3.6 15.4 7M6.4 12V7.6M4.4 9.4 6.4 7.4 8.4 9.4M17.6 12V7.6M15.6 9.4 17.6 7.4 19.6 9.4"/>`,

  // ---- 06 Nox Calder: the Lampblack ----
  // Soot Sight: goggles that see through the dark.
  'nox-calder.passive':
    `<circle cx="7.6" cy="12.5" r="3.9" ${T}/><circle cx="16.4" cy="12.5" r="3.9" ${T}/>` +
    `<path d="M11.5 12.1h1M3.7 11.2 2.4 9.4M20.3 11.2 21.6 9.4"/><path d="M5.8 11.2a2.4 2.4 0 0 1 1.6-1.1"/>`,
  // Blackglass: a thrown canister and the cloud it opens.
  'nox-calder.tactical':
    `<path d="M8.6 12C6 11.6 6 8 8.4 7.4 8 4.6 11.4 3.2 13.2 5.2 14.8 2.8 19 3.8 19 7 21.6 7 22 11 19.6 11.8 19 13.6 16.2 13.8 15.2 12.6 13.6 14 10.4 13.8 8.6 12Z" ${T}/>` +
    `<g transform="translate(7.6 16.8) rotate(32)"><rect x="-3" y="-4" width="6" height="8.2" rx="1.5"/><path d="M-1.4-4V-5.6H1.4V-4M-3-.6H3"/></g>`,
  // Long Night: the moon, the lamps out.
  'nox-calder.ultimate':
    `<path d="M20.2 14.4A9 9 0 1 1 9.6 3.8 7 7 0 0 0 20.2 14.4z" ${T}/>` +
    `<path d="M17.4 3.6V8.2M15.1 5.9H19.7"/>`,

  // ---- 07 Edda Morrow: the Glass Saint ----
  // Stored Light: a shield with the light inside.
  'edda-morrow.passive':
    `<path d="M12 2.8 19.5 5.4V11.6C19.5 16 16.2 19.3 12 21.2 7.8 19.3 4.5 16 4.5 11.6V5.4z" ${T}/>` +
    `<path d="M12 7.6C12.4 10 13.4 11 15.8 11.5 13.4 12 12.4 13 12 15.4 11.6 13 10.6 12 8.2 11.5 10.6 11 11.6 10 12 7.6z" ${S}/>`,
  // Mercy Shard: a glass shard under a small halo.
  'edda-morrow.tactical':
    `<path d="M14.2 7 18 12 10.6 21.6 6.6 14.4z" ${T}/><path d="M14.2 7 11.4 13.6 10.6 21.6"/>` +
    `<ellipse cx="14.2" cy="3.8" rx="3.8" ry="1.4"/>`,
  // Rose Window: a stained-glass lancet with its rose.
  'edda-morrow.ultimate':
    `<path d="M5 21V10.8C5 6.8 8 3.6 12 2.6 16 3.6 19 6.8 19 10.8V21Z"/>` +
    `<path d="M12 7A1.9 1.9 0 0 1 14.77 8.6A1.9 1.9 0 0 1 14.77 11.8A1.9 1.9 0 0 1 12 13.4A1.9 1.9 0 0 1 9.23 11.8A1.9 1.9 0 0 1 9.23 8.6A1.9 1.9 0 0 1 12 7Z" ${T}/>` +
    `<circle cx="12" cy="10.2" r="1" ${S}/><path d="M12 14.8V21"/>`,

  // ---- 08 Selene Wraith: the Mercury Twin ----
  // Liquid Momentum: a drop of mercury streaking over a liquid floor.
  'selene-wraith.passive':
    `<path d="M21 11.2C21 6.8 14.8 6.6 10.2 10.8 14.8 15 21 15.4 21 11.2Z" ${T}/>` +
    `<path d="M2.5 14.4H7M2.5 10.4H5.4"/><path d="M2.5 20q2.4-1.8 4.8 0t4.8 0 4.8 0 4.8 0"/>`,
  // Quicksilver Echo: you, and the echo you left behind.
  'selene-wraith.tactical':
    `<circle cx="10.4" cy="6.8" r="2.8" stroke-dasharray="2.1 1.9"/><path d="M4.2 17.6C4.2 13.8 6.5 11.8 10.4 11.8" stroke-dasharray="2.4 2"/>` +
    `<circle cx="15" cy="9.8" r="3" ${T}/><path d="M9.4 21C9.4 16.2 11.4 14.4 15 14.4S20.6 16.2 20.6 21Z" ${T}/>`,
  // Mirror Hunt: a hand mirror, and who is in it.
  'selene-wraith.ultimate':
    `<ellipse cx="12" cy="9.2" rx="6.8" ry="7" ${T}/><rect x="10.9" y="16.4" width="2.2" height="5.2" rx="1.1" ${T}/>` +
    `<circle cx="12" cy="7" r="1.7"/><path d="M8.8 13.2C8.8 10.8 10.2 9.8 12 9.8S15.2 10.8 15.2 13.2"/>`,

  // ---- 09 Rusk Emberjaw: the Furnace Hound ----
  // Scrap Recovery: a hex nut, armor coming back.
  'rusk-emberjaw.passive':
    `<path d="M17.7 13.8 14.1 20.04H6.9L3.3 13.8 6.9 7.56H14.1Z" ${T}/><circle cx="10.5" cy="13.8" r="2.5"/>` +
    `<path d="M18.4 2.6V7.8M15.8 5.2H21"/>`,
  // Shoulder Ram: the charge, and the wall it breaks.
  'rusk-emberjaw.tactical':
    `<path d="M2.5 12H10.2M7.4 9 10.4 12 7.4 15"/>` +
    `<path d="M14 5.6 19.6 4.6 21 9.4 16 10.8Z" ${T}/><path d="M15.4 14.2 21 13.4 19.8 19.6 14 19.2Z" ${T}/>`,
  // Kiln Heart: a heart with a furnace burning in it.
  'rusk-emberjaw.ultimate':
    `<path d="M12 20.5C5 16.2 3 12.6 3 9.2 3 6.4 5.2 4.4 7.6 4.4c1.8 0 3.4 1 4.4 2.6 1-1.6 2.6-2.6 4.4-2.6 2.4 0 4.6 2 4.6 4.8 0 3.4-2 7-9 11.3z" ${T}/>` +
    `<path d="M12 9c.4 1.6 2.6 2.4 2.6 4.6a2.6 2.6 0 0 1-5.2 0c0-1 .5-1.8 1.2-2.4.1.8.5 1.2 1 1.4.4-1.4.2-2.4.4-3.6z" ${S}/>`,

  // ---- 10 Father Thorne: the Briar Heretic ----
  // Rooted Camouflage: a leaf on its roots.
  'father-thorne.passive':
    `<path d="M6 17.6C5.4 10 9.6 5 19.6 4.4 20 14 15.4 18.6 6 17.6z" ${T}/><path d="M6 17.6C9.4 14 12.6 10.8 16.6 7.8"/>` +
    `<path d="M6 17.6 3.8 19.8M4.8 18.8 4.8 21M4.8 18.8 2.6 18.8"/>`,
  // Ironvine: a thorned vine curl.
  'father-thorne.tactical':
    `<path d="M5 21C5 14 7 8 13.4 7c4-.6 6 2.6 4.2 5-1.6 2-5 1-4.6-1.4.2-1 1.4-1.2 1.8-.4"/>` +
    `<path d="M4.7 18.4 2.6 17.3 4.7 16ZM5.7 13.6 3.6 12.4 5.9 11.2ZM8.4 9.5 7.5 7.2 10.1 8.2ZM14.4 7.2 15.2 4.6 16.6 7Z" ${S}/>`,
  // Overgrowth: a tree, root and branch, over the whole zone.
  'father-thorne.ultimate':
    `<path d="M5.8 12.6a3.4 3.4 0 0 1-.9-6 4.4 4.4 0 0 1 7.6-2.2 4 4 0 0 1 6.2 3.2 3.6 3.6 0 0 1-.5 5Z" ${T}/>` +
    `<path d="M10.8 12.6V15.6M13.2 12.6V15.6M10.8 15.6C10.8 18.4 8.2 18.6 6.4 20.6M13.2 15.6C13.2 18.4 15.8 18.6 17.6 20.6M12 15.6V20.8"/>`,
};

const ROLE_BODIES: Record<FighterRole, string> = {
  // two blades crossed
  Duelist:
    `<path d="M4.5 19.5 19 5V8.6M19 5H15.4M6.2 13.6 10.4 17.8M4.5 19.5 3.6 20.4"/>` +
    `<path d="M19.5 19.5 5 5V8.6M5 5H8.6M17.8 13.6 13.6 17.8M19.5 19.5 20.4 20.4"/>`,
  // a rook: a tower that holds
  Bulwark:
    `<path d="M5 21H19M6.5 21V10H8V6H10.5V8.5H13.5V6H16V10H17.5V21" ${T}/><path d="M10.5 21V17.2a1.5 1.5 0 0 1 3 0V21"/>`,
  // crosshair
  Hunter:
    `<circle cx="12" cy="12" r="6.4"/><path d="M12 2.5V7M12 17V21.5M2.5 12H7M17 12H21.5"/><circle cx="12" cy="12" r="1.2" ${S}/>`,
  // an hourglass: slow the field
  Controller:
    `<path d="M7 4.5C7 9 12 10.5 12 12S7 15 7 19.5Z" ${T}/><path d="M17 4.5C17 9 12 10.5 12 12S17 15 17 19.5Z"/>` +
    `<path d="M5.5 3.5H18.5M5.5 20.5H18.5"/>`,
  // a plus, with a halo
  Support:
    `<path d="M9.8 6.5H14.2V10.1H17.8V14.5H14.2V18.1H9.8V14.5H6.2V10.1H9.8Z" ${T}/><path d="M9 3.6A4.4 1.4 0 0 1 15 3.6"/>`,
};

const SLOT_BODIES: Record<AbilityIconSlot, string> = {
  // a heartbeat: always on
  passive: `<path d="M2.5 12.5H7L9.5 6.5 13.5 18 16 12.5H21.5"/>`,
  // a bolt: on demand
  tactical: `<path d="M13.5 2.5 5.5 13.2H11.2L10 21.5 18.5 10.5H12.8Z" ${T}/>`,
  // a star: the big one
  ultimate: `<path d="M12 3.2 14.53 9.32 21.13 9.83 16.09 14.13 17.64 20.57 12 17.1 6.36 20.57 7.91 14.13 2.87 9.83 9.47 9.32Z" ${T}/>`,
};

/** Every `${id}.${slot}` key an ability glyph exists for. */
export const ABILITY_ICON_KEYS = Object.keys(ABILITY_BODIES) as AbilityIconKey[];

function svg(body: string, size: number): string {
  return (
    `<svg class="fighter-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Inline SVG markup (viewBox 0 0 24 24, stroke=currentColor, fill none unless noted, round caps/joins) for one ability. */
export function abilityIcon(id: FighterId, slot: AbilityIconSlot, size = 24): string {
  const key: AbilityIconKey = `${id}.${slot}`;
  return svg(Object.prototype.hasOwnProperty.call(ABILITY_BODIES, key) ? ABILITY_BODIES[key] : '', size);
}

/** The generic role glyph the roster filter uses. */
export function roleIcon(role: FighterRole, size = 24): string {
  return svg(Object.prototype.hasOwnProperty.call(ROLE_BODIES, role) ? ROLE_BODIES[role] : '', size);
}

/** The generic slot glyph: passive pulse, tactical bolt, ultimate star. */
export function slotIcon(slot: AbilityIconSlot, size = 24): string {
  return svg(Object.prototype.hasOwnProperty.call(SLOT_BODIES, slot) ? SLOT_BODIES[slot] : '', size);
}
