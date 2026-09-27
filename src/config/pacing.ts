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
  // Breathing Works spine (4 floors): creatures start at 0.85x on floor 1 and
  // reach full speed by floor 3 (0.85 / 0.925 / 1.0 / 1.0). The old 0.55x start
  // (+0.09/depth, full speed only by D6) read as sleepy foes on an 8-floor spine.
  enemyStart: 0.85,
  enemyDepthStep: 0.075,
  enemyMax: 1,
};

export const PROGRESSION_PACING_DEFAULTS: Readonly<ProgressionPacingTuning> = Object.freeze({ ...PROGRESSION_PACING });
