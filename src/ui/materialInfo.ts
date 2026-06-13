import type { MaterialParams } from '@/core/types';
import { blocksEntity, Cell, isGas, isLiquid, isSolid } from '@/sim/CellType';
import { ELEMENT_ICON, makeIconCanvas } from '@/ui/icons';
import { paramSliderSpec } from '@/ui/Inspector';

/**
 * Player-facing gameplay copy for the material palettes (Sandbox toolbar and
 * Builder): what each material does, what it reacts with, what it converts
 * to. UI copy only — the handlers in sim/elements are the truth; keep these
 * honest when behaviors change.
 */
export const MATERIAL_INFO: Record<number, string> = {
  [Cell.Empty]: 'Erases painted cells back to open air.',
  [Cell.Sand]:
    'Loose powder: falls, piles, and sinks through liquids. Lava contact or a strong electric charge fuses it into Glass.',
  [Cell.Water]:
    'Flows and pools. Quenches fire into steam, hardens lava into Stone, dilutes Toxic Sludge, feeds vine growth, and conducts lightning. Drinking it snuffs any flames on you.',
  [Cell.Wall]:
    'Inert structural rock. Acid dissolves it — and beside water (rarely) or Aurum Catalyst (readily) the bite transmutes it into Gold Powder instead.',
  [Cell.Wood]:
    'Solid timber that catches fire and smokes as it burns. Acid eats it, or transmutes it to Gold Powder when water or Aurum Catalyst sits beside the bite.',
  [Cell.Fire]:
    'Spreads to anything flammable, climbs upward, and detonates gunpowder. Water turns it to steam; burnt-out flames occasionally leave drifting Ash.',
  [Cell.Oil]:
    'Flammable liquid that floats on water. Fire or any electric spark ignites it into a long burn.',
  [Cell.Acid]:
    'Eats through everything but Metal and Aurum Catalyst, fizzing into steam and consuming itself. Beside water (rarely) or the Catalyst (readily) the bite transmutes rock, wood, and stone into Gold Powder. Caustic to the touch.',
  [Cell.Gunpowder]:
    'Powder that detonates the moment fire or an electric charge reaches it — one grain takes the whole pile.',
  [Cell.Steam]:
    'Hot vapor that rises and cools, condensing back into water under ceilings.',
  [Cell.Ice]:
    'Frozen solid that fire and lava melt back to water (a hot flash can boil it to steam). Liquid Nitrogen freezes water into more of it.',
  [Cell.Lava]:
    'Molten rock: ignites wood, oil, vines, and fungi; melts ice and snow; fuses sand into Glass. Touching water hardens it into Stone in a burst of steam. Conducts lightning.',
  [Cell.Stone]:
    'Plain rock, born where lava meets water. Acid dissolves it or — beside water or Aurum Catalyst — transmutes it into Gold Powder.',
  [Cell.Metal]:
    'Rigid and conductive: carries sparks and chain lightning. The one solid acid cannot dissolve.',
  [Cell.Smoke]: 'Inert exhaust gas: rises, disperses, and fades away.',
  [Cell.Vines]:
    'Living growth that drinks neighboring water and spreads — hanging, creeping, climbing — until its energy is spent. Very flammable.',
  [Cell.Nitrogen]:
    'Cryogenic liquid: freezes water into Ice and shocks lava into Stone, boiling away as it works. Slowly evaporates on its own.',
  [Cell.Gold]:
    'Heavy precious powder. Dig it loose in play mode and the grains home to your purse. Acid alchemy creates it; the cauldron accepts it as an ingredient.',
  [Cell.Blood]:
    'Spilled by wounded creatures. Stains rock and timber, slowly darkens as it dries, and conducts lightning.',
  [Cell.Slime]:
    'Glowing goo the alchemist absorbs on contact to heal. Fire occasionally renders it into Acid.',
  [Cell.Ember]:
    'Drifting sparks that smoulder wood and vines and instantly light oil or gunpowder. Water or Liquid Nitrogen quenches them to steam.',
  [Cell.ElixirLife]:
    'Brewed regeneration draught: siphon it (E) and drink (X) to mend over time. In the world it sits inert — its glow is the tell.',
  [Cell.ElixirLevity]:
    'Brewed flight draught: drink (X) and levitation burns no fuel while the timer runs.',
  [Cell.ElixirStone]:
    'Brewed stoneskin draught: drink (X) to halve all damage taken while it lasts.',
  [Cell.Toxic]:
    'Poison ooze: damages on contact and catches fire. Clean water dilutes it back into water; lava boils it into smoke.',
  [Cell.Healium]:
    'Rose liquid that heals on touch, consumed as it works, and slowly evaporates into pink vapor. Heat flashes it to steam.',
  [Cell.Teleportium]:
    'Violet liquid that flings whoever touches it somewhere else entirely. Sheds sparkling motes.',
  [Cell.Snow]:
    'Soft light powder. Nearby fire, ember, or lava melts it to water — lava flashes it straight to steam.',
  [Cell.Coal]:
    'Dense fuel: slow to catch from fire or lava, but burns long and hot once lit.',
  [Cell.Crystal]:
    'Glittering translucent crystal that sparkles and carries light deep into the rock. Cave critters gather to its glow.',
  [Cell.Fungus]:
    'Bioluminescent colony that creeps along solid surfaces until its energy is spent, then settles in to glow. Burns readily.',
  [Cell.Glass]:
    'Translucent solid fused from sand by lava or lightning. Lets light through; acid dissolves it.',
  [Cell.Ash]:
    'Featherlight burnt residue: drifts sideways as it falls and dissolves in water.',
  [Cell.Glowshroom]:
    'Still, glowing cave growth — a living lamp. Catches fire.',
  [Cell.Moss]:
    'Damp green creep that slowly spreads over wet rock and stops where the cave runs dry. Burns short and smoky.',
  [Cell.Catalyst]:
    "The philosopher's dust. Acid biting rock, wood, or stone beside it transmutes them into Gold Powder, consuming a grain of dust per conversion. Acid cannot eat the dust itself.",
};

/**
 * Fills a material popover: pixel icon (color dot fallback), name, sim
 * classification, gameplay description, and the live tunable properties.
 * Shared by the Builder palette and the Sandbox toolbar so both popovers
 * say the same thing.
 */
export function fillMaterialPopover(
  pop: HTMLDivElement,
  id: number,
  name: string,
  color: string,
  profile: MaterialParams | undefined,
): void {
  const head = document.createElement('div');
  head.className = 'bp-pop-head';
  const icon = makeIconCanvas(ELEMENT_ICON[id] ?? '', 4);
  if (icon) {
    head.appendChild(icon);
  } else {
    const dot = document.createElement('span');
    dot.className = 'bp-matpop-dot';
    dot.style.background = color;
    head.appendChild(dot);
  }
  const label = document.createElement('span');
  label.textContent = name;
  head.appendChild(label);
  pop.appendChild(head);

  // classification straight from the sim predicates — the grid's truth
  const tags: string[] = [];
  if (isLiquid(id)) tags.push('liquid');
  else if (isGas(id)) tags.push('gas');
  else if (isSolid(id)) tags.push('solid');
  else if (blocksEntity(id)) tags.push('powder');
  if (id === Cell.Fire || id === Cell.Ember) tags.push('burns');
  if (tags.length > 0) {
    const t = document.createElement('div');
    t.className = 'bp-pop-tags';
    t.textContent = tags.join(' · ');
    pop.appendChild(t);
  }

  const info = MATERIAL_INFO[id];
  if (info) {
    const d = document.createElement('div');
    d.className = 'bp-pop-desc';
    d.textContent = info;
    pop.appendChild(d);
  }

  if (profile) {
    const fields = profile as unknown as Record<string, number | string>;
    for (const key of Object.keys(fields)) {
      if (key === 'name') continue;
      const spec = paramSliderSpec(key);
      const row = document.createElement('div');
      row.className = 'bp-pop-prop';
      const value =
        key === 'bloomWeight'
          ? ((fields[key] as number) * 100).toFixed(0) + '%'
          : String(fields[key]);
      row.innerHTML = `<span>${spec.label.replace(/([A-Z])/g, ' $1')}</span><b>${value}</b>`;
      pop.appendChild(row);
    }
  }
}
