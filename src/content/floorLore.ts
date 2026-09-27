/**
 * What the Sanctum tells you about the floor below (Breathing Works). House
 * tone: dry Victorian-industrial wit — understatement, brass, tea. One line
 * of character, then the floor's signature reaction and its resident.
 */
export interface FloorLore {
  /** The floor in one breath. */
  line: string;
  /** The reaction the floor is built around. */
  signature: string;
  /** Who lives there, and why you should care. */
  resident: string;
}

export const FLOOR_LORE: Record<string, FloorLore> = {
  d1: {
    line: 'The lungs of the Works. It breathes steam on a schedule; kindly keep to it.',
    signature: 'Water, steam and the breathing cycle.',
    resident: 'Weavers, who remember faces.',
  },
  d2: {
    line: 'The gut. Everything here is growing, rotting, or making up its mind, and the air is flammable.',
    signature: 'Marsh gas pools under the ceilings. One spark and the garden becomes a kitchen.',
    resident: 'Rootlopers, who object to being stepped on.',
  },
  d3: {
    line: 'The veins. Several hundred tons of water and one very large tenant who never pays rent.',
    signature: 'Water carries a current. Electricity is recommended; standing in it while you use it is not.',
    resident: 'The Sunken Leviathan. It drains poorly.',
  },
  d4: {
    line: 'The heart. Hot, loud, and under the impression that it is a volcano.',
    signature: 'Lava meets water and stone happens. Steam happens faster.',
    resident: 'The Kiln Colossus. Stopping it is the whole point.',
  },
};
