/**
 * Spoken lines that are registered (content/story: storyVoiceLines) but have not been RECORDED yet: the
 * voice generator is paid and runs once, at the end of a wave, by the integrator. Until then the line
 * plays silently with its caption. tests/story.test.ts lets exactly these texts lack a clip, and fails
 * if one of them already has one and is left on this list: delete the text here when its take lands.
 */
export const PENDING_VOICE_RECORDING: readonly string[] = [
  // The experiment (floor 1's Refuge Kettle, content/story/docent: DOCENT_ASIDES.kettle).
  'A kettle, lit before you arrived. Pour in what you find, keep the fire under it, and read the book to see how close you came. Pell would call it tea. Pell calls most things tea.',
];
