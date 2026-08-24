import { BALL_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import { groupForBall } from './rules.js';
import type {
  BallState,
  GameSnapshot,
  MasteryTrack,
  PerformanceComponent,
  ShotInput,
  ShotSimulation,
  Vec2
} from './types.js';

export interface ShotPerformanceContext {
  before: GameSnapshot;
  after: GameSnapshot;
  simulation: ShotSimulation;
  shot: ShotInput;
  shooterIndex: 0 | 1;
  streakBefore: number;
  opponentShotCount: number;
}

export interface ShotPerformanceResult {
  components: PerformanceComponent[];
  delta: number;
  nextStreak: number;
  technique: string | null;
  mastery: Partial<Record<MasteryTrack, number>>;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function eventPoint(simulation: ShotSimulation, ballId: number): { time: number; point: Vec2 } {
  const pocket = simulation.trace.contacts.find((contact) => contact.kind === 'pocket' && contact.ballIds.includes(ballId));
  return pocket ? { time: pocket.time, point: pocket.point } : { time: simulation.trace.duration, point: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 } };
}

function eligiblePockets(context: ShotPerformanceContext, foul: boolean): number[] {
  if (foul) return [];
  const { before, after, shooterIndex, simulation } = context;
  const objects = simulation.trace.pocketed.filter((id) => id !== 0);
  if (before.mode === 'nine-ball') return objects;
  const group = before.groups[shooterIndex];
  return objects.filter((id) => {
    if (id === 8) return after.phase === 'rack-over' && after.winnerIndex === shooterIndex;
    return before.tableOpen || group === null || groupForBall(id) === group;
  });
}

function component(
  code: PerformanceComponent['code'], label: string, points: number,
  atTime: number, point: Vec2 | null = null, ballId: number | null = null
): PerformanceComponent {
  return { code, label, points: Math.round(points), atTime, point, ballId };
}

function directTargets(game: GameSnapshot, player: 0 | 1): BallState[] {
  const cue = game.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
  if (!cue) return [];
  let targets = game.balls.filter((ball) => ball.id !== 0 && ball.disposition === 'on-table');
  if (game.mode === 'nine-ball') {
    const lowest = Math.min(...targets.map((ball) => ball.id));
    targets = targets.filter((ball) => ball.id === lowest);
  } else if (!game.tableOpen && game.groups[player]) {
    const own = targets.filter((ball) => groupForBall(ball.id) === game.groups[player]);
    targets = own.length ? own : targets.filter((ball) => ball.id === 8);
  } else {
    targets = targets.filter((ball) => ball.id !== 8);
  }
  return targets.filter((target) => {
    const dx = target.x - cue.x; const dy = target.y - cue.y;
    const lengthSquared = dx * dx + dy * dy;
    return !game.balls.some((blocker) => {
      if (blocker.id === 0 || blocker.id === target.id || blocker.disposition !== 'on-table') return false;
      const t = clamp(((blocker.x - cue.x) * dx + (blocker.y - cue.y) * dy) / lengthSquared, 0, 1);
      if (t <= 0.02 || t >= 0.98) return false;
      return Math.hypot(blocker.x - (cue.x + dx * t), blocker.y - (cue.y + dy * t)) < BALL_RADIUS * 2.05;
    });
  });
}

function verifiedJump(context: ShotPerformanceContext): boolean {
  const contactTime = context.simulation.trace.firstContactTime ?? context.simulation.trace.duration;
  return context.simulation.frames.some((frame) => {
    if (frame.time >= contactTime) return false;
    const cue = frame.balls.find((ball) => ball.id === 0);
    if (!cue || cue.z <= BALL_RADIUS * 1.35) return false;
    return frame.balls.some((ball) => ball.id !== 0 && ball.disposition === 'on-table'
      && Math.hypot(ball.x - cue.x, ball.y - cue.y) < BALL_RADIUS * 1.8
      && cue.z > ball.z + BALL_RADIUS * 0.75);
  });
}

function verifiedCurve(context: ShotPerformanceContext): boolean {
  if (context.shot.elevation < 15 || Math.abs(context.shot.english.side) < 0.35) return false;
  const contactTime = context.simulation.trace.firstContactTime ?? context.simulation.trace.duration;
  const points = context.simulation.frames.flatMap((frame) => {
    const cue = frame.time <= contactTime ? frame.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table') : null;
    return cue ? [{ x: cue.x, y: cue.y }] : [];
  });
  const start = points[0]; const end = points.at(-1);
  if (!start || !end || points.length < 3) return false;
  const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy) || 1;
  return points.some((point) => Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length > BALL_RADIUS * 0.65);
}

export function analyzeShotPerformance(context: ShotPerformanceContext): ShotPerformanceResult {
  const { before, after, simulation, shooterIndex } = context;
  const ruleCodes = new Set(after.lastEvents.map((event) => event.code));
  const foul = ['scratch', 'wrong-first-ball', 'no-rail-or-pocket', 'illegal-break', 'ball-off-table'].some((code) => ruleCodes.has(code as never));
  const pockets = eligiblePockets(context, foul);
  const components: PerformanceComponent[] = [];
  const mastery: Partial<Record<MasteryTrack, number>> = {};
  const firstContactTime = simulation.trace.firstContactTime ?? simulation.trace.duration;

  for (const id of pockets) {
    const arrival = eventPoint(simulation, id);
    const ball = before.balls.find((entry) => entry.id === id);
    const cue = before.balls.find((entry) => entry.id === 0);
    const collision = simulation.trace.contacts.find((contact) => contact.kind === 'ball-ball' && contact.ballIds.includes(id) && contact.ballIds.includes(0));
    components.push(component('legal-pocket', `Ball ${id}`, 100, arrival.time, arrival.point, id));
    if (ball) {
      const travelBonus = clamp(distance(ball, arrival.point) / Math.hypot(TABLE_WIDTH, TABLE_HEIGHT), 0, 1) * 30;
      if (travelBonus >= 2) components.push(component('distance', 'Distance', travelBonus, arrival.time, arrival.point, id));
    }
    if (ball && cue && collision) {
      const incoming = { x: collision.point.x - cue.x, y: collision.point.y - cue.y };
      const outgoing = { x: arrival.point.x - ball.x, y: arrival.point.y - ball.y };
      const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y) || 1;
      const angle = Math.acos(clamp((incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator, -1, 1)) * 180 / Math.PI;
      const cutBonus = clamp((angle - 10) / 65, 0, 1) * 40;
      if (cutBonus >= 2) {
        components.push(component('cut', 'Cut angle', cutBonus, arrival.time, collision.point, id));
        if (cutBonus >= 28) mastery.precision = (mastery.precision ?? 0) + 1;
      }
    }
    const banks = simulation.trace.contacts.filter((contact) => (contact.kind === 'cushion' || contact.kind === 'jaw')
      && contact.ballIds.includes(id) && contact.time < arrival.time).length;
    if (banks) {
      components.push(component('bank', banks > 1 ? `${banks}-rail bank` : 'Bank', Math.min(120, banks * 60), arrival.time, arrival.point, id));
      mastery.rails = (mastery.rails ?? 0) + 1;
    }
    const involved = new Set(simulation.trace.contacts.filter((contact) => contact.kind === 'ball-ball' && contact.time <= arrival.time && contact.ballIds.includes(id))
      .flatMap((contact) => contact.ballIds.filter((ballId) => ballId !== 0 && ballId !== id)));
    if (involved.size) components.push(component('combination', involved.size > 1 ? 'Combination chain' : 'Combination', Math.min(100, involved.size * 50), arrival.time, arrival.point, id));
  }

  const kicks = simulation.trace.contacts.filter((contact) => (contact.kind === 'cushion' || contact.kind === 'jaw')
    && contact.ballIds.includes(0) && contact.time < firstContactTime).length;
  if (!foul && kicks && simulation.trace.firstContact !== null) {
    const at = simulation.trace.contacts.find((contact) => contact.kind === 'ball-ball' && contact.ballIds.includes(0));
    components.push(component('kick', kicks > 1 ? `${kicks}-rail kick` : 'Kick', Math.min(120, kicks * 60), firstContactTime, at?.point ?? null));
    mastery.rails = (mastery.rails ?? 0) + 1;
  }

  let technique: string | null = null;
  if (!foul && verifiedJump(context) && simulation.trace.firstContact !== null) {
    technique = 'Jump'; components.push(component('jump', 'Jump clearance', 100, firstContactTime));
    mastery.technique = (mastery.technique ?? 0) + 1;
  } else if (!foul && verifiedCurve(context) && simulation.trace.firstContact !== null) {
    technique = context.shot.elevation >= 35 ? 'Massé' : 'Swerve';
    components.push(component('curve', technique, 80, firstContactTime));
    mastery.technique = (mastery.technique ?? 0) + 1;
  }

  if (pockets.length > 1) components.push(component('multi-pot', `${pockets.length}-ball pot`, (pockets.length - 1) * 40, simulation.trace.duration));
  if (!foul && before.breakShot && ruleCodes.has('legal-break')) {
    components.push(component('legal-break', 'Legal break', 50 + pockets.length * 25, simulation.trace.duration));
    const rackCenter = before.balls.filter((ball) => ball.id !== 0).reduce((sum, ball) => ({ x: sum.x + ball.x, y: sum.y + ball.y }), { x: 0, y: 0 });
    const count = Math.max(1, before.balls.length - 1);
    const center = { x: rackCenter.x / count, y: rackCenter.y / count };
    const spread = simulation.balls.filter((ball) => ball.id !== 0 && ball.disposition === 'on-table')
      .reduce((sum, ball) => sum + distance(ball, center), 0) / count;
    const spreadPoints = clamp(spread / (TABLE_WIDTH * 0.42), 0, 1) * 50;
    components.push(component('break-spread', 'Rack spread', spreadPoints, simulation.trace.duration));
    if (spreadPoints >= 32 || pockets.length > 0) mastery.break = (mastery.break ?? 0) + 1;
  }

  const continues = after.phase === 'aiming' && after.turnIndex === shooterIndex;
  if (!foul && pockets.length && continues) {
    const cue = after.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table');
    const targets = directTargets(after, shooterIndex);
    if (cue && targets.length) {
      const nearest = Math.min(...targets.map((target) => distance(cue, target)));
      const positionPoints = 35 + clamp(1 - Math.abs(nearest - 0.72) / 0.72, 0, 1) * 40;
      components.push(component('position', 'Position', positionPoints, simulation.trace.duration, cue));
      mastery.control = (mastery.control ?? 0) + 1;
    }
  } else if (!foul && !pockets.length && after.phase === 'aiming' && after.turnIndex !== shooterIndex
    && directTargets(after, after.turnIndex).length === 0) {
    components.push(component('safety', 'Safety', 100, simulation.trace.duration));
    mastery.control = (mastery.control ?? 0) + 1;
  }

  const nextStreak = !foul && pockets.length && continues ? context.streakBefore + 1 : 0;
  if (nextStreak > 1) components.push(component('streak', `${nextStreak}-shot run`, Math.min(100, (nextStreak - 1) * 25), simulation.trace.duration));

  if (after.phase === 'rack-over' && after.winnerIndex === shooterIndex) {
    components.push(component('rack-win', 'Rack won', 200, simulation.trace.duration));
    if (context.streakBefore >= 2) {
      components.push(component('runout', 'Runout', 300, simulation.trace.duration));
      mastery.runout = (mastery.runout ?? 0) + 1;
      if (before.breakerIndex === shooterIndex && context.opponentShotCount === 0) components.push(component('break-and-run', 'Break and run', 250, simulation.trace.duration));
    }
  }

  if (foul) components.push(component('foul', 'Foul', -100, simulation.trace.duration));
  if (ruleCodes.has('scratch')) components.push(component('scratch', 'Scratch', -50, simulation.trace.duration));
  if (ruleCodes.has('illegal-break')) components.push(component('illegal-break', 'Illegal break', -50, simulation.trace.duration));
  for (const id of simulation.trace.offTable.filter((ballId) => ballId !== 0)) components.push(component('off-table', `Ball ${id} off table`, -50, simulation.trace.duration, null, id));

  return {
    components,
    delta: components.reduce((sum, entry) => sum + entry.points, 0),
    nextStreak,
    technique,
    mastery
  };
}
