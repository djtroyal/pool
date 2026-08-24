import { describe, expect, it } from 'vitest';
import { createPracticeChallenge, evaluatePracticeChallenge, practiceChallengeDefinition } from '../src/index.js';

describe('server-verifiable practice challenges', () => {
  it('builds deterministic challenge layouts', () => {
    const first = createPracticeChallenge('stop-line');
    const second = createPracticeChallenge('stop-line');
    expect(second.balls).toEqual(first.balls);
    expect(first.ballInHand).toBe(false);
    expect(practiceChallengeDefinition('stop-line').medalScores).toHaveLength(3);
  });

  it('scores the same shot deterministically and returns a finished playback state', () => {
    const game = createPracticeChallenge('break-lab');
    const shot = { revision: game.revision, angle: 0, power: 0.9, elevation: 0, english: { side: 0, vertical: 0 } };
    const first = evaluatePracticeChallenge('break-lab', game, shot);
    const second = evaluatePracticeChallenge('break-lab', game, shot);
    expect(second.score).toBe(first.score);
    expect(second.simulation.trace).toEqual(first.simulation.trace);
    expect(first.finalSnapshot.shotNumber).toBe(1);
    expect(first.score).toBeGreaterThan(0);
  });
});
