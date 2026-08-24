import type { AimGuideLevel, ClothSpeed, HostTrajectoryAid, HostTrajectoryAidFlags, RoomSettings, TrajectoryAid, TrajectoryAidFlags } from './types.js';

export const TABLE_WIDTH = 2.54;
export const TABLE_HEIGHT = 1.27;
export const BALL_RADIUS = 0.028575;
export const BALL_DIAMETER = BALL_RADIUS * 2;
export const FIXED_STEP = 1 / 240;
export const FRAME_STEP = 1 / 30;
export const MAX_SHOT_TIME = 45;
export const STOP_SPEED = 0.009;
export const GRAVITY = 9.81;
export const CUSHION_TOP_HEIGHT = 0.072;

export interface ClothProfile {
  slidingFriction: number;
  rollingResistance: number;
  spinDecay: number;
}

export const CLOTH_PROFILES: Record<ClothSpeed, ClothProfile> = {
  'very-slow': { slidingFriction: 0.24, rollingResistance: 0.020, spinDecay: 0.90 },
  slow: { slidingFriction: 0.22, rollingResistance: 0.017, spinDecay: 0.81 },
  standard: { slidingFriction: 0.20, rollingResistance: 0.014, spinDecay: 0.72 },
  fast: { slidingFriction: 0.18, rollingResistance: 0.011, spinDecay: 0.63 },
  'very-fast': { slidingFriction: 0.16, rollingResistance: 0.009, spinDecay: 0.56 }
};

export const BALL_COLORS: Record<number, string> = {
  0: '#f5f1df', 1: '#f4c430', 2: '#2474d2', 3: '#d43b35', 4: '#7445a8',
  5: '#e67922', 6: '#238158', 7: '#7b2734', 8: '#161719', 9: '#f4c430',
  10: '#2474d2', 11: '#d43b35', 12: '#7445a8', 13: '#e67922', 14: '#238158', 15: '#7b2734'
};

export const TRAJECTORY_AIDS: TrajectoryAid[] = ['advancedCuePath', 'simpleObjectPath', 'advancedObjectPath', 'pottedPocket', 'railContinuations', 'jumpArc'];
export const HOST_RESTRICTABLE_TRAJECTORY_AIDS: HostTrajectoryAid[] = ['advancedCuePath', 'simpleObjectPath', 'advancedObjectPath', 'railContinuations'];

export const DEFAULT_TRAJECTORY_AIDS: TrajectoryAidFlags = {
  advancedCuePath: false,
  simpleObjectPath: true,
  advancedObjectPath: false,
  pottedPocket: false,
  railContinuations: false,
  jumpArc: true
};

export const ALL_HOST_TRAJECTORY_AIDS: HostTrajectoryAidFlags = {
  advancedCuePath: true,
  simpleObjectPath: true,
  advancedObjectPath: true,
  railContinuations: true
};

export function trajectoryAidsFromLegacyLevel(level: AimGuideLevel): TrajectoryAidFlags {
  return {
    advancedCuePath: level >= 1,
    simpleObjectPath: false,
    advancedObjectPath: level >= 3,
    pottedPocket: false,
    railContinuations: level >= 4,
    jumpArc: true
  };
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'eight-ball',
  competition: 'casual',
  ruleset: 'house',
  houseCallMode: 'eight-only',
  opponent: 'human',
  cpuDifficulty: 'club',
  visibility: 'private',
  allowedTrajectoryAids: { ...ALL_HOST_TRAJECTORY_AIDS },
  shotClock: 0,
  clothSpeed: 'standard',
  tableDesign: 'classic-walnut',
  clothDesign: 'emerald-solid',
  customClothColor: '#0c624a',
  allowElevatedShots: true,
  chatEnabled: true,
  chatFilterEnabled: true
};
