import {
  DEFAULT_TRAJECTORY_AIDS,
  HOST_RESTRICTABLE_TRAJECTORY_AIDS,
  TRAJECTORY_AIDS,
  trajectoryAidsFromLegacyLevel,
  type AimGuideLevel,
  type ContactEvent,
  type HostTrajectoryAidFlags,
  type ImpactDepth,
  type ReboundDepth,
  type TrajectoryAid,
  type TrajectoryAidFlags,
  type TrajectoryPoint,
  type TrajectoryPreview
} from '@breakroom/game-core';

const STORAGE_KEY = 'breakroom:trajectory-aids';
const LEGACY_STORAGE_KEY = 'breakroom:guide';
const STORAGE_VERSION_KEY = 'breakroom:trajectory-aids-version';
const STORAGE_VERSION = '6';
const DEPTH_STORAGE_KEY = 'breakroom:trajectory-depth';

export interface TrajectoryDepthSettings { rebounds: ReboundDepth; impacts: ImpactDepth }

export function loadTrajectoryDepth(): TrajectoryDepthSettings {
  try {
    const value = JSON.parse(localStorage.getItem(DEPTH_STORAGE_KEY) ?? '{}') as Partial<TrajectoryDepthSettings>;
    const rebounds = [0, 1, 2, 3, 4].includes(value.rebounds as number) ? value.rebounds as ReboundDepth : 1;
    const impacts = [1, 2, 3, 4, 5].includes(value.impacts as number) ? value.impacts as ImpactDepth : 3;
    return { rebounds, impacts };
  } catch { return { rebounds: 1, impacts: 3 }; }
}

export function saveTrajectoryDepth(value: TrajectoryDepthSettings): void {
  try { localStorage.setItem(DEPTH_STORAGE_KEY, JSON.stringify(value)); } catch { /* optional preference */ }
}

interface VersionFiveTrajectoryAidFlags {
  advancedCuePath: boolean;
  simpleObjectPath: boolean;
  advancedObjectPath: boolean;
  railContinuations: boolean;
  jumpArc: boolean;
}

interface VersionFourTrajectoryAidFlags {
  simpleCuePath: boolean;
  advancedCuePath: boolean;
  simpleObjectPath: boolean;
  advancedObjectPath: boolean;
  railContinuations: boolean;
  jumpArc: boolean;
}

interface LegacyTrajectoryAidFlags {
  cuePath: boolean;
  objectPath: boolean;
  railContinuations: boolean;
  jumpArc: boolean;
}

const LEGACY_TRAJECTORY_AIDS = ['cuePath', 'objectPath', 'railContinuations', 'jumpArc'] as const;
const VERSION_FOUR_TRAJECTORY_AIDS = ['simpleCuePath', 'advancedCuePath', 'simpleObjectPath', 'advancedObjectPath', 'railContinuations', 'jumpArc'] as const;
const VERSION_FIVE_TRAJECTORY_AIDS = ['advancedCuePath', 'simpleObjectPath', 'advancedObjectPath', 'railContinuations', 'jumpArc'] as const;

function isFlags(value: unknown): value is TrajectoryAidFlags {
  return value !== null && typeof value === 'object'
    && !('simpleCuePath' in value)
    && TRAJECTORY_AIDS.every((aid) => typeof (value as Record<TrajectoryAid, unknown>)[aid] === 'boolean');
}

function isLegacyFlags(value: unknown): value is LegacyTrajectoryAidFlags {
  return value !== null && typeof value === 'object'
    && LEGACY_TRAJECTORY_AIDS.every((aid) => typeof (value as Record<string, unknown>)[aid] === 'boolean');
}

function isVersionFourFlags(value: unknown): value is VersionFourTrajectoryAidFlags {
  return value !== null && typeof value === 'object'
    && VERSION_FOUR_TRAJECTORY_AIDS.every((aid) => typeof (value as Record<string, unknown>)[aid] === 'boolean');
}

function isVersionFiveFlags(value: unknown): value is VersionFiveTrajectoryAidFlags {
  return value !== null && typeof value === 'object'
    && !('simpleCuePath' in value)
    && !('pottedPocket' in value)
    && VERSION_FIVE_TRAJECTORY_AIDS.every((aid) => typeof (value as Record<string, unknown>)[aid] === 'boolean');
}

export function exclusiveTrajectoryAids(value: TrajectoryAidFlags): TrajectoryAidFlags {
  if (!value.simpleObjectPath || !value.advancedObjectPath) return value;
  return { ...value, simpleObjectPath: false };
}

function migrateVersionFourFlags(value: VersionFourTrajectoryAidFlags): TrajectoryAidFlags {
  return exclusiveTrajectoryAids({
    advancedCuePath: value.advancedCuePath || value.simpleCuePath,
    simpleObjectPath: value.simpleObjectPath,
    advancedObjectPath: value.advancedObjectPath,
    pottedPocket: false,
    railContinuations: value.railContinuations,
    jumpArc: value.jumpArc
  });
}

function migrateVersionFiveFlags(value: VersionFiveTrajectoryAidFlags): TrajectoryAidFlags {
  return exclusiveTrajectoryAids({ ...value, pottedPocket: false });
}

function migrateLegacyFlags(value: LegacyTrajectoryAidFlags): TrajectoryAidFlags {
  return {
    advancedCuePath: value.cuePath,
    simpleObjectPath: false,
    advancedObjectPath: value.objectPath,
    pottedPocket: false,
    railContinuations: value.railContinuations,
    jumpArc: value.jumpArc
  };
}

export function trajectoryAidsFromStorageValues(
  stored: string | null,
  legacyStored: string | null,
  storedVersion: string | null
): TrajectoryAidFlags {
  try {
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isFlags(parsed)) {
        const normalized = Object.fromEntries(
          TRAJECTORY_AIDS.map((aid) => [aid, parsed[aid]])
        ) as TrajectoryAidFlags;
        // Preserve an intentional all-off choice in the current schema while
        // repairing malformed/unversioned preferences.
        const allOff = TRAJECTORY_AIDS.every((aid) => !parsed[aid]);
        if (storedVersion === STORAGE_VERSION || !allOff) return exclusiveTrajectoryAids(normalized);
      }
      if (isVersionFiveFlags(parsed)) {
        const allOff = VERSION_FIVE_TRAJECTORY_AIDS.every((aid) => !parsed[aid]);
        if (!allOff || storedVersion === '5') return migrateVersionFiveFlags(parsed);
      }
      if (isVersionFourFlags(parsed)) {
        const allOff = VERSION_FOUR_TRAJECTORY_AIDS.every((aid) => !parsed[aid]);
        if (!allOff || storedVersion === '4') return migrateVersionFourFlags(parsed);
      }
      if (isLegacyFlags(parsed)) {
        const allOff = LEGACY_TRAJECTORY_AIDS.every((aid) => !parsed[aid]);
        if (!allOff || storedVersion === '3') return migrateLegacyFlags(parsed);
      }
    }
  } catch {
    // Ignore malformed or unavailable storage and use the legacy/default path.
  }
  const legacy = legacyStored === null ? Number.NaN : Number(legacyStored);
  return Number.isInteger(legacy) && legacy >= 0 && legacy <= 4
    ? trajectoryAidsFromLegacyLevel(legacy as AimGuideLevel)
    : { ...DEFAULT_TRAJECTORY_AIDS };
}

export function loadTrajectoryAids(): TrajectoryAidFlags {
  const flags = trajectoryAidsFromStorageValues(
    localStorage.getItem(STORAGE_KEY),
    localStorage.getItem(LEGACY_STORAGE_KEY),
    localStorage.getItem(STORAGE_VERSION_KEY)
  );
  saveTrajectoryAids(flags);
  return flags;
}

export function saveTrajectoryAids(flags: TrajectoryAidFlags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
    localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
  } catch { /* preference storage is optional */ }
}

export function effectiveTrajectoryAids(
  preferred: TrajectoryAidFlags,
  allowed: HostTrajectoryAidFlags
): TrajectoryAidFlags {
  return exclusiveTrajectoryAids({
    ...Object.fromEntries(HOST_RESTRICTABLE_TRAJECTORY_AIDS.map((aid) => [aid, preferred[aid] && allowed[aid]])),
    pottedPocket: preferred.pottedPocket,
    jumpArc: preferred.jumpArc
  } as TrajectoryAidFlags);
}

export function hasVisibleTrajectoryAid(flags: TrajectoryAidFlags): boolean {
  return flags.advancedCuePath || flags.simpleObjectPath || flags.advancedObjectPath || flags.pottedPocket || flags.jumpArc;
}

export function predictedPottedPockets(preview: TrajectoryPreview): ContactEvent[] {
  return preview.contacts.filter((contact) => contact.kind === 'pocket'
    && contact.ballIds.some((ballId) => ballId > 0)).sort((a, b) => a.time - b.time);
}

export function simpleTrajectoryVector(
  preview: TrajectoryPreview,
  path: TrajectoryPoint[],
  ballId: number,
  maxLength = 0.20
): TrajectoryPoint[] {
  const start = path[0];
  if (!start) return [];
  const directionPoint = path.find((point) => point.time > start.time + 0.00001
    && Math.hypot(point.x - start.x, point.y - start.y) > 0.002);
  if (!directionPoint) return [];
  const dx = directionPoint.x - start.x;
  const dy = directionPoint.y - start.y;
  const distance = Math.hypot(dx, dy);
  const initialSpeed = distance / (directionPoint.time - start.time);
  let length = Math.min(maxLength, 0.075 + Math.min(1, initialSpeed / 4.8) * 0.165);
  const nextContact = preview.contacts.find((contact) => contact.kind !== 'cloth'
    && contact.time > start.time + 0.00001
    && contact.ballIds.includes(ballId));
  if (nextContact) {
    const target = ballId === 0 && nextContact.kind === 'ball-ball' && preview.ghostBall
      ? preview.ghostBall
      : nextContact.point;
    const projected = (target.x - start.x) * dx / distance + (target.y - start.y) * dy / distance;
    if (projected > 0) length = Math.min(length, projected);
  }
  return [start, {
    x: start.x + dx / distance * length,
    y: start.y + dy / distance * length,
    z: start.z,
    time: start.time,
    airborne: start.airborne
  }];
}

export function simplePostContactVector(
  preview: TrajectoryPreview,
  path: TrajectoryPoint[],
  ballId: number
): TrajectoryPoint[] {
  const firstContact = preview.contacts.find((contact) => contact.kind === 'ball-ball'
    && contact.ballIds.includes(0)
    && (ballId === 0 || contact.ballIds.includes(ballId)));
  if (!firstContact) return [];

  const atContact = path.filter((point) => Math.abs(point.time - firstContact.time) <= 0.00001);
  const target = ballId === 0 && preview.ghostBall ? preview.ghostBall : firstContact.point;
  const start = [...atContact].sort((a, b) => (
    Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y)
  ))[0] ?? path.find((point) => point.time >= firstContact.time);
  if (!start) return [];

  const after = path.filter((point) => point.time > firstContact.time + 0.00001);
  return simpleTrajectoryVector(preview, [start, ...after], ballId);
}

export function clipTrajectoryAtFirstRail(
  preview: TrajectoryPreview,
  path: TrajectoryPoint[],
  ballId: number,
  showContinuations: boolean
): TrajectoryPoint[] {
  if (showContinuations) return path;
  const firstRail = preview.contacts.find((contact) =>
    (contact.kind === 'cushion' || contact.kind === 'jaw') && contact.ballIds.includes(ballId));
  return firstRail ? path.filter((point) => point.time <= firstRail.time + 0.00001) : path;
}
