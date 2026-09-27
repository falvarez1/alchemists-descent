/** Types for the generation table (sfx-prompts.mjs), so the dev audition page can show prompts. */
export interface SfxPrompt {
  /** Prompt text sent to the sound-effects model. */
  p: string;
  /** Requested duration, seconds. */
  d: number;
  /** Takes kept. */
  t?: number;
  /** prompt_influence. */
  i?: number;
  soft?: boolean;
  max?: number;
  stereo?: boolean;
}
export declare const SFX_PROMPTS: Readonly<Record<string, SfxPrompt>>;
