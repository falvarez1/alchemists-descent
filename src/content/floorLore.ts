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
  // The second doors (wave 3: the branching descent). First drafts; the Story
  // workstream polishes the voice.
  d2b: {
    line: 'The refrigeration wing. The Guild kept its reagents here, and the cold kept everything else. It still does.',
    signature: 'Water freezes, ice shatters, and the brine refuses both. Heat undoes the lot.',
    resident: 'The Rime Warden. It kept its watch so long it froze to the post.',
  },
  d3b: {
    line: 'The lens-grinding halls, where the Guild made the Works its eyes. The light down here is always on its way somewhere else.',
    signature: 'Mirrors turn your wand’s beam, crystal splits it, and glass breaks when struck. The lenses still want feeding.',
    resident: 'The Lenswright. It grinds its own light, and aims it well.',
  },
};

/**
 * What the Docent says when the floor below has two doors (the Sanctum shows
 * both teasers side by side; choosing one reads that floor's own line).
 */
export const TWO_DOORS_LINE = 'Two stairs go down from here. The old ones will not say which is kinder, which is a sort of answer.';
