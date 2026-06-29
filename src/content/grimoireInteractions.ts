export interface GrimoireInteractionEntry {
  id: string;
  title: string;
  body: string;
}

export const GRIMOIRE_INTERACTIONS: readonly GrimoireInteractionEntry[] = [
  {
    id: 'water-quench-fire',
    title: 'Water Quenches Fire',
    body: 'Water and flame collapse into steam; carry water when wood and embers block the path.',
  },
  {
    id: 'lava-flashes-water',
    title: 'Lava Flashes Water',
    body: 'Water touching lava bursts to steam and can chill molten rock into stone crust.',
  },
  {
    id: 'nitrogen-freezes-water',
    title: 'Nitrogen Freezes Water',
    body: 'Liquid nitrogen flash-freezes nearby water into ice before it boils away.',
  },
  {
    id: 'charge-conductors',
    title: 'Conductive Paths',
    body: 'Charge travels through water, lava, and metal; wet metal rooms can become circuits.',
  },
  {
    id: 'acid-water-transmutation',
    title: 'Acid Solvent Alchemy',
    body: 'Acid beside water can turn eaten rock into gold, but the reaction is rare and local.',
  },
];
