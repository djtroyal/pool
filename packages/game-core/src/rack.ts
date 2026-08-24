import { BALL_DIAMETER, BALL_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import type { BallState, GameMode, GameSnapshot, RoomSettings } from './types.js';

const FOOT_X = TABLE_WIDTH * 0.75;
const CENTER_Y = TABLE_HEIGHT / 2;
const GAP = 0.00075;

function makeBall(id: number, x: number, y: number): BallState {
  return {
    id, x, y, z: BALL_RADIUS,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    disposition: 'on-table'
  };
}

function seededShuffle(values: number[], seed: number): number[] {
  const result = [...values];
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function rackEightBall(seed: number): BallState[] {
  const positions: Array<{ row: number; col: number; x: number; y: number }> = [];
  const rowStep = (BALL_DIAMETER + GAP) * Math.sqrt(3) / 2;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      positions.push({
        row,
        col,
        x: FOOT_X + row * rowStep,
        y: CENTER_Y + (col - row / 2) * (BALL_DIAMETER + GAP)
      });
    }
  }

  const assignment = new Map<string, number>();
  assignment.set('2:1', 8);
  const solidCorner = seed % 2 === 0;
  const solidCornerId = seededShuffle([1, 2, 3, 4, 5, 6, 7], seed ^ 0x51a7)[0]!;
  const stripeCornerId = seededShuffle([9, 10, 11, 12, 13, 14, 15], seed ^ 0x9e37)[0]!;
  assignment.set('4:0', solidCorner ? solidCornerId : stripeCornerId);
  assignment.set('4:4', solidCorner ? stripeCornerId : solidCornerId);
  const used = new Set(assignment.values());
  const remaining = seededShuffle(
    Array.from({ length: 15 }, (_, index) => index + 1).filter((id) => !used.has(id)),
    seed
  );

  return positions.map((position) => {
    const key = `${position.row}:${position.col}`;
    const id = assignment.get(key) ?? remaining.shift()!;
    return makeBall(id, position.x, position.y);
  });
}

function rackNineBall(seed: number): BallState[] {
  const rows = [1, 2, 3, 2, 1];
  const rowStep = (BALL_DIAMETER + GAP) * Math.sqrt(3) / 2;
  const positions: Array<{ row: number; col: number; x: number; y: number }> = [];
  rows.forEach((count, row) => {
    for (let col = 0; col < count; col += 1) {
      positions.push({
        row,
        col,
        // WPA 9-ball: the 9 sits at the diamond center on the foot spot,
        // while the 1 is the head-facing apex two rows toward the head rail.
        x: FOOT_X + (row - 2) * rowStep,
        y: CENTER_Y + (col - (count - 1) / 2) * (BALL_DIAMETER + GAP)
      });
    }
  });

  const remaining = seededShuffle([2, 3, 4, 5, 6, 7, 8], seed);
  return positions.map((position) => {
    const id = position.row === 0 ? 1 : position.row === 2 && position.col === 1 ? 9 : remaining.shift()!;
    return makeBall(id, position.x, position.y);
  });
}

export function createRack(mode: GameMode, seed = Date.now()): BallState[] {
  const cue = makeBall(0, TABLE_WIDTH * 0.25, CENTER_Y);
  return [cue, ...(mode === 'eight-ball' ? rackEightBall(seed) : rackNineBall(seed))];
}

export function createGame(settings: RoomSettings, breakerIndex: 0 | 1, seed = Date.now()): GameSnapshot {
  return {
    revision: 1,
    mode: settings.mode,
    ruleset: settings.ruleset,
    rulesetVersion: 1,
    houseCallMode: settings.houseCallMode,
    phase: 'aiming',
    balls: createRack(settings.mode, seed),
    pocketedOrder: [],
    turnIndex: breakerIndex,
    breakerIndex,
    scores: [0, 0],
    groups: [null, null],
    tableOpen: settings.mode === 'eight-ball',
    breakShot: true,
    ballInHand: true,
    placement: 'kitchen',
    shotNumber: 0,
    winnerIndex: null,
    consecutiveFouls: [0, 0],
    pushOutAvailable: false,
    pushOutReturnTo: null,
    shotClockEndsAt: null,
    lastEvents: []
  };
}

export function createNextRack(game: GameSnapshot, seed = Date.now()): GameSnapshot {
  const breakerIndex = game.winnerIndex ?? game.breakerIndex;
  return {
    ...game,
    revision: game.revision + 1,
    phase: 'aiming',
    balls: createRack(game.mode, seed),
    pocketedOrder: [],
    turnIndex: breakerIndex,
    breakerIndex,
    groups: [null, null],
    tableOpen: game.mode === 'eight-ball',
    breakShot: true,
    ballInHand: true,
    placement: 'kitchen',
    shotNumber: 0,
    winnerIndex: null,
    consecutiveFouls: [0, 0],
    pushOutAvailable: false,
    pushOutReturnTo: null,
    shotClockEndsAt: null,
    lastEvents: []
  };
}

export function resetBall(ball: BallState, x: number, y: number): BallState {
  return {
    ...ball, x, y, z: BALL_RADIUS,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    disposition: 'on-table'
  };
}

export function findRespotPosition(balls: BallState[]): { x: number; y: number } {
  const startX = FOOT_X;
  for (let offset = 0; offset < 30; offset += 1) {
    const x = Math.min(TABLE_WIDTH - BALL_RADIUS, startX + offset * (BALL_DIAMETER + GAP));
    const clear = balls.every((ball) => ball.disposition !== 'on-table' || Math.hypot(ball.x - x, ball.y - CENTER_Y) >= BALL_DIAMETER + GAP / 2);
    if (clear) return { x, y: CENTER_Y };
  }
  return { x: TABLE_WIDTH / 2, y: CENTER_Y };
}
