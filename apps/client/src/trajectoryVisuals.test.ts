import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, type ContactEvent, type TrajectoryPoint } from '@breakroom/game-core';
import {
  buildTrajectoryVisualGeometry,
  trajectoryContrastUnderlay,
  trajectoryObjectColor
} from './trajectoryVisuals.js';

function point(x: number, time: number, z = BALL_RADIUS, airborne = false): TrajectoryPoint {
  return { x, y: 0.5, z, time, airborne };
}

describe('trajectory visual geometry', () => {
  it('preserves exact rail events and starts the next visual leg at the same boundary vertex', () => {
    const path = [point(0.2, 0), point(0.4, 0.1), point(0.6, 0.2), point(0.48, 0.3)];
    const rail: ContactEvent = {
      kind: 'cushion', time: 0.2, impactSpeed: 2,
      point: { x: 0.6, y: 0.5, z: BALL_RADIUS }, ballIds: [0], normal: { x: -1, y: 0, z: 0 }
    };
    const geometry = buildTrajectoryVisualGeometry(path, [rail], 0, 500);
    expect(geometry.points).toContain(path[2]);
    expect(geometry.segments.find((segment) => segment.to === path[2])?.legIndex).toBe(0);
    expect(geometry.segments.find((segment) => segment.from === path[2])?.legIndex).toBe(1);
    expect(geometry.markers[0]).toMatchObject({ kind: 'cushion', point: rail.point });
  });

  it('keeps width inputs finite for duplicate timestamps and stationary samples', () => {
    const geometry = buildTrajectoryVisualGeometry([
      point(0.2, 0), point(0.2, 0), point(0.3, 0.1)
    ], [], 0, 400);
    expect(geometry.segments.every((segment) => Number.isFinite(segment.speedFactor))).toBe(true);
    expect(geometry.segments.every((segment) => segment.speedFactor >= 0 && segment.speedFactor <= 1)).toBe(true);
  });

  it('identifies the airborne apex and first landing without adding forecast data', () => {
    const path = [
      point(0.2, 0),
      point(0.35, 0.1, BALL_RADIUS * 2, true),
      point(0.5, 0.2, BALL_RADIUS * 3.2, true),
      point(0.7, 0.3, BALL_RADIUS, false)
    ];
    const geometry = buildTrajectoryVisualGeometry(path, [], 0, 500);
    expect(geometry.markers.find((marker) => marker.kind === 'apex')?.time).toBe(0.2);
    expect(geometry.markers.find((marker) => marker.kind === 'landing')?.time).toBe(0.3);
    expect(geometry.segments.some((segment) => segment.heightFactor > 0)).toBe(true);
  });

  it('keeps object paths ball-colored and provides contrast for contact markers', () => {
    expect(trajectoryObjectColor(2)).toBe('#2474d2');
    expect(trajectoryObjectColor(8)).toBe('#161719');
    expect(trajectoryContrastUnderlay(trajectoryObjectColor(8))).toContain('244,248,240');
    expect(trajectoryContrastUnderlay(trajectoryObjectColor(1))).toContain('2,10,7');
  });
});
