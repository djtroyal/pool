import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  DEFAULT_SETTINGS,
  createGame,
  optimizePracticeShot,
  practiceStateFingerprint,
  resolveShot,
  simulateShot,
  type BallState,
  type GameSnapshot
} from '../src/index.js';

function ball(id: number, x: number, y: number): BallState {
  return {
    id, x, y, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 }, disposition: 'on-table'
  };
}

function layout(balls: BallState[]): GameSnapshot {
  return {
    ...createGame(DEFAULT_SETTINGS, 0, 41),
    balls,
    groups: ['solids', 'stripes'],
    tableOpen: false,
    breakShot: false,
    ballInHand: false,
    placement: null
  };
}

describe('practice shot optimizer', () => {
  it('finds a deterministic own-group pot and a concrete follow-up', () => {
    const game = layout([
      ball(0, 0.8, 0.65), ball(1, 2.15, 0.18), ball(2, 1.5, 0.9), ball(9, 2, 0.95)
    ]);
    const request = { game, config: { clothSpeed: 'standard' as const }, quality: 'fast' as const, sandbox: true };
    const first = optimizePracticeShot(request);
    const second = optimizePracticeShot(request);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.target).toBe('solids');
    expect(first?.primary.ownedPots).toContain(1);
    expect(first?.followUp?.ownedPots).toContain(2);
    expect(first?.primary.shot.power).toBeGreaterThanOrEqual(0.04);
    expect(first!.primary.shot.power * 100).toBe(Math.round(first!.primary.shot.power * 100));
    expect(Math.hypot(first!.primary.shot.english.side, first!.primary.shot.english.vertical)).toBeLessThanOrEqual(1.001);

    const simulation = simulateShot(game.balls, first!.primary.shot, request.config);
    const after = resolveShot(game, simulation, first!.primary.shot);
    const normalized = { ...after, phase: 'aiming' as const, turnIndex: 0 as const, winnerIndex: null, scores: [0, 0] as [number, number], shotClockEndsAt: null };
    expect(practiceStateFingerprint(normalized)).toBe(first?.primary.afterFingerprint);
  }, 15_000);

  it('uses rotation targets in nine-ball and keeps controls in supported ranges', () => {
    const game = {
      ...layout([ball(0, 0.7, 0.63), ball(1, 2.12, 0.17), ball(2, 1.6, 0.95), ball(9, 2.1, 1.02)]),
      mode: 'nine-ball' as const,
      groups: [null, null] as [null, null],
      tableOpen: false
    };
    const result = optimizePracticeShot({ game, config: { clothSpeed: 'fast' }, quality: 'fast', sandbox: true });
    expect(result?.target).toBe('rotation');
    expect(result?.primary.shot.elevation).toBeGreaterThanOrEqual(0);
    expect(result?.primary.shot.elevation).toBeLessThanOrEqual(75);
    expect(result?.primary.shot.angle).toBeGreaterThanOrEqual(-Math.PI);
    expect(result?.primary.shot.angle).toBeLessThan(Math.PI);
  }, 15_000);
});
