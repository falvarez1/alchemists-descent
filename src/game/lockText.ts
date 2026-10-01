import type { LevelRuntime, LockKind, Mechanism } from '@/core/types';

/**
 * THE LOCKS' VOICE (world/locks): every line the floor says about its signature puzzle, in one place
 * (the HUD's objective, the near-the-machine hint and its teach card, the portal's "Sealed" toast,
 * the minimap's name and description for the vault door). Dry, instruction first, the joke second —
 * and none of it on a surface that repeats (the objective and the toast are plain; the wit lives in the
 * teach cards, which show once, and in the Docent's asides, which are said once ever).
 */
export interface LockCopy {
  /** What the machine is called, for sentences. */
  name: string;
  /** The objective while the lock is shut and the alchemist is near the machine (or has been). */
  near: string;
  /** The objective once it is open and its reward is there to take. */
  open: string;
  /** The one-line hint beside the machine. */
  hint: string;
  /** The teach card (shown once). */
  teachTitle: string;
  teachBody: string;
  /** The portal's "Sealed" toast on a floor whose key is under this lock. */
  sealed: string;
  /** The vault door on the minimap. */
  placeName: string;
  placeDescription: string;
}

export const LOCK_TEXT: Record<LockKind, LockCopy> = {
  gasbell: {
    name: 'the Gas Bell',
    near: 'Ring the Gas Bell. Light the gas from a distance.',
    open: 'The vault stands open. Take the golden key.',
    hint: 'A bell of marsh gas. Light it from a distance; the vault answers.',
    teachTitle: 'The Gas Bell',
    teachBody: 'Marsh gas burns all at once, and the bell is hung full of it. One Spark Bolt through the glass porthole lights the lot; the clapper rings, and the vault door opens. Stand on the brass inlay, well back. The Works relent, eventually, if the bell is spoiled.',
    sealed: 'Sealed. The golden key is in the Gas Bell’s vault.',
    placeName: 'Vault door',
    placeDescription: 'Metal all through; blasts and the ray leave it be. It opens when the Gas Bell rings, or when the Works relent.',
  },
  weir: {
    name: 'the Weir',
    near: 'Wire the Weir. Fill the bowl, then spark the brass.',
    open: 'The vault stands open. Take the golden key.',
    hint: 'A dry bowl and a coil in its well. Fill it, then spark the brass.',
    teachTitle: 'The Weir',
    teachBody: 'The coil at the foot of the well drinks only through water, and the bowl is dry. Pull the sluice lever by the dais and the cistern empties into it; then put a Spark Bolt into the brass lining. The wet well carries the charge down to the coil, and the vault door lets go. Do not stand in the bowl when you do. The Works relent, eventually.',
    sealed: 'Sealed. The golden key is in the Weir’s vault.',
    placeName: 'Vault door',
    placeDescription: 'Metal all through. It opens when the coil at the foot of the Weir’s well latches, or when the Works relent.',
  },
  crucible: {
    name: 'the Crucible',
    near: 'Quench the Crucible. Water on the lava, from a distance.',
    open: 'The slag gate stands open. The Kiln is through it.',
    hint: 'A vat of lava and a shut slag gate. Water on the lava; stand well back.',
    teachTitle: 'The Crucible',
    teachBody: 'The slag gate answers to the crucible: when its lava has been cooled to stone, the gate lets go. Water on lava makes a crust and a great deal of steam, and the steam scalds, so pull the sluice lever at the gallery’s far end and keep your distance. A flask poured through the gangway’s hatch serves, and so does frost. The Works relent, in time.',
    sealed: '',
    placeName: 'Slag gate',
    placeDescription: 'Metal all through. It opens when the Crucible’s lava is quenched to stone, or when the Works relent.',
  },
  coldvault: {
    name: 'the Ice Vault',
    near: 'Open the Ice Vault. Melt it, salt it, or blast it.',
    open: 'The vault stands open. Take the golden key.',
    hint: 'A strongroom in a block of ice. Heat, brine or a blast will have it.',
    teachTitle: 'The Ice Vault',
    teachBody: 'The store-keeper kept the key behind a wall of real ice. Light the coal at its foot, open the brine cistern above it, or blast it. The Works relent, in time.',
    sealed: 'Sealed. The golden key is in the Ice Vault.',
    placeName: 'Vault door',
    placeDescription: 'An ice wall and a Metal door. It opens when the ice is gone, or when the Works relent.',
  },
  periscope: {
    name: 'the Periscope',
    near: 'Open the Periscope vault. Shine a beam up the light well.',
    open: 'The vault stands open. Take the golden key.',
    hint: 'A mirror at the head of a light well. Stand on the brass and shine straight up.',
    teachTitle: 'The Periscope',
    teachBody: 'The grinder’s vault is held by a photocell sealed in the attic, and the only way light gets in is up the well, off the silvered mirror at its head and along the tunnel to the lens. Stand on the brass inlay under the well and shine straight up; the lens drinks, the relay counts a moment, and the vault door lets go. The Works relent, in time.',
    sealed: 'Sealed. The golden key is in the Periscope’s vault.',
    placeName: 'Vault door',
    placeDescription: 'Metal all through. It opens when the lens in the attic drinks the light, or when the Works relent.',
  },
};

/** The generic line before the machine has been seen. */
export const LOCK_FAR_OBJECTIVE = 'Find the golden key. The Works keep it under lock.';

/** Within this many cells of a lock's machine the alchemist is "at" it: the objective names the puzzle. */
export const LOCK_NEAR_CELLS = 190;
/** ...and the hint and teach card rise at this range. */
export const LOCK_HINT_CELLS = 120;

/** The floor's lock plug (a route seal tagged with its puzzle), or null. */
export function lockOf(runtime: LevelRuntime | null | undefined): Mechanism | null {
  if (!runtime?.mechanisms) return null; // (a minimal test stub has no list)
  for (const m of runtime.mechanisms) if (m.kind === 'plug' && m.lock) return m;
  return null;
}

/** The machine's working part (the sensor or latch that feeds the relay that breaks the plug): where hints point. */
export function lockFocus(runtime: LevelRuntime, plug: Mechanism): { x: number; y: number } {
  const relay = runtime.mechanisms.find((m) => m.kind === 'relay' && m.targetId === plug.id);
  const trigger = relay ? runtime.mechanisms.find((m) => m.targetId === relay.id && m.kind !== 'relay') : undefined;
  return trigger ? { x: trigger.x, y: trigger.y } : { x: plug.x + plug.w / 2, y: plug.y + plug.h / 2 };
}

/**
 * The objective a lock gives, or null to leave the floor's own: far from the machine the line is the
 * generic one, near it the puzzle is named, and once the seal is open the reward is. A floor whose key
 * is already taken (or whose lock has nothing left to say) says nothing here.
 */
export function lockObjective(runtime: LevelRuntime, player: { x: number; y: number }): string | null {
  const plug = lockOf(runtime);
  if (!plug) return null;
  const copy = LOCK_TEXT[plug.lock!];
  const hasKey = runtime.pickups.some((p) => p.kind === 'key');
  if (hasKey && runtime.keyTaken) return null;
  if (plug.state === 1) return copy.open;
  if (!hasKey && !runtime.def.boss) return null;
  const at = lockFocus(runtime, plug);
  const d = Math.hypot(at.x - player.x, at.y - player.y);
  if (d <= LOCK_NEAR_CELLS) return copy.near;
  return hasKey ? LOCK_FAR_OBJECTIVE : null;
}
