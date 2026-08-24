import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CLOTH_PROFILES,
  CUSHION_TOP_HEIGHT,
  FIXED_STEP,
  FRAME_STEP,
  GRAVITY,
  MAX_SHOT_TIME,
  STOP_SPEED,
  TABLE_HEIGHT,
  TABLE_WIDTH
} from './constants.js';
import { pointBehindPocketFallLine, TABLE_GEOMETRY, type CushionSegment } from './geometry.js';
import type {
  BallState,
  ContactEvent,
  PhysicsConfig,
  PlaybackFrame,
  Quaternion,
  ShotInput,
  ShotSimulation,
  ShotTrace,
  TrajectoryPoint,
  TrajectoryPreview,
  TrajectoryBallPath,
  TrajectoryImpact,
  TrajectoryPredictionConfig,
  Vec2
} from './types.js';

const BALL_RESTITUTION = 0.94;
const CUSHION_RESTITUTION = 0.82;
const DEFAULT_CONFIG: PhysicsConfig = { clothSpeed: 'standard' };
const PREVIEW_SIMULATION_TIME = 6;
const PREVIEW_FRAME_STEP = 1 / 90;

interface MutableTrace {
  firstContact: number | null;
  firstContactTime: number | null;
  pocketed: number[];
  offTable: number[];
  railContacts: Set<number>;
  anyRailAfterContact: boolean;
  cueScratch: boolean;
  contacts: ContactEvent[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function active(ball: BallState): boolean {
  return ball.disposition === 'on-table';
}

function cloneBalls(balls: BallState[]): BallState[] {
  return balls.map((ball) => ({ ...ball, orientation: { ...ball.orientation } }));
}

function addContact(trace: MutableTrace, contact: ContactEvent): void {
  const previous = trace.contacts.at(-1);
  if (previous && previous.kind === contact.kind && previous.surfaceId === contact.surfaceId
    && previous.ballIds.join(',') === contact.ballIds.join(',') && contact.time - previous.time < 0.012) return;
  trace.contacts.push(contact);
}

function applyStrike(balls: BallState[], shot: ShotInput): void {
  const cue = balls.find((ball) => ball.id === 0);
  if (!cue || !active(cue)) return;
  const angle = Number.isFinite(shot.angle) ? shot.angle : 0;
  const power = clamp(shot.power, 0.04, 1);
  const elevation = clamp(Number.isFinite(shot.elevation) ? shot.elevation : 0, 0, 75) * Math.PI / 180;
  const englishLength = Math.hypot(shot.english.side, shot.english.vertical);
  const englishScale = englishLength > 1 ? 1 / englishLength : 1;
  const side = clamp(shot.english.side * englishScale, -1, 1);
  const vertical = clamp(shot.english.vertical * englishScale, -1, 1);
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const speed = 0.55 + 7.15 * power ** 1.35;
  const horizontalSpeed = speed * Math.cos(elevation);
  cue.vx = directionX * horizontalSpeed;
  cue.vy = directionY * horizontalSpeed;
  const downwardImpulse = speed * Math.sin(elevation);
  cue.vz = Math.max(0, downwardImpulse - 1.15) * 0.35;
  const followSpin = vertical * speed / BALL_RADIUS * 1.28;
  cue.wx = -directionY * followSpin;
  cue.wy = directionX * followSpin;
  cue.wz = -side * speed / BALL_RADIUS * (1.65 + Math.sin(elevation) * 1.8);
}

function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function integrateOrientation(ball: BallState, dt: number): void {
  const q = ball.orientation;
  const half = dt * 0.5;
  ball.orientation = normalizeQuaternion({
    x: q.x + half * (ball.wx * q.w + ball.wy * q.z - ball.wz * q.y),
    y: q.y + half * (-ball.wx * q.z + ball.wy * q.w + ball.wz * q.x),
    z: q.z + half * (ball.wx * q.y - ball.wy * q.x + ball.wz * q.w),
    w: q.w + half * (-ball.wx * q.x - ball.wy * q.y - ball.wz * q.z)
  });
}

function applyCloth(ball: BallState, dt: number, config: PhysicsConfig): void {
  if (!active(ball) || ball.z > BALL_RADIUS + 0.0005 || ball.vz > 0.02) return;
  const profile = CLOTH_PROFILES[config.clothSpeed];
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < 1e-7) {
    ball.vx = 0;
    ball.vy = 0;
    ball.wx *= Math.exp(-2.5 * dt);
    ball.wy *= Math.exp(-2.5 * dt);
    ball.wz *= Math.exp(-profile.spinDecay * dt);
    return;
  }

  const slipX = ball.vx - BALL_RADIUS * ball.wy;
  const slipY = ball.vy + BALL_RADIUS * ball.wx;
  const slipSpeed = Math.hypot(slipX, slipY);
  if (slipSpeed > 0.025) {
    const change = Math.min(profile.slidingFriction * GRAVITY * dt, slipSpeed);
    const dvx = -slipX / slipSpeed * change;
    const dvy = -slipY / slipSpeed * change;
    ball.vx += dvx;
    ball.vy += dvy;
    ball.wx += 2.5 / BALL_RADIUS * dvy;
    ball.wy -= 2.5 / BALL_RADIUS * dvx;
  } else {
    const nextSpeed = Math.max(0, speed - profile.rollingResistance * GRAVITY * dt);
    const scale = nextSpeed / speed;
    ball.vx *= scale;
    ball.vy *= scale;
    ball.wx = -ball.vy / BALL_RADIUS;
    ball.wy = ball.vx / BALL_RADIUS;
  }

  const currentSpeed = Math.hypot(ball.vx, ball.vy);
  if (currentSpeed > 0.04) {
    const sideRatio = clamp(ball.wz * BALL_RADIUS / Math.max(currentSpeed, 0.2), -2.4, 2.4);
    const curve = sideRatio * 0.012 * (profile.slidingFriction / 0.2) * GRAVITY * dt;
    const oldVx = ball.vx;
    ball.vx += -ball.vy / currentSpeed * curve;
    ball.vy += oldVx / currentSpeed * curve;
  }
  ball.wz *= Math.exp(-profile.spinDecay * dt);
}

function integrateVertical(ball: BallState, dt: number, time: number, trace: MutableTrace): void {
  if (!active(ball)) return;
  const wasAirborne = ball.z > BALL_RADIUS + 0.0005 || ball.vz > 0;
  if (!wasAirborne) {
    ball.z = BALL_RADIUS;
    ball.vz = 0;
    return;
  }
  ball.vz -= GRAVITY * dt;
  ball.z += ball.vz * dt;
  if (ball.z > BALL_RADIUS) return;
  const impact = Math.abs(ball.vz);
  ball.z = BALL_RADIUS;
  addContact(trace, {
    kind: 'cloth', time, point: { x: ball.x, y: ball.y, z: 0 }, ballIds: [ball.id],
    impactSpeed: impact, surfaceId: 'cloth', normal: { x: 0, y: 0, z: 1 }
  });
  ball.vz = impact > 0.72 ? impact * 0.17 : 0;
}

function resolveBallCollision(a: BallState, b: BallState, time: number, trace: MutableTrace): void {
  if (!active(a) || !active(b)) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared >= BALL_DIAMETER * BALL_DIAMETER) return;
  const distance = Math.sqrt(Math.max(distanceSquared, 1e-12));
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const overlap = BALL_DIAMETER - distance;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  a.z = Math.max(BALL_RADIUS, a.z - nz * overlap * 0.5);
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  b.z = Math.max(BALL_RADIUS, b.z + nz * overlap * 0.5);

  const relativeX = b.vx - a.vx;
  const relativeY = b.vy - a.vy;
  const relativeZ = b.vz - a.vz;
  const separatingSpeed = relativeX * nx + relativeY * ny + relativeZ * nz;
  if (separatingSpeed >= 0) return;
  const impulse = -(1 + BALL_RESTITUTION) * separatingSpeed / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  a.vz -= impulse * nz;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
  b.vz += impulse * nz;
  const tx = -ny;
  const ty = nx;
  const tangentSpeed = relativeX * tx + relativeY * ty;
  const spinSurface = (a.wz + b.wz) * BALL_RADIUS;
  const tangentImpulse = clamp(-(tangentSpeed + spinSurface) * 0.035, -Math.abs(impulse) * 0.08, Math.abs(impulse) * 0.08);
  a.vx -= tangentImpulse * tx;
  a.vy -= tangentImpulse * ty;
  b.vx += tangentImpulse * tx;
  b.vy += tangentImpulse * ty;
  a.wz -= tangentImpulse / BALL_RADIUS * 0.18;
  b.wz += tangentImpulse / BALL_RADIUS * 0.18;

  const point = { x: a.x + nx * BALL_RADIUS, y: a.y + ny * BALL_RADIUS, z: a.z + nz * BALL_RADIUS };
  addContact(trace, {
    kind: 'ball-ball', time, impactSpeed: Math.abs(separatingSpeed), point,
    ballIds: [a.id, b.id], normal: { x: nx, y: ny, z: nz }
  });
  if (trace.firstContact === null && (a.id === 0 || b.id === 0)) {
    const object = a.id === 0 ? b : a;
    if (object.id !== 0) {
      trace.firstContact = object.id;
      trace.firstContactTime = time;
    }
  }
}

function closestOnSegment(ball: BallState, segment: CushionSegment): { x: number; y: number } {
  const abX = segment.b.x - segment.a.x;
  const abY = segment.b.y - segment.a.y;
  const lengthSquared = abX * abX + abY * abY || 1;
  const t = clamp(((ball.x - segment.a.x) * abX + (ball.y - segment.a.y) * abY) / lengthSquared, 0, 1);
  return { x: segment.a.x + abX * t, y: segment.a.y + abY * t };
}

function cushionImpact(ball: BallState, segment: CushionSegment, time: number, trace: MutableTrace): void {
  if (ball.z - BALL_RADIUS > CUSHION_TOP_HEIGHT) return;
  const closest = closestOnSegment(ball, segment);
  let nx = ball.x - closest.x;
  let ny = ball.y - closest.y;
  const distance = Math.hypot(nx, ny);
  if (distance >= BALL_RADIUS) return;
  if (distance > 1e-8) {
    nx /= distance;
    ny /= distance;
    if (nx * segment.inward.x + ny * segment.inward.y < 0) {
      nx = segment.inward.x;
      ny = segment.inward.y;
    }
  } else {
    nx = segment.inward.x;
    ny = segment.inward.y;
  }
  const normalVelocity = ball.vx * nx + ball.vy * ny;
  if (normalVelocity >= 0) return;
  ball.x = closest.x + nx * BALL_RADIUS;
  ball.y = closest.y + ny * BALL_RADIUS;
  ball.vx -= (1 + CUSHION_RESTITUTION) * normalVelocity * nx;
  ball.vy -= (1 + CUSHION_RESTITUTION) * normalVelocity * ny;
  const tx = -ny;
  const ty = nx;
  const tangentVelocity = ball.vx * tx + ball.vy * ty;
  const tangentDelta = clamp((ball.wz * BALL_RADIUS - tangentVelocity) * 0.13, -0.65, 0.65);
  ball.vx += tangentDelta * tx;
  ball.vy += tangentDelta * ty;
  ball.wz -= tangentDelta / BALL_RADIUS * 0.38;
  addContact(trace, {
    kind: segment.kind, time, impactSpeed: Math.abs(normalVelocity),
    point: { x: closest.x, y: closest.y, z: Math.min(ball.z, CUSHION_TOP_HEIGHT) },
    ballIds: [ball.id], surfaceId: segment.id, normal: { x: nx, y: ny, z: 0 }
  });
  if (trace.firstContact !== null) {
    trace.anyRailAfterContact = true;
    if (ball.id !== 0) trace.railContacts.add(ball.id);
  }
}

function removeBall(ball: BallState, disposition: 'pocketed' | 'off-table'): void {
  ball.disposition = disposition;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.wx = 0;
  ball.wy = 0;
  ball.wz = 0;
}

function handlePocketsRailsAndEdges(ball: BallState, time: number, trace: MutableTrace): void {
  if (!active(ball)) return;
  if (ball.z <= BALL_RADIUS * 1.85) {
    for (const pocket of TABLE_GEOMETRY.pockets) {
      if (!pointBehindPocketFallLine(ball, pocket)) continue;
      const impactSpeed = Math.hypot(ball.vx, ball.vy, ball.vz);
      removeBall(ball, 'pocketed');
      trace.pocketed.push(ball.id);
      if (ball.id === 0) trace.cueScratch = true;
      addContact(trace, {
        kind: 'pocket', time, impactSpeed, point: { ...pocket.center, z: 0 }, ballIds: [ball.id], surfaceId: pocket.id
      });
      return;
    }
  }
  for (const segment of TABLE_GEOMETRY.cushions) cushionImpact(ball, segment, time, trace);
  const margin = TABLE_GEOMETRY.railWidth + BALL_RADIUS;
  if (ball.x < -margin || ball.x > TABLE_WIDTH + margin || ball.y < -margin || ball.y > TABLE_HEIGHT + margin) {
    const impactSpeed = Math.hypot(ball.vx, ball.vy, ball.vz);
    removeBall(ball, 'off-table');
    trace.offTable.push(ball.id);
    if (ball.id === 0) trace.cueScratch = true;
    addContact(trace, { kind: 'off-table', time, impactSpeed, point: { x: ball.x, y: ball.y, z: ball.z }, ballIds: [ball.id] });
  }
}

function snapshotFrame(time: number, balls: BallState[]): PlaybackFrame {
  return {
    time,
    balls: balls.map((ball) => ({
      id: ball.id, x: ball.x, y: ball.y, z: ball.z,
      orientation: { ...ball.orientation }, disposition: ball.disposition
    }))
  };
}

function allStopped(balls: BallState[]): boolean {
  return balls.every((ball) => !active(ball)
    || (Math.hypot(ball.vx, ball.vy) < STOP_SPEED && Math.abs(ball.vz) < STOP_SPEED && ball.z <= BALL_RADIUS + 0.0005));
}

function runSimulation(
  sourceBalls: BallState[],
  shot: ShotInput,
  config: PhysicsConfig,
  maxTime: number,
  frameStep: number,
  sampleUntil = maxTime
): ShotSimulation {
  const balls = cloneBalls(sourceBalls);
  applyStrike(balls, shot);
  const mutable: MutableTrace = {
    firstContact: null, firstContactTime: null, pocketed: [], offTable: [],
    railContacts: new Set(), anyRailAfterContact: false, cueScratch: false, contacts: []
  };
  const frames: PlaybackFrame[] = [snapshotFrame(0, balls)];
  let time = 0;
  let nextFrame = frameStep;
  let stoppedFor = 0;

  while (time < maxTime && stoppedFor < 0.32) {
    const maxSpeed = balls.reduce((max, ball) => active(ball)
      ? Math.max(max, Math.hypot(ball.vx, ball.vy, ball.vz)) : max, 0);
    const substeps = clamp(Math.ceil(maxSpeed * FIXED_STEP / (BALL_RADIUS * 0.36)), 1, 7);
    const dt = FIXED_STEP / substeps;
    for (let substep = 0; substep < substeps; substep += 1) {
      for (const ball of balls) {
        if (!active(ball)) continue;
        applyCloth(ball, dt, config);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        integrateVertical(ball, dt, time, mutable);
        integrateOrientation(ball, dt);
      }
      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) resolveBallCollision(balls[i]!, balls[j]!, time, mutable);
      }
      for (const ball of balls) handlePocketsRailsAndEdges(ball, time, mutable);
      time += dt;
    }
    if (nextFrame <= sampleUntil + 1e-9 && time + 1e-9 >= nextFrame) {
      frames.push(snapshotFrame(time, balls));
      nextFrame += frameStep;
    }
    stoppedFor = allStopped(balls) ? stoppedFor + FIXED_STEP : 0;
  }

  for (const ball of balls) {
    if (!active(ball)) continue;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
    ball.wx = 0; ball.wy = 0; ball.wz = 0;
    ball.z = BALL_RADIUS;
  }
  if (time <= sampleUntil + 1e-9 && frames.at(-1)?.time !== time) frames.push(snapshotFrame(time, balls));
  const trace: ShotTrace = {
    firstContact: mutable.firstContact,
    firstContactTime: mutable.firstContactTime,
    pocketed: mutable.pocketed,
    offTable: mutable.offTable,
    railContacts: [...mutable.railContacts],
    anyRailAfterContact: mutable.anyRailAfterContact,
    cueScratch: mutable.cueScratch,
    contacts: mutable.contacts,
    duration: time
  };
  return { balls, frames, trace };
}

export function simulateShot(sourceBalls: BallState[], shot: ShotInput, config: PhysicsConfig = DEFAULT_CONFIG): ShotSimulation {
  return runSimulation(sourceBalls, shot, config, MAX_SHOT_TIME, FRAME_STEP);
}

function findFrame(frames: PlaybackFrame[], time: number): PlaybackFrame {
  return frames.find((frame) => frame.time >= time) ?? frames.at(-1)!;
}

function trajectoryPoint(frame: PlaybackFrame, id: number): TrajectoryPoint | null {
  const ball = frame.balls.find((entry) => entry.id === id);
  return ball && ball.disposition === 'on-table'
    ? { x: ball.x, y: ball.y, z: ball.z, time: frame.time, airborne: ball.z > BALL_RADIUS + 0.001 }
    : null;
}

function insertTrajectoryPoint(path: TrajectoryPoint[], point: TrajectoryPoint): void {
  const index = path.findIndex((entry) => entry.time > point.time);
  if (index < 0) path.push(point);
  else path.splice(index, 0, point);
}

export function predictTrajectory(
  balls: BallState[],
  shot: ShotInput,
  config: PhysicsConfig | TrajectoryPredictionConfig = DEFAULT_CONFIG
): TrajectoryPreview {
  // Aim prediction only needs the immediate shot window, but samples it more
  // densely than playback. This keeps curves fluid without running an entire
  // potentially 45-second shot for every pointer movement.
  // Continue collecting collisions and pocket contacts until the shot settles,
  // while keeping dense path-frame allocation inside the short visual horizon.
  const simulation = runSimulation(balls, shot, config, MAX_SHOT_TIME, PREVIEW_FRAME_STEP, PREVIEW_SIMULATION_TIME);
  const reboundDepth = 'rebounds' in config ? config.rebounds : 2;
  const impactDepth = 'impacts' in config ? config.impacts : 3;
  const contactTime = simulation.trace.firstContactTime;
  const cutoff = Math.min(PREVIEW_SIMULATION_TIME, simulation.trace.duration);
  const cuePath: TrajectoryPoint[] = [];
  for (const frame of simulation.frames) {
    if (frame.time > cutoff) break;
    const cue = trajectoryPoint(frame, 0);
    if (cue) cuePath.push(cue);
  }

  const activations = new Map<number, { parentBallId: number | null; generation: number; activatedAt: number }>();
  activations.set(0, { parentBallId: null, generation: 0, activatedAt: 0 });
  const impacts: TrajectoryImpact[] = [];
  for (const contact of simulation.trace.contacts.filter((entry) => entry.kind === 'ball-ball').sort((a, b) => a.time - b.time)) {
    const firstId = contact.ballIds[0]; const secondId = contact.ballIds[1];
    if (firstId === undefined || secondId === undefined) continue;
    const first = activations.get(firstId); const second = activations.get(secondId);
    let incomingBallId: number | null = null; let outgoingBallId: number | null = null; let generation = 0;
    if (first && !second && first.generation < impactDepth) {
      incomingBallId = firstId; outgoingBallId = secondId; generation = first.generation + 1;
    } else if (second && !first && second.generation < impactDepth) {
      incomingBallId = secondId; outgoingBallId = firstId; generation = second.generation + 1;
    }
    if (incomingBallId === null || outgoingBallId === null) continue;
    activations.set(outgoingBallId, { parentBallId: incomingBallId, generation, activatedAt: contact.time });
    impacts.push({
      index: impacts.length + 1, generation, time: contact.time, point: { ...contact.point },
      incomingBallId, outgoingBallId
    });
    if (activations.size >= 11) break;
  }

  const clipAtRebounds = (path: TrajectoryPoint[], ballId: number, activatedAt: number): TrajectoryPoint[] => {
    const rails = simulation.trace.contacts.filter((entry) => (entry.kind === 'cushion' || entry.kind === 'jaw')
      && entry.ballIds.includes(ballId) && entry.time >= activatedAt).sort((a, b) => a.time - b.time);
    const nextRail = rails[reboundDepth];
    if (!nextRail) return path;
    return path.filter((point) => point.time <= nextRail.time + PREVIEW_FRAME_STEP);
  };

  const objectPaths: TrajectoryBallPath[] = [...activations.entries()]
    .filter(([ballId, activation]) => ballId !== 0 && activation.generation <= impactDepth)
    .sort(([, first], [, second]) => first.activatedAt - second.activatedAt)
    .slice(0, 10)
    .map(([ballId, activation]) => {
      const points = simulation.frames.flatMap((frame) => {
        if (frame.time + PREVIEW_FRAME_STEP < activation.activatedAt || frame.time > cutoff) return [];
        const point = trajectoryPoint(frame, ballId);
        return point ? [point] : [];
      });
      return {
        ballId, parentBallId: activation.parentBallId, generation: activation.generation,
        activatedAt: activation.activatedAt, points: clipAtRebounds(points, ballId, activation.activatedAt)
      };
    });
  const objectPath = objectPaths[0]?.points ?? [];
  // Frame samples track ball centers. At a rail/jaw event, extend the visual
  // guide to the canonical contact face so it meets the boundary exactly.
  for (const contact of simulation.trace.contacts) {
    if (contact.time > cutoff || (contact.kind !== 'cushion' && contact.kind !== 'jaw')) continue;
    const point: TrajectoryPoint = {
      x: contact.point.x, y: contact.point.y, z: contact.point.z,
      time: contact.time, airborne: false
    };
    if (contact.ballIds.includes(0)) insertTrajectoryPoint(cuePath, point);
    for (const path of objectPaths) {
      if (contact.ballIds.includes(path.ballId) && contact.time <= (path.points.at(-1)?.time ?? -1) + PREVIEW_FRAME_STEP) {
        insertTrajectoryPoint(path.points, point);
      }
    }
  }
  let contactPoint: Vec2 | null = null;
  let ghostBall: Vec2 | null = null;
  if (contactTime !== null && simulation.trace.firstContact !== null) {
    const collision = simulation.trace.contacts.find((entry) => entry.kind === 'ball-ball'
      && entry.ballIds.includes(0) && entry.ballIds.includes(simulation.trace.firstContact!));
    if (collision) {
      contactPoint = { x: collision.point.x, y: collision.point.y };
      const normal = collision.normal ?? { x: 0, y: 0, z: 0 };
      const cueIsFirst = collision.ballIds[0] === 0;
      const cueDirection = cueIsFirst ? -1 : 1;
      const cueImpact: TrajectoryPoint = {
        x: collision.point.x + normal.x * BALL_RADIUS * cueDirection,
        y: collision.point.y + normal.y * BALL_RADIUS * cueDirection,
        z: collision.point.z + normal.z * BALL_RADIUS * cueDirection,
        time: collision.time,
        airborne: collision.point.z + normal.z * BALL_RADIUS * cueDirection > BALL_RADIUS + 0.001
      };
      ghostBall = { x: cueImpact.x, y: cueImpact.y };
      insertTrajectoryPoint(cuePath, cueImpact);
      const objectDirection = -cueDirection;
      insertTrajectoryPoint(objectPath, {
        x: collision.point.x + normal.x * BALL_RADIUS * objectDirection,
        y: collision.point.y + normal.y * BALL_RADIUS * objectDirection,
        z: collision.point.z + normal.z * BALL_RADIUS * objectDirection,
        time: collision.time,
        airborne: collision.point.z + normal.z * BALL_RADIUS * objectDirection > BALL_RADIUS + 0.001
      });
    } else {
      const cue = trajectoryPoint(findFrame(simulation.frames, contactTime), 0);
      if (cue) ghostBall = { x: cue.x, y: cue.y };
    }
  }
  return {
    cuePath: clipAtRebounds(cuePath, 0, 0), objectPath, contactPoint, ghostBall,
    objectBallId: simulation.trace.firstContact,
    objectPaths,
    impacts,
    // Pocket contacts include the full settled shot even though visual paths
    // intentionally stop at the short, densely sampled preview horizon.
    contacts: simulation.trace.contacts
  };
}
