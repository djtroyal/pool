import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  BALL_DIAMETER,
  cushionBody,
  DEFAULT_SETTINGS,
  TABLE_GEOMETRY,
  createGame,
  createRack,
  isValidPlacement,
  predictTrajectory,
  simulateShot,
  type BallState,
  type ShotInput
} from '../src/index.js';

function ball(id: number, x: number, y: number): BallState {
  return {
    id, x, y, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 }, disposition: 'on-table'
  };
}

function shot(overrides: Partial<ShotInput> = {}): ShotInput {
  return {
    revision: 1,
    angle: 0,
    power: 0.5,
    elevation: 0,
    english: { side: 0, vertical: 0 },
    ...overrides
  };
}

describe('racks and placement', () => {
  it('creates complete standard racks without overlap', () => {
    for (const mode of ['eight-ball', 'nine-ball'] as const) {
      const rack = createRack(mode, 42);
      expect(rack).toHaveLength(mode === 'eight-ball' ? 16 : 10);
      expect(new Set(rack.map((entry) => entry.id)).size).toBe(rack.length);
      for (let index = 0; index < rack.length; index += 1) {
        for (let other = index + 1; other < rack.length; other += 1) {
          expect(Math.hypot(rack[index]!.x - rack[other]!.x, rack[index]!.y - rack[other]!.y)).toBeGreaterThanOrEqual(BALL_RADIUS * 2);
        }
      }
    }
  });

  it('uses the WPA 8-ball rack constraints', () => {
    const rack = createRack('eight-ball', 42).filter((entry) => entry.id !== 0);
    const footX = 2.54 * 0.75;
    const rowStep = (BALL_DIAMETER + 0.00075) * Math.sqrt(3) / 2;
    expect(Math.min(...rack.map((entry) => entry.x))).toBeCloseTo(footX, 8);
    const eight = rack.find((entry) => entry.id === 8)!;
    expect(eight.x).toBeCloseTo(footX + rowStep * 2, 8);
    expect(eight.y).toBeCloseTo(1.27 / 2, 8);
    const rearCorners = rack.filter((entry) => Math.abs(entry.x - (footX + rowStep * 4)) < 1e-8)
      .sort((a, b) => a.y - b.y);
    expect(rearCorners).toHaveLength(5);
    expect([rearCorners[0]!.id <= 7, rearCorners[4]!.id <= 7]).toEqual([true, false]);
  });

  it('places the 9 on the foot spot and the 1 at the head-facing apex', () => {
    const rack = createRack('nine-ball', 73);
    const one = rack.find((entry) => entry.id === 1)!;
    const nine = rack.find((entry) => entry.id === 9)!;
    expect(nine.x).toBeCloseTo(2.54 * 0.75, 8);
    expect(nine.y).toBeCloseTo(1.27 / 2, 8);
    expect(one.x).toBeLessThan(nine.x);
    expect(one.y).toBeCloseTo(nine.y, 8);
    expect(createRack('nine-ball', 73)).toEqual(createRack('nine-ball', 73));
  });

  it('enforces kitchen and collision placement constraints', () => {
    const game = createGame({ ...DEFAULT_SETTINGS, mode: 'eight-ball' }, 0, 1);
    expect(isValidPlacement(game, { x: 0.2, y: 0.3 })).toBe(true);
    expect(isValidPlacement(game, { x: 1, y: 0.3 })).toBe(false);
    expect(isValidPlacement(game, { x: game.balls[1]!.x, y: game.balls[1]!.y })).toBe(false);
  });
});

describe('shot simulation', () => {
  it('transfers momentum on a straight collision and settles all balls', () => {
    const simulation = simulateShot([ball(0, 0.45, 0.63), ball(1, 0.95, 0.63)], shot());
    expect(simulation.trace.firstContact).toBe(1);
    expect(simulation.trace.contacts.every((contact) => Number.isFinite(contact.impactSpeed) && contact.impactSpeed >= 0)).toBe(true);
    expect(simulation.balls[1]!.x).toBeGreaterThan(0.95);
    expect(simulation.balls.every((entry) => entry.vx === 0 && entry.vy === 0 && entry.vz === 0)).toBe(true);
    expect(simulation.frames.length).toBeGreaterThan(5);
  });

  it('is deterministic for the same rack and input', () => {
    const rack = createRack('nine-ball', 91);
    const input = shot({ power: 0.72, english: { side: 0.31, vertical: -0.25 } });
    const first = simulateShot(rack, input);
    const second = simulateShot(rack, input);
    expect(second.trace).toEqual(first.trace);
    expect(second.balls).toEqual(first.balls);
  });

  it('changes the predicted cue path when English changes', () => {
    const balls = [ball(0, 0.4, 0.52), ball(2, 1.08, 0.52)];
    const center = predictTrajectory(balls, shot({ power: 0.58 }));
    const english = predictTrajectory(balls, shot({ power: 0.58, english: { side: 0.72, vertical: -0.55 } }));
    expect(center.objectBallId).toBe(2);
    expect(english.objectBallId).toBe(2);
    expect(english.cuePath.at(-1)).not.toEqual(center.cuePath.at(-1));
  });

  it('never emits non-finite ball state', () => {
    const result = simulateShot(createRack('eight-ball', 17), shot({ power: 1, english: { side: 0.7, vertical: 0.7 } }));
    for (const entry of result.balls) {
      expect([entry.x, entry.y, entry.z, entry.vx, entry.vy, entry.vz, entry.wx, entry.wy, entry.wz, entry.orientation.w].every(Number.isFinite)).toBe(true);
    }
  });

  it('creates airborne frames for a jump shot', () => {
    const simulation = simulateShot([ball(0, 0.6, 0.63)], shot({ power: 1, elevation: 38 }));
    expect(simulation.frames.some((frame) => (frame.balls[0]?.z ?? BALL_RADIUS) > BALL_RADIUS + 0.01)).toBe(true);
    expect(simulation.trace.contacts.some((event) => event.kind === 'cloth')).toBe(true);
  });

  it('draws predicted rail paths through the exact contact face', () => {
    const preview = predictTrajectory([ball(0, 1.1, 0.45)], shot({ angle: -Math.PI / 2, power: 0.6 }), { clothSpeed: 'standard' });
    expect(preview.contacts.some((event) => event.kind === 'cushion')).toBe(true);
    expect(Math.min(...preview.cuePath.map((point) => point.y))).toBeCloseTo(0, 6);
  });

  it('includes the struck ball trajectory after a post-landing jump impact', () => {
    const preview = predictTrajectory(
      [ball(0, 0.35, 0.635), ball(2, 2.15, 0.635)],
      shot({ power: 1, elevation: 38 }),
      { clothSpeed: 'standard' }
    );
    const landing = preview.contacts.find((event) => event.kind === 'cloth');
    const impact = preview.contacts.find((event) => event.kind === 'ball-ball');
    expect(landing).toBeDefined();
    expect(impact).toBeDefined();
    expect(impact!.time).toBeGreaterThan(landing!.time);
    expect(preview.objectBallId).toBe(2);
    expect(preview.objectPath.length).toBeGreaterThan(1);
  });

  it('predicts chained object-ball impacts to the selected depth', () => {
    const preview = predictTrajectory(
      [ball(0, 0.35, 0.635), ball(1, 0.9, 0.635), ball(2, 1.15, 0.635), ball(3, 1.4, 0.635)],
      shot({ power: 0.9 }),
      { clothSpeed: 'standard', rebounds: 1, impacts: 3 }
    );
    expect(preview.impacts.map((impact) => impact.outgoingBallId)).toEqual(expect.arrayContaining([1, 2]));
    expect(preview.objectPaths.map((path) => path.ballId)).toEqual(expect.arrayContaining([1, 2]));
    expect(Math.max(...preview.objectPaths.map((path) => path.generation))).toBeGreaterThanOrEqual(2);
  });

  it('uses one explicit set of rail and jaw boundaries', () => {
    expect(TABLE_GEOMETRY.cushions.filter((segment) => segment.kind === 'cushion')).toHaveLength(6);
    expect(TABLE_GEOMETRY.cushions.filter((segment) => segment.kind === 'jaw')).toHaveLength(12);
    expect(TABLE_GEOMETRY.pockets).toHaveLength(6);
  });

  it('keeps rendered cushion material behind the physics contact face', () => {
    for (const segment of TABLE_GEOMETRY.cushions) {
      const body = cushionBody(segment);
      expect(body[0]).toEqual(segment.a);
      expect(body[1]).toEqual(segment.b);
      for (const [point, face] of [[body[2], segment.b], [body[3], segment.a]] as const) {
        const inwardDepth = (point.x - face.x) * segment.inward.x + (point.y - face.y) * segment.inward.y;
        expect(inwardDepth).toBeCloseTo(-TABLE_GEOMETRY.cushionWidth, 8);
      }
    }
  });
});
