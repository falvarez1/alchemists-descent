export type CreatureIntent = 'rest' | 'forage' | 'observe' | 'investigate' | 'hunt' | 'retreat' | 'return';

/** Persistent individual knowledge. Coordinates are observations, never a live target pointer. */
export interface CreatureMind {
  id: string;
  phase: number;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  targetVx: number;
  confidence: number;
  visible: boolean;
  lastSeen: number;
  lastHeard: number;
  lastTick: number;
  nextSense: number;
  nextDecision: number;
  commitUntil: number;
  intent: CreatureIntent;
  hunger: number;
  irritation: number;
  lastHp: number;
  facing: number;
}

export interface BodyNode {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  contact: boolean;
}

export interface CreatureBody {
  nodes: BodyNode[];
  spacing: number;
}

export interface PlantedFoot {
  x: number;
  y: number;
  gripX: number;
  gripY: number;
  planted: boolean;
  phase: number;
}

export interface CreatureCue {
  x: number;
  y: number;
  radius: number;
  strength: number;
  tick: number;
  kind: 'sound' | 'vibration' | 'lure';
}
