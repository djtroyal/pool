import { BALL_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import { POCKETS } from './geometry.js';
import { simulateShot } from './physics.js';
import { callRequirement, groupForBall, resolveShot } from './rules.js';
import type { BallState, CpuDifficulty, GameSnapshot, PhysicsConfig, ShotInput, Vec2 } from './types.js';

interface CpuProfile {
  candidates: number;
  angleNoise: number;
  powerNoise: number;
  spinNoise: number;
  positionWeight: number;
  safetyWeight: number;
  advanced: boolean;
}

const CPU_PROFILES: Record<CpuDifficulty, CpuProfile> = {
  rookie: { candidates: 12, angleNoise: 1.8, powerNoise: 0.08, spinNoise: 0.1, positionWeight: 20, safetyWeight: 5, advanced: false },
  club: { candidates: 24, angleNoise: 0.8, powerNoise: 0.04, spinNoise: 0.06, positionWeight: 42, safetyWeight: 24, advanced: false },
  expert: { candidates: 44, angleNoise: 0.3, powerNoise: 0.02, spinNoise: 0.03, positionWeight: 68, safetyWeight: 52, advanced: true },
  master: { candidates: 72, angleNoise: 0.12, powerNoise: 0.01, spinNoise: 0.015, positionWeight: 90, safetyWeight: 76, advanced: true }
};

function randomFactory(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}

function legalTargets(game: GameSnapshot): BallState[] {
  const objects = game.balls.filter((ball) => ball.id > 0 && ball.disposition === 'on-table');
  if (game.mode === 'nine-ball') {
    const lowest = Math.min(...objects.map((ball) => ball.id));
    return objects.filter((ball) => ball.id === lowest);
  }
  if (game.tableOpen) return objects.filter((ball) => ball.id !== 8);
  const group = game.groups[game.turnIndex];
  const own = objects.filter((ball) => groupForBall(ball.id) === group);
  return own.length ? own : objects.filter((ball) => ball.id === 8);
}

function directCandidate(game: GameSnapshot, target: BallState, pocketId: string, power: number, english = 0): ShotInput | null {
  const cue = game.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
  const pocket = POCKETS.find((entry) => entry.id === pocketId);
  if (!cue || !pocket) return null;
  const dx = pocket.center.x - target.x; const dy = pocket.center.y - target.y;
  const length = Math.hypot(dx, dy) || 1;
  const ghost = { x: target.x - dx / length * BALL_RADIUS * 2, y: target.y - dy / length * BALL_RADIUS * 2 };
  return {
    revision: game.revision,
    angle: Math.atan2(ghost.y - cue.y, ghost.x - cue.x),
    power,
    elevation: 0,
    english: { side: english, vertical: english ? 0.12 : 0 },
    calledShot: callRequirement(game) === 'none' ? null : { ballId: target.id, pocketId },
    shotKind: 'normal'
  };
}

function cuePositionScore(game: GameSnapshot): number {
  const cue = game.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
  if (!cue) return -500;
  const targets = legalTargets(game);
  if (!targets.length) return 250;
  const nearest = Math.min(...targets.map((target) => Math.hypot(target.x - cue.x, target.y - cue.y)));
  return 100 - Math.abs(nearest - 0.7) * 80;
}

function evaluateCandidate(game: GameSnapshot, shot: ShotInput, config: PhysicsConfig, profile: CpuProfile): number {
  const simulation = simulateShot(game.balls, shot, config);
  const after = resolveShot(game, simulation, shot);
  const foul = after.lastEvents.some((entry) => ['scratch', 'wrong-first-ball', 'no-rail-or-pocket', 'illegal-break', 'ball-off-table'].includes(entry.code));
  const pockets = simulation.trace.pocketed.filter((id) => id > 0).length;
  const continues = after.phase === 'aiming' && after.turnIndex === game.turnIndex;
  const wins = after.phase === 'rack-over' && after.winnerIndex === game.turnIndex;
  const leavesOpponent = after.phase === 'aiming' && after.turnIndex !== game.turnIndex;
  return (wins ? 10_000 : 0) + pockets * 800 + (continues ? 260 : 0) - (foul ? 2_400 : 0)
    + cuePositionScore(after) * profile.positionWeight / 100
    + (leavesOpponent && pockets === 0 ? profile.safetyWeight : 0);
}

export function chooseCpuShot(game: GameSnapshot, difficulty: CpuDifficulty, config: PhysicsConfig, seed: number): ShotInput {
  const profile = CPU_PROFILES[difficulty];
  const random = randomFactory(seed);
  if (game.pushOutAvailable && profile.advanced && random() < 0.12) {
    return { revision: game.revision, angle: random() * Math.PI * 2, power: 0.22, elevation: 0, english: { side: 0, vertical: 0 }, shotKind: 'push-out' };
  }
  const targets = legalTargets(game);
  const candidates: ShotInput[] = [];
  for (const target of targets) {
    for (const pocket of POCKETS) {
      const distance = Math.hypot(pocket.center.x - target.x, pocket.center.y - target.y);
      const power = Math.max(0.22, Math.min(0.82, 0.28 + distance / TABLE_WIDTH * 0.42));
      const candidate = directCandidate(game, target, pocket.id, power, profile.advanced ? (random() - 0.5) * 0.35 : 0);
      if (candidate) candidates.push(candidate);
    }
  }
  while (candidates.length < profile.candidates) {
    candidates.push({
      revision: game.revision, angle: random() * Math.PI * 2, power: 0.18 + random() * 0.65,
      elevation: profile.advanced && random() < 0.05 ? 18 + random() * 24 : 0,
      english: profile.advanced ? { side: (random() - 0.5) * 0.8, vertical: (random() - 0.5) * 0.7 } : { side: 0, vertical: 0 },
      shotKind: 'normal'
    });
  }
  let best = candidates[0] ?? { revision: game.revision, angle: 0, power: 0.5, elevation: 0, english: { side: 0, vertical: 0 } };
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates.slice(0, profile.candidates)) {
    const score = evaluateCandidate(game, candidate, config, profile);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  const radians = profile.angleNoise * Math.PI / 180;
  return {
    ...best,
    angle: best.angle + (random() + random() - 1) * radians,
    power: Math.max(0.04, Math.min(1, best.power + (random() + random() - 1) * profile.powerNoise)),
    english: {
      side: Math.max(-1, Math.min(1, best.english.side + (random() + random() - 1) * profile.spinNoise)),
      vertical: Math.max(-1, Math.min(1, best.english.vertical + (random() + random() - 1) * profile.spinNoise))
    }
  };
}

export function chooseCpuPlacement(game: GameSnapshot, seed: number): Vec2 {
  const random = randomFactory(seed);
  const minX = game.placement === 'kitchen' ? BALL_RADIUS : BALL_RADIUS;
  const maxX = game.placement === 'kitchen' ? TABLE_WIDTH * 0.25 - BALL_RADIUS : TABLE_WIDTH - BALL_RADIUS;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const point = { x: minX + random() * (maxX - minX), y: BALL_RADIUS + random() * (TABLE_HEIGHT - BALL_RADIUS * 2) };
    if (game.balls.every((ball) => ball.id === 0 || ball.disposition !== 'on-table' || Math.hypot(ball.x - point.x, ball.y - point.y) >= BALL_RADIUS * 2.05)) return point;
  }
  return { x: minX, y: TABLE_HEIGHT / 2 };
}
