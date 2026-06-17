// ===================== Wave State =====================
// The original wave-survival director (noita-sandbox.html startWave/updateWaves)
// was retired when the 8-level descent replaced wave survival. Only the small
// `waves` kill/counter state survives — it is still poked by Enemies (kill
// tally), Player (death), Levels, and the Inspector. The director CLASS that
// once drove it is gone; nothing calls it in the descent.

import type { WaveState } from '@/core/types';

/**
 * Fresh wave state for a new game.
 *
 * `intermission: 60` is the original boot literal (noita-sandbox.html line
 * 2157); it is never consumed in the descent but kept for parity.
 */
export function createWaveState(): WaveState {
  return { num: 0, active: false, intermission: 60, kills: 0 };
}
