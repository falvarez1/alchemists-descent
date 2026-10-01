/**
 * THE CLERK OF WORKS — the Guild's clerk, who is still posting notices on a
 * Sanctum wall long after anyone could obey them (his costume is the clerk in
 * the Cold Store's echo). One signed notice goes up per Sanctum after floors
 * 1-3, two to choose between so a second descent is not a reprint; the Sanctum
 * shows it under its title (ui/Sanctum), where there is room for a line.
 *
 * Text only, signed, never spoken: there is no voice for him, and a notice is
 * read. No joke here depends on the player, so nothing tracks what was seen.
 */

export const CLERK_SIGNATURE = 'The Clerk of Works';

/** The notices, by the floor the apprentice has just finished (1-3). */
export const CLERK_NOTICES: Readonly<Record<number, readonly string[]>> = {
  1: [
    'NOTICE. Descent is voluntary. The form to that effect is kept on the floor below.',
    'NOTICE. Brass is not edible. This has been tested.',
  ],
  2: [
    'NOTICE. Apprentices are not to name the creatures below. A name implies a relationship, and the insurers have objected.',
    'NOTICE. Lost property will be returned to its owner where found, and to the Works where not.',
  ],
  3: [
    'NOTICE. The Heart is not to be argued with. Apprentices found arguing will be asked to stop.',
    'NOTICE. Tea is at four. It has been at four since the foundation, and will be at four after.',
  ],
};

/** The notice for the Sanctum below `floor`, chosen by `pick` (a run number); null where none is posted. */
export function clerkNotice(floor: number, pick: number): { text: string; signature: string } | null {
  const notices = CLERK_NOTICES[floor];
  if (!notices?.length) return null;
  return { text: notices[Math.abs(Math.floor(pick)) % notices.length], signature: CLERK_SIGNATURE };
}
