import { BALL_DIAMETER, BALL_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import type { BallState, GameSnapshot, Vec2 } from './types.js';

export function isValidPlacement(game: GameSnapshot, point: Vec2, ballId = 0): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (point.x < BALL_RADIUS || point.x > TABLE_WIDTH - BALL_RADIUS) return false;
  if (point.y < BALL_RADIUS || point.y > TABLE_HEIGHT - BALL_RADIUS) return false;
  if (game.placement === 'kitchen' && point.x > TABLE_WIDTH * 0.25) return false;
  return game.balls.every((ball) => {
    if (ball.id === ballId || ball.disposition !== 'on-table') return true;
    return Math.hypot(point.x - ball.x, point.y - ball.y) >= BALL_DIAMETER + 0.001;
  });
}

export function placeBall(game: GameSnapshot, point: Vec2, ballId = 0): GameSnapshot {
  if (!isValidPlacement(game, point, ballId)) return game;
  const balls: BallState[] = game.balls.map((ball) => ball.id === ballId
    ? {
        ...ball, ...point, z: BALL_RADIUS,
        vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
        disposition: 'on-table' as const
      }
    : ball);
  return {
    ...game,
    balls,
    pocketedOrder: game.pocketedOrder.filter((id) => id !== ballId),
    revision: game.revision + 1,
    ballInHand: ballId === 0 ? false : game.ballInHand,
    placement: ballId === 0 ? null : game.placement
  };
}
