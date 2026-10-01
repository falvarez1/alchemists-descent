/**
 * Spoken lines that are registered (content/story: storyVoiceLines) but have not been RECORDED yet: the
 * voice generator is paid and runs once, at the end of a wave, by the integrator. Until then the line
 * plays silently with its caption. tests/story.test.ts lets exactly these texts lack a clip, and fails
 * if one of them already has one and is left on this list: delete the text here when its take lands.
 */
export const PENDING_VOICE_RECORDING: readonly string[] = [
  // The experiment (floor 1's Refuge Kettle, content/story/docent: DOCENT_ASIDES.kettle).
  'A kettle, already lit. Pour in what you find; the book will say how close you came. Pell would call it tea. Pell calls most things tea.',
  // The locks (each floor's key vault, content/story/docent: DOCENT_ASIDES.lockGasBell / lockWeir / lockCrucible / lockRelent).
  'A bell hung full of marsh gas. The Guild called it a lock; I call it a fuse with a good address. Light it from a long way off.',
  'The Weir. Water carries a current, apprentice, which the Guild’s engineers called a convenience. Open the sluice, then stand on something dry.',
  'The Crucible, kept at heat for the gate’s sake. Quench it, and from a distance: the steam has never once been introduced.',
  'The Works relent. They do, you know, if you wait. It is their one concession to visitors.',
];
