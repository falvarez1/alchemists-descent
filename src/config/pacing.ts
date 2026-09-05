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
  playerStart: 1,
  playerDepthStep: 0,
  playerMax: 1,
  playerBonusMax: 1.08,
  verticalStart: 1,
  verticalDepthStep: 0,
  verticalMax: 1,
  verticalBonusMax: 1.06,
  enemyStart: 0.55,
  enemyDepthStep: 0.09,
  enemyMax: 1,
};

export const PROGRESSION_PACING_DEFAULTS: Readonly<ProgressionPacingTuning> = Object.freeze({ ...PROGRESSION_PACING });
