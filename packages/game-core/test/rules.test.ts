import { describe, expect, it } from 'vitest';
import {
  applyShotClockFoul,
  createGame,
  DEFAULT_SETTINGS,
  resolveShot,
  type GameSnapshot,
  type ShotSimulation,
  type ShotTrace
} from '../src/index.js';

function readyGame(mode: 'eight-ball' | 'nine-ball'): GameSnapshot {
  const game = createGame({ ...DEFAULT_SETTINGS, mode, shotClock: 45 }, 0, 3);
  return { ...game, ballInHand: false, placement: null, breakShot: false };
}

function result(game: GameSnapshot, trace: Partial<ShotTrace>): ShotSimulation {
  const pocketed = trace.pocketed ?? [];
  return {
    balls: game.balls.map((ball) => pocketed.includes(ball.id) ? { ...ball, disposition: 'pocketed' as const } : { ...ball }),
    frames: [],
    trace: {
      firstContact: null,
      firstContactTime: 0,
      pocketed,
      offTable: [],
      railContacts: [],
      anyRailAfterContact: true,
      cueScratch: false,
      contacts: [],
      duration: 1,
      ...trace
    }
  };
}

describe('8-ball rules', () => {
  it('assigns groups after a legal open-table pocket', () => {
    const game = readyGame('eight-ball');
    const next = resolveShot(game, result(game, { firstContact: 3, pocketed: [3] }));
    expect(next.groups).toEqual(['solids', 'stripes']);
    expect(next.tableOpen).toBe(false);
    expect(next.turnIndex).toBe(0);
  });

  it('loses the rack when the 8 is pocketed early', () => {
    const game: GameSnapshot = { ...readyGame('eight-ball'), groups: ['solids', 'stripes'], tableOpen: false };
    const next = resolveShot(game, result(game, { firstContact: 8, pocketed: [8] }));
    expect(next.phase).toBe('rack-over');
    expect(next.winnerIndex).toBe(1);
    expect(next.scores).toEqual([0, 1]);
  });

  it('grants ball in hand after a scratch', () => {
    const game = readyGame('eight-ball');
    const next = resolveShot(game, result(game, { firstContact: 2, pocketed: [0], cueScratch: true }));
    expect(next.turnIndex).toBe(1);
    expect(next.ballInHand).toBe(true);
    expect(next.placement).toBe('anywhere');
  });

  it('preserves the order in which object balls were pocketed', () => {
    const game = readyGame('eight-ball');
    const first = resolveShot(game, result(game, { firstContact: 3, pocketed: [3, 10] }));
    const second = resolveShot(first, result(first, { firstContact: 5, pocketed: [5] }));
    expect(second.pocketedOrder).toEqual([3, 10, 5]);
  });
});

describe('9-ball rules', () => {
  it('allows a legal combination on the 9', () => {
    const game = readyGame('nine-ball');
    const next = resolveShot(game, result(game, { firstContact: 1, pocketed: [9] }));
    expect(next.phase).toBe('rack-over');
    expect(next.winnerIndex).toBe(0);
    expect(next.scores).toEqual([1, 0]);
  });

  it('respots the 9 and changes turn when it drops on a foul', () => {
    const game = readyGame('nine-ball');
    const next = resolveShot(game, result(game, { firstContact: 2, pocketed: [9] }));
    expect(next.balls.find((ball) => ball.id === 9)?.disposition).toBe('on-table');
    expect(next.turnIndex).toBe(1);
    expect(next.ballInHand).toBe(true);
    expect(next.pocketedOrder).not.toContain(9);
  });

  it('turns a shot-clock expiry into ball in hand', () => {
    const game = readyGame('nine-ball');
    const next = applyShotClockFoul(game);
    expect(next.turnIndex).toBe(1);
    expect(next.ballInHand).toBe(true);
    expect(next.lastEvents[0]?.code).toBe('shot-clock-foul');
  });
});
