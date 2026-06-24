export interface ProgressionPacingTuning {
  playerStart: number;
  playerDepthStep: number;
  playerMax: number;
  playerBonusMax: number;
  verticalStart: number;
  verticalDepthStep: number;
  verticalMax: number;
  verticalBonusMax: number;
  enemyStart: number;
  enemyDepthStep: number;
  enemyMax: number;
}

export const PROGRESSION_PACING: ProgressionPacingTuning = {
  playerStart: 0.74,
  playerDepthStep: 0.065,
  playerMax: 1,
  playerBonusMax: 1.08,
  verticalStart: 0.84,
  verticalDepthStep: 0.045,
  verticalMax: 1,
  verticalBonusMax: 1.06,
  enemyStart: 0.55,
  enemyDepthStep: 0.09,
  enemyMax: 1,
};

export const PROGRESSION_PACING_DEFAULTS: Readonly<ProgressionPacingTuning> = Object.freeze({ ...PROGRESSION_PACING });
