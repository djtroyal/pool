import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  analyzeShotPerformance,
  createGame,
  resolveShot,
  simulateShot
} from '../src/index.js';

function scoreBreak(angle: number, power: number) {
  const before = { ...createGame(DEFAULT_SETTINGS, 0, 44), ballInHand: false, placement: null };
  const shot = { revision: before.revision, angle, power, elevation: 0, english: { side: 0, vertical: 0 } };
  const simulation = simulateShot(before.balls, shot);
  const after = resolveShot(before, simulation);
  return analyzeShotPerformance({ before, after, simulation, shot, shooterIndex: 0, streakBefore: 0, opponentShotCount: 0 });
}

describe('authoritative shot performance scoring', () => {
  it('scores a legal full-power rack break from simulated contacts', () => {
    const result = scoreBreak(0, 1);
    expect(result.components.map((entry) => entry.code)).toContain('legal-break');
    expect(result.components.map((entry) => entry.code)).toContain('break-spread');
    expect(result.delta).toBeGreaterThan(0);
  });

  it('penalizes an opening shot played away from the rack', () => {
    const result = scoreBreak(Math.PI, 0.2);
    expect(result.components.map((entry) => entry.code)).toContain('illegal-break');
    expect(result.components.map((entry) => entry.code)).toContain('foul');
    expect(result.delta).toBeLessThan(0);
  });
});
