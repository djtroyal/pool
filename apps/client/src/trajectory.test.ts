import { describe, expect, it } from 'vitest';
import { ALL_HOST_TRAJECTORY_AIDS, DEFAULT_TRAJECTORY_AIDS, type TrajectoryAidFlags, type TrajectoryPreview } from '@breakroom/game-core';
import { clipTrajectoryAtFirstRail, effectiveTrajectoryAids, exclusiveTrajectoryAids, predictedPottedPockets, simplePostContactVector, simpleTrajectoryVector, trajectoryAidsFromStorageValues } from './trajectory.js';

const enabled: TrajectoryAidFlags = {
  advancedCuePath: true, simpleObjectPath: false,
  advancedObjectPath: true, pottedPocket: true, railContinuations: true, jumpArc: true
};

describe('trajectory aid selection', () => {
  it('defaults to the simple object path and always-available jump aid when no preference exists', () => {
    expect(trajectoryAidsFromStorageValues(null, null, null)).toEqual(DEFAULT_TRAJECTORY_AIDS);
  });

  it('repairs the unversioned all-off migration bug without overriding an intentional setting', () => {
    const allOff = JSON.stringify(Object.fromEntries(Object.keys(enabled).map((aid) => [aid, false])));
    expect(trajectoryAidsFromStorageValues(allOff, null, null)).toEqual(DEFAULT_TRAJECTORY_AIDS);
    expect(trajectoryAidsFromStorageValues(allOff, null, '6')).toEqual(JSON.parse(allOff));
    expect(trajectoryAidsFromStorageValues(null, '0', null)).toEqual({ ...JSON.parse(allOff), jumpArc: true });
  });

  it('migrates the former cue and object paths to their advanced equivalents', () => {
    expect(trajectoryAidsFromStorageValues(JSON.stringify({
      cuePath: true, objectPath: false, railContinuations: true, jumpArc: true
    }), null, '3')).toEqual({
      advancedCuePath: true, simpleObjectPath: false,
      advancedObjectPath: false, pottedPocket: false, railContinuations: true, jumpArc: true
    });
  });

  it('maps the removed simple cue path to the advanced cue path', () => {
    expect(trajectoryAidsFromStorageValues(JSON.stringify({
      simpleCuePath: true, advancedCuePath: false, simpleObjectPath: true,
      advancedObjectPath: false, railContinuations: false, jumpArc: true
    }), null, '4')).toEqual({
      advancedCuePath: true, simpleObjectPath: true,
      advancedObjectPath: false, pottedPocket: false, railContinuations: false, jumpArc: true
    });
  });

  it('normalizes mutually exclusive simple and advanced object paths', () => {
    expect(exclusiveTrajectoryAids({ ...enabled, simpleObjectPath: true }).simpleObjectPath).toBe(false);
  });

  it('intersects player choices with the host allowlist independently', () => {
    const effective = effectiveTrajectoryAids(enabled, { ...ALL_HOST_TRAJECTORY_AIDS, advancedObjectPath: false });
    expect(effective).toEqual({ ...enabled, advancedObjectPath: false, jumpArc: true });
  });

  it('migrates version-five preferences without enabling the new pocket aid', () => {
    expect(trajectoryAidsFromStorageValues(JSON.stringify({
      advancedCuePath: true, simpleObjectPath: false, advancedObjectPath: false,
      railContinuations: true, jumpArc: true
    }), null, '5')).toEqual({
      advancedCuePath: true, simpleObjectPath: false, advancedObjectPath: false,
      pottedPocket: false, railContinuations: true, jumpArc: true
    });
  });

  it('identifies every object-ball destination pocket in contact order', () => {
    const preview: TrajectoryPreview = {
      cuePath: [], objectPath: [], objectPaths: [{ ballId: 4, parentBallId: 0, generation: 1, activatedAt: 0, points: [] }], impacts: [], contactPoint: null, ghostBall: null, objectBallId: 4,
      contacts: [
        { kind: 'pocket', time: 1, impactSpeed: 1, point: { x: 0, y: 0, z: 0 }, ballIds: [0], surfaceId: 'top-left' },
        { kind: 'pocket', time: 1.5, impactSpeed: 1, point: { x: 0, y: 1.27, z: 0 }, ballIds: [7], surfaceId: 'bottom-left' },
        { kind: 'pocket', time: 1.2, impactSpeed: 1, point: { x: 2.54, y: 0, z: 0 }, ballIds: [4], surfaceId: 'top-right' }
      ]
    };
    expect(predictedPottedPockets(preview).map((contact) => contact.surfaceId)).toEqual(['top-right', 'bottom-left']);
  });

  it('clips at the exact first rail event unless continuations are enabled', () => {
    const path = [0, 0.5, 1, 1.5].map((time) => ({ x: time, y: 0, z: 0, time, airborne: false }));
    const preview: TrajectoryPreview = {
      cuePath: path, objectPath: [], objectPaths: [], impacts: [], contactPoint: null, ghostBall: null, objectBallId: null,
      contacts: [{ kind: 'cushion', time: 1, impactSpeed: 2, point: { x: 1, y: 0, z: 0 }, ballIds: [0] }]
    };
    expect(clipTrajectoryAtFirstRail(preview, path, 0, false).map((point) => point.time)).toEqual([0, 0.5, 1]);
    expect(clipTrajectoryAtFirstRail(preview, path, 0, true)).toBe(path);
  });

  it('scales the short straight vector with initial object-ball velocity', () => {
    const slowPath = [0, 0.02, 0.04].map((x, index) => ({ x, y: 0, z: 0, time: index * 0.1, airborne: false }));
    const fastPath = [0, 0.2, 0.4].map((x, index) => ({ x, y: 0, z: 0, time: index * 0.1, airborne: false }));
    const preview: TrajectoryPreview = {
      cuePath: [], objectPath: fastPath, objectPaths: [], impacts: [], contactPoint: null, ghostBall: null, objectBallId: 1, contacts: []
    };
    const slow = simpleTrajectoryVector(preview, slowPath, 1);
    const fast = simpleTrajectoryVector(preview, fastPath, 1);
    expect(slow[0]).toBe(slowPath[0]);
    expect(fast[1]!.x).toBeGreaterThan(slow[1]!.x);
    expect(fast[1]!.x).toBeLessThanOrEqual(0.20);
  });

  it('starts the simple cue vector after contact rather than drawing the incoming path', () => {
    const incoming = { x: 0.4, y: 0.6, z: 0.028, time: 0, airborne: false };
    const impact = { x: 1.14, y: 0.6, z: 0.028, time: 0.4, airborne: false };
    const outgoing = { x: 1.12, y: 0.68, z: 0.028, time: 0.5, airborne: false };
    const preview: TrajectoryPreview = {
      cuePath: [incoming, impact, outgoing], objectPath: [], objectPaths: [], impacts: [], contactPoint: { x: 1.2, y: 0.6 }, ghostBall: { x: 1.14, y: 0.6 }, objectBallId: 3,
      contacts: [{ kind: 'ball-ball', time: 0.4, impactSpeed: 2, point: { x: 1.2, y: 0.6, z: 0.028 }, ballIds: [0, 3] }]
    };
    const vector = simplePostContactVector(preview, preview.cuePath, 0);
    expect(vector[0]).toBe(impact);
    expect(vector[0]).not.toBe(incoming);
    expect(vector[1]!.y).toBeGreaterThan(impact.y);
  });
});
