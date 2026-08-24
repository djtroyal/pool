import { BALL_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import { POCKETS } from './geometry.js';
import { simulateShot } from './physics.js';
import { callRequirement, groupForBall, resolveShot } from './rules.js';
import type {
  BallGroup,
  BallState,
  CalledShot,
  GameSnapshot,
  OptimizedPot,
  OptimizedShotLine,
  ShotInput,
  ShotOptimizerProgress,
  ShotOptimizerRequest,
  ShotOptimizerResult,
  ShotOptimizerTarget,
  ShotSimulation,
  SpinInput,
  Vec2
} from './types.js';

interface SearchProfile {
  first: number;
  leaves: number;
  follow: number;
  validation: number;
  techniques: boolean;
}

const SEARCH_PROFILES: Record<ShotOptimizerRequest['quality'], SearchProfile> = {
  fast: { first: 160, leaves: 2, follow: 48, validation: 4, techniques: false },
  balanced: { first: 352, leaves: 4, follow: 96, validation: 8, techniques: true },
  deep: { first: 768, leaves: 8, follow: 192, validation: 12, techniques: true }
};

const FOUL_EVENTS = new Set([
  'scratch', 'ball-off-table', 'wrong-first-ball', 'no-rail-or-pocket', 'illegal-break', 'call-missed', 'call-required'
]);

interface EvaluatedShot {
  shot: ShotInput;
  after: GameSnapshot;
  target: ShotOptimizerTarget;
  provisional: boolean;
  pots: OptimizedPot[];
  ownedPots: number[];
  opponentPots: number[];
  rackWin: boolean;
  continues: boolean;
  opportunity: number;
}

interface SearchContext {
  request: ShotOptimizerRequest;
  profile: SearchProfile;
  evaluated: number;
  total: number;
  bestNow: number;
  bestNext: number;
  progress?: ((progress: ShotOptimizerProgress) => void) | undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle: number): number {
  const turn = Math.PI * 2;
  return ((angle + Math.PI) % turn + turn) % turn - Math.PI;
}

function quantizeShot(shot: ShotInput, revision: number): ShotInput {
  let side = Math.round(clamp(shot.english.side, -1, 1) * 100) / 100;
  let vertical = Math.round(clamp(shot.english.vertical, -1, 1) * 100) / 100;
  const spinLength = Math.hypot(side, vertical);
  if (spinLength > 1) {
    side = Math.round(side / spinLength * 100) / 100;
    vertical = Math.round(vertical / spinLength * 100) / 100;
  }
  return {
    revision,
    angle: Math.round(normalizeAngle(shot.angle) * 180 / Math.PI * 10) / 10 * Math.PI / 180,
    power: Math.round(clamp(shot.power, 0.04, 1) * 100) / 100,
    elevation: Math.round(clamp(shot.elevation, 0, 75)),
    english: { side, vertical },
    calledShot: shot.calledShot ?? null,
    shotKind: 'normal'
  };
}

function shotKey(shot: ShotInput): string {
  return [shot.angle.toFixed(6), shot.power.toFixed(2), shot.elevation.toFixed(0),
    shot.english.side.toFixed(2), shot.english.vertical.toFixed(2)].join('|');
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function practiceStateFingerprint(game: GameSnapshot): string {
  const balls = [...game.balls].sort((a, b) => a.id - b.id).map((ball) => [
    ball.id, ball.disposition, ball.x.toFixed(6), ball.y.toFixed(6), ball.z.toFixed(6)
  ].join(':')).join(';');
  return hashString([
    game.revision, game.phase, game.turnIndex, game.tableOpen ? 1 : 0, game.breakShot ? 1 : 0,
    game.ballInHand ? 1 : 0, game.groups[0] ?? '-', game.groups[1] ?? '-', balls
  ].join('|'));
}

function normalizePracticeOutcome(after: GameSnapshot, sandbox: boolean): GameSnapshot {
  return sandbox
    ? { ...after, phase: 'aiming', turnIndex: 0, winnerIndex: null, scores: [0, 0], shotClockEndsAt: null }
    : after;
}

function cueBall(game: GameSnapshot): BallState | null {
  return game.balls.find((ball) => ball.id === 0 && ball.disposition === 'on-table') ?? null;
}

function onTableObjects(game: GameSnapshot): BallState[] {
  return game.balls.filter((ball) => ball.id > 0 && ball.disposition === 'on-table');
}

function legalTargets(game: GameSnapshot, forcedTarget?: ShotOptimizerTarget): BallState[] {
  const objects = onTableObjects(game);
  if (game.mode === 'nine-ball' || forcedTarget === 'rotation') {
    const lowest = Math.min(...objects.map((ball) => ball.id));
    return objects.filter((ball) => ball.id === lowest);
  }
  const group = forcedTarget === 'solids' || forcedTarget === 'stripes'
    ? forcedTarget
    : game.groups[game.turnIndex];
  if (!game.tableOpen && group) {
    const owned = objects.filter((ball) => groupForBall(ball.id) === group);
    return owned.length ? owned : objects.filter((ball) => ball.id === 8);
  }
  return objects.filter((ball) => ball.id !== 8);
}

function potEvents(simulation: ShotSimulation): OptimizedPot[] {
  return simulation.trace.contacts.flatMap((contact) => {
    const ballId = contact.kind === 'pocket' ? contact.ballIds.find((id) => id > 0) : undefined;
    return ballId === undefined || !contact.surfaceId
      ? []
      : [{ ballId, pocketId: contact.surfaceId, time: contact.time }];
  });
}

function deriveCall(game: GameSnapshot, simulation: ShotSimulation): CalledShot | null {
  const requirement = callRequirement(game);
  if (requirement === 'none') return null;
  const pots = potEvents(simulation);
  if (requirement === 'eight-only') {
    const eight = pots.find((pot) => pot.ballId === 8);
    return eight ? { ballId: 8, pocketId: eight.pocketId } : { ballId: 8, pocketId: '' };
  }
  const group = game.groups[game.turnIndex];
  const called = pots.find((pot) => game.mode === 'nine-ball'
    || game.tableOpen ? pot.ballId !== 8 : groupForBall(pot.ballId) === group);
  return called ? { ballId: called.ballId, pocketId: called.pocketId } : null;
}

function groupCounts(ids: number[], group: BallGroup): number[] {
  return ids.filter((id) => groupForBall(id) === group);
}

function shotTargets(
  game: GameSnapshot,
  rawAfter: GameSnapshot,
  simulation: ShotSimulation,
  forcedTarget?: ShotOptimizerTarget
): Array<{ target: ShotOptimizerTarget; provisional: boolean; owned: number[]; opponent: number[] }> {
  const objectPots = simulation.trace.pocketed.filter((id) => id > 0);
  if (game.mode === 'nine-ball' || forcedTarget === 'rotation') {
    return [{ target: 'rotation', provisional: false, owned: objectPots, opponent: [] }];
  }
  const assigned = game.groups[game.turnIndex];
  if (assigned) {
    return [{
      target: assigned, provisional: false,
      owned: groupCounts(objectPots, assigned),
      opponent: groupCounts(objectPots, assigned === 'solids' ? 'stripes' : 'solids')
    }];
  }
  const resultGroup = rawAfter.groups[game.turnIndex];
  if (resultGroup) {
    if (forcedTarget && forcedTarget !== resultGroup) return [];
    return [{
      target: resultGroup, provisional: false,
      owned: groupCounts(objectPots, resultGroup),
      opponent: groupCounts(objectPots, resultGroup === 'solids' ? 'stripes' : 'solids')
    }];
  }
  const groups: BallGroup[] = forcedTarget === 'solids' || forcedTarget === 'stripes'
    ? [forcedTarget]
    : ['solids', 'stripes'];
  const provisional = game.breakShot;
  const mixed = new Set(objectPots.map(groupForBall).filter(Boolean)).size > 1;
  return groups.map((group) => ({
    target: group,
    provisional,
    owned: !game.breakShot && mixed ? [] : groupCounts(objectPots, group),
    opponent: groupCounts(objectPots, group === 'solids' ? 'stripes' : 'solids')
  }));
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function clearSegment(game: GameSnapshot, a: Vec2, b: Vec2, excluded: Set<number>): boolean {
  return game.balls.every((ball) => ball.disposition !== 'on-table' || excluded.has(ball.id)
    || distanceToSegment(ball, a, b) > BALL_RADIUS * 2.02);
}

function opportunityScore(game: GameSnapshot, target: ShotOptimizerTarget): number {
  const cue = cueBall(game);
  if (!cue) return -100;
  let count = 0;
  for (const object of legalTargets(game, target)) {
    for (const pocket of POCKETS) {
      const pdx = pocket.center.x - object.x; const pdy = pocket.center.y - object.y;
      const length = Math.hypot(pdx, pdy) || 1;
      const ghost = { x: object.x - pdx / length * BALL_RADIUS * 2, y: object.y - pdy / length * BALL_RADIUS * 2 };
      if (ghost.x < BALL_RADIUS || ghost.x > TABLE_WIDTH - BALL_RADIUS
        || ghost.y < BALL_RADIUS || ghost.y > TABLE_HEIGHT - BALL_RADIUS) continue;
      if (clearSegment(game, object, pocket.center, new Set([object.id]))
        && clearSegment(game, cue, ghost, new Set([0, object.id]))) count += 1;
    }
  }
  return count;
}

function evaluateShot(
  game: GameSnapshot,
  input: ShotInput,
  request: ShotOptimizerRequest,
  forcedTarget?: ShotOptimizerTarget
): EvaluatedShot[] {
  const baseShot = quantizeShot(input, game.revision);
  const simulation = simulateShot(game.balls, baseShot, request.config);
  const calledShot = deriveCall(game, simulation);
  const shot = { ...baseShot, calledShot };
  const rawAfter = resolveShot(game, simulation, shot);
  const foul = rawAfter.lastEvents.some((entry) => FOUL_EVENTS.has(entry.code));
  const rackLoss = rawAfter.phase === 'rack-over' && rawAfter.winnerIndex !== game.turnIndex;
  if (foul || rackLoss) return [];
  const rackWin = rawAfter.phase === 'rack-over' && rawAfter.winnerIndex === game.turnIndex;
  const after = normalizePracticeOutcome(rawAfter, request.sandbox);
  const continues = !rackWin && (request.sandbox
    || (rawAfter.phase === 'aiming' && rawAfter.turnIndex === game.turnIndex && !rawAfter.ballInHand));
  const pots = potEvents(simulation);
  return shotTargets(game, rawAfter, simulation, forcedTarget).map((target) => ({
    shot, after, target: target.target, provisional: target.provisional,
    pots, ownedPots: target.owned, opponentPots: target.opponent, rackWin, continues,
    opportunity: continues ? opportunityScore(after, target.target) : -100
  }));
}

function controlCost(shot: ShotInput): number {
  return shot.power * 0.35 + Math.hypot(shot.english.side, shot.english.vertical) * 0.35 + shot.elevation / 75 * 0.3;
}

function compareImmediate(a: EvaluatedShot, b: EvaluatedShot): number {
  return Number(a.rackWin) - Number(b.rackWin)
    || a.ownedPots.length - b.ownedPots.length
    || Number(a.continues) - Number(b.continues)
    || b.opponentPots.length - a.opponentPots.length
    || a.opportunity - b.opportunity
    || controlCost(b.shot) - controlCost(a.shot);
}

function directShot(game: GameSnapshot, target: BallState, pocket: Vec2, power: number, english: SpinInput, elevation = 0): ShotInput | null {
  const cue = cueBall(game);
  if (!cue) return null;
  const dx = pocket.x - target.x; const dy = pocket.y - target.y;
  const length = Math.hypot(dx, dy) || 1;
  const ghost = { x: target.x - dx / length * BALL_RADIUS * 2, y: target.y - dy / length * BALL_RADIUS * 2 };
  return quantizeShot({
    revision: game.revision,
    angle: Math.atan2(ghost.y - cue.y, ghost.x - cue.x), power, elevation, english
  }, game.revision);
}

function estimatedPower(cue: BallState, target: BallState, pocket: Vec2): number {
  const travel = Math.hypot(target.x - cue.x, target.y - cue.y) + Math.hypot(pocket.x - target.x, pocket.y - target.y);
  return clamp(0.18 + travel / (TABLE_WIDTH * 1.8) * 0.62, 0.2, 0.88);
}

function structuredSeeds(game: GameSnapshot, target: ShotOptimizerTarget | undefined, profile: SearchProfile): ShotInput[] {
  const cue = cueBall(game);
  if (!cue) return [];
  const seeds: ShotInput[] = [];
  const targets = legalTargets(game, target);
  const spinVariants: SpinInput[] = profile.techniques
    ? [{ side: 0, vertical: 0 }, { side: 0, vertical: 0.38 }, { side: 0, vertical: -0.38 }, { side: 0.34, vertical: 0 }, { side: -0.34, vertical: 0 }]
    : [{ side: 0, vertical: 0 }];
  for (const object of targets) {
    for (const pocket of POCKETS) {
      const power = estimatedPower(cue, object, pocket.center);
      for (const english of spinVariants) {
        const candidate = directShot(game, object, pocket.center, power, english);
        if (candidate) seeds.push(candidate);
      }
      if (!profile.techniques) continue;
      for (const boundary of ['left', 'right', 'top', 'bottom'] as const) {
        const reflected = boundary === 'left' ? { x: -pocket.center.x, y: pocket.center.y }
          : boundary === 'right' ? { x: TABLE_WIDTH * 2 - pocket.center.x, y: pocket.center.y }
            : boundary === 'top' ? { x: pocket.center.x, y: -pocket.center.y }
              : { x: pocket.center.x, y: TABLE_HEIGHT * 2 - pocket.center.y };
        const bank = directShot(game, object, reflected, clamp(power + 0.16, 0.28, 1), { side: 0, vertical: 0.1 });
        if (bank) seeds.push(bank);
      }
      const base = directShot(game, object, pocket.center, clamp(power + 0.18, 0.36, 1), { side: 0, vertical: 0 }, 38);
      if (base) seeds.push(base);
      const directAngle = base?.angle ?? Math.atan2(object.y - cue.y, object.x - cue.x);
      for (const sign of [-1, 1]) {
        seeds.push(quantizeShot({
          revision: game.revision, angle: directAngle + sign * 22 * Math.PI / 180,
          power: clamp(power + 0.14, 0.35, 0.94), elevation: 56,
          english: { side: -sign * 0.88, vertical: -0.18 }
        }, game.revision));
      }
    }
  }
  if (profile.techniques) {
    const objects = onTableObjects(game);
    for (const first of targets) {
      for (const second of objects) {
        if (first.id === second.id) continue;
        for (const pocket of POCKETS) {
          const pdx = pocket.center.x - second.x; const pdy = pocket.center.y - second.y;
          const pocketLength = Math.hypot(pdx, pdy) || 1;
          const secondGhost = { x: second.x - pdx / pocketLength * BALL_RADIUS * 2, y: second.y - pdy / pocketLength * BALL_RADIUS * 2 };
          const fdx = secondGhost.x - first.x; const fdy = secondGhost.y - first.y;
          const firstLength = Math.hypot(fdx, fdy) || 1;
          const firstGhost = { x: first.x - fdx / firstLength * BALL_RADIUS * 2, y: first.y - fdy / firstLength * BALL_RADIUS * 2 };
          seeds.push(quantizeShot({
            revision: game.revision, angle: Math.atan2(firstGhost.y - cue.y, firstGhost.x - cue.x),
            power: clamp(estimatedPower(cue, first, pocket.center) + 0.14, 0.3, 1), elevation: 0,
            english: { side: 0, vertical: 0.12 }
          }, game.revision));
        }
      }
    }
  }
  return seeds;
}

function halton(index: number, base: number): number {
  let result = 0; let fraction = 1 / base; let value = index;
  while (value > 0) { result += fraction * (value % base); value = Math.floor(value / base); fraction /= base; }
  return result;
}

function globalShot(game: GameSnapshot, index: number): ShotInput {
  const spinRadius = Math.sqrt(halton(index, 5));
  const spinAngle = halton(index, 7) * Math.PI * 2;
  const elevationSample = halton(index, 11);
  return quantizeShot({
    revision: game.revision,
    angle: halton(index, 2) * Math.PI * 2 - Math.PI,
    power: 0.04 + halton(index, 3) * 0.96,
    elevation: elevationSample < 0.42 ? 0 : (elevationSample - 0.42) / 0.58 * 75,
    english: { side: Math.cos(spinAngle) * spinRadius, vertical: Math.sin(spinAngle) * spinRadius }
  }, game.revision);
}

function mutateShot(game: GameSnapshot, base: ShotInput, index: number, progress: number): ShotInput {
  const scale = 1 - progress * 0.82;
  const centered = (value: number) => value * 2 - 1;
  return quantizeShot({
    revision: game.revision,
    angle: base.angle + centered(halton(index, 2)) * (1.8 * scale + 0.12) * Math.PI / 180,
    power: base.power + centered(halton(index, 3)) * (0.14 * scale + 0.01),
    elevation: base.elevation + centered(halton(index, 5)) * (16 * scale + 1),
    english: {
      side: base.english.side + centered(halton(index, 7)) * (0.4 * scale + 0.02),
      vertical: base.english.vertical + centered(halton(index, 11)) * (0.4 * scale + 0.02)
    }
  }, game.revision);
}

function evenlyTake<T>(values: T[], count: number): T[] {
  if (values.length <= count) return values;
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * values.length / count)]!);
}

function report(context: SearchContext, phase: ShotOptimizerProgress['phase']): void {
  context.progress?.({
    phase, evaluated: context.evaluated, total: context.total,
    bestNow: context.bestNow, bestNext: context.bestNext
  });
}

function runSearch(
  game: GameSnapshot,
  budget: number,
  forcedTarget: ShotOptimizerTarget | undefined,
  context: SearchContext,
  phase: ShotOptimizerProgress['phase'],
  initialShot?: ShotInput
): EvaluatedShot[] {
  const seen = new Set<string>();
  const evaluated: EvaluatedShot[] = [];
  const baseBudget = Math.max(24, Math.floor(budget * 0.62));
  const structured = structuredSeeds(game, forcedTarget, context.profile);
  const candidates: ShotInput[] = [];
  if (initialShot) candidates.push(quantizeShot(initialShot, game.revision));
  candidates.push(...evenlyTake(structured, Math.floor(baseBudget * 0.7)));
  for (let index = 1; candidates.length < baseBudget; index += 1) candidates.push(globalShot(game, index));

  const evaluate = (candidate: ShotInput) => {
    const key = shotKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    const results = evaluateShot(game, candidate, context.request, forcedTarget);
    evaluated.push(...results);
    context.evaluated += 1;
    for (const result of results) {
      if (phase === 'first-shot') context.bestNow = Math.max(context.bestNow, result.ownedPots.length);
      else context.bestNext = Math.max(context.bestNext, result.ownedPots.length);
    }
    if (context.evaluated % 8 === 0) report(context, phase);
  };

  for (const candidate of candidates) evaluate(candidate);
  let mutationIndex = 1;
  while (seen.size < budget) {
    const beam = [...evaluated].sort((a, b) => compareImmediate(b, a)).slice(0, 14);
    const base = beam[(mutationIndex - 1) % Math.max(1, beam.length)]?.shot ?? globalShot(game, mutationIndex);
    evaluate(mutateShot(game, base, mutationIndex, seen.size / budget));
    mutationIndex += 1;
    if (mutationIndex > budget * 20) break;
  }
  report(context, phase);
  return evaluated;
}

function uniqueLeaves(candidates: EvaluatedShot[], count: number): EvaluatedShot[] {
  const sorted = [...candidates].sort((a, b) => compareImmediate(b, a));
  const wins = sorted.filter((candidate) => candidate.rackWin);
  if (wins.length) return wins.slice(0, 1);
  const maxPots = sorted[0]?.ownedPots.length ?? 0;
  const selected: EvaluatedShot[] = [];
  const bins = new Set<string>();
  for (const candidate of sorted.filter((entry) => entry.ownedPots.length === maxPots && entry.continues)) {
    const cue = cueBall(candidate.after);
    const bin = cue ? `${candidate.target}:${Math.round(cue.x / 0.12)}:${Math.round(cue.y / 0.12)}` : `${candidate.target}:none`;
    if (bins.has(bin)) continue;
    bins.add(bin); selected.push(candidate);
    if (selected.length >= count) break;
  }
  if (!selected.length && sorted[0]) selected.push(sorted[0]);
  return selected;
}

function lineFromEvaluation(candidate: EvaluatedShot): OptimizedShotLine {
  return {
    shot: candidate.shot,
    pots: candidate.pots,
    ownedPots: candidate.ownedPots,
    opponentPots: candidate.opponentPots,
    rackWin: candidate.rackWin,
    afterFingerprint: practiceStateFingerprint(candidate.after)
  };
}

function comparePair(
  firstA: EvaluatedShot,
  secondA: EvaluatedShot | null,
  firstB: EvaluatedShot,
  secondB: EvaluatedShot | null
): number {
  return Number(firstA.rackWin) - Number(firstB.rackWin)
    || firstA.ownedPots.length - firstB.ownedPots.length
    || Number(secondA?.rackWin ?? false) - Number(secondB?.rackWin ?? false)
    || (secondA?.ownedPots.length ?? 0) - (secondB?.ownedPots.length ?? 0)
    || firstB.opponentPots.length - firstA.opponentPots.length
    || (secondB?.opponentPots.length ?? 0) - (secondA?.opponentPots.length ?? 0)
    || firstA.opportunity - firstB.opportunity
    || controlCost(firstB.shot) - controlCost(firstA.shot);
}

function perturbation(base: ShotInput, index: number): ShotInput {
  const variants = [
    { angle: 0.1 * Math.PI / 180 }, { angle: -0.1 * Math.PI / 180 },
    { power: 0.01 }, { power: -0.01 },
    { side: 0.02 }, { side: -0.02 },
    { vertical: 0.02 }, { vertical: -0.02 },
    { elevation: 1 }, { elevation: -1 }
  ];
  const delta = variants[index % variants.length]!;
  return {
    ...base,
    angle: base.angle + (delta.angle ?? 0),
    power: base.power + (delta.power ?? 0),
    elevation: base.elevation + (delta.elevation ?? 0),
    english: {
      side: base.english.side + (delta.side ?? 0),
      vertical: base.english.vertical + (delta.vertical ?? 0)
    }
  };
}

function robustness(
  first: EvaluatedShot,
  second: EvaluatedShot | null,
  context: SearchContext
): number {
  let preserved = 0;
  for (let index = 0; index < context.profile.validation; index += 1) {
    const firstVariants = evaluateShot(context.request.game, perturbation(first.shot, index), context.request, first.target);
    context.evaluated += 1;
    const matchingFirst = firstVariants.sort((a, b) => compareImmediate(b, a))[0];
    if (!matchingFirst || matchingFirst.ownedPots.length < first.ownedPots.length) {
      report(context, 'validating');
      continue;
    }
    if (second) {
      const nextShot = { ...second.shot, revision: matchingFirst.after.revision };
      const secondVariants = evaluateShot(matchingFirst.after, nextShot, context.request, first.target);
      context.evaluated += 1;
      const matchingSecond = secondVariants.sort((a, b) => compareImmediate(b, a))[0];
      if (!matchingSecond || matchingSecond.ownedPots.length < second.ownedPots.length) {
        report(context, 'validating');
        continue;
      }
    }
    preserved += 1;
    report(context, 'validating');
  }
  return Math.round(preserved / context.profile.validation * 100);
}

export function optimizePracticeShot(
  request: ShotOptimizerRequest,
  onProgress?: (progress: ShotOptimizerProgress) => void
): ShotOptimizerResult | null {
  if (request.game.phase !== 'aiming' || request.game.ballInHand || !cueBall(request.game)) return null;
  const profile = SEARCH_PROFILES[request.quality];
  const context: SearchContext = {
    request, profile, evaluated: 0,
    total: profile.first + profile.leaves * profile.follow + profile.validation * 2,
    bestNow: 0, bestNext: 0, progress: onProgress
  };
  const firstCandidates = runSearch(request.game, profile.first, undefined, context, 'first-shot', request.initialShot);
  const leaves = uniqueLeaves(firstCandidates, profile.leaves);
  if (!leaves.length) return null;
  const pairs: Array<{ first: EvaluatedShot; second: EvaluatedShot | null }> = [];
  for (const first of leaves) {
    if (first.rackWin || !first.continues) { pairs.push({ first, second: null }); continue; }
    const followCandidates = runSearch(first.after, profile.follow, first.target, context, 'follow-up');
    const second = followCandidates.sort((a, b) => compareImmediate(b, a))[0] ?? null;
    pairs.push({ first, second });
  }
  pairs.sort((a, b) => comparePair(b.first, b.second, a.first, a.second));
  const leading = pairs[0];
  if (!leading) return null;
  const sameObjective = (candidate: typeof leading) => candidate.first.rackWin === leading.first.rackWin
    && candidate.first.ownedPots.length === leading.first.ownedPots.length
    && Boolean(candidate.second?.rackWin) === Boolean(leading.second?.rackWin)
    && (candidate.second?.ownedPots.length ?? 0) === (leading.second?.ownedPots.length ?? 0)
    && candidate.first.opponentPots.length === leading.first.opponentPots.length
    && (candidate.second?.opponentPots.length ?? 0) === (leading.second?.opponentPots.length ?? 0);
  const validated = pairs.filter(sameObjective).slice(0, 3).map((pair) => ({
    ...pair,
    robustness: robustness(pair.first, pair.second, context)
  })).sort((a, b) => b.robustness - a.robustness || comparePair(b.first, b.second, a.first, a.second));
  const winner = validated[0] ?? { ...leading, robustness: robustness(leading.first, leading.second, context) };
  return {
    quality: request.quality,
    target: winner.first.target,
    provisionalTarget: winner.first.provisional,
    primary: lineFromEvaluation(winner.first),
    followUp: winner.second ? lineFromEvaluation(winner.second) : null,
    robustness: winner.robustness,
    evaluated: context.evaluated
  };
}
