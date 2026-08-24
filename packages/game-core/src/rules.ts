import type {
  BallGroup,
  BallState,
  CalledShot,
  GameSnapshot,
  RuleEvent,
  ShotInput,
  ShotSimulation
} from './types.js';
import { findRespotPosition, resetBall } from './rack.js';

function otherPlayer(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

export function groupForBall(id: number): BallGroup | null {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null;
}

function remainingInGroup(balls: BallState[], group: BallGroup): number[] {
  return balls
    .filter((ball) => ball.disposition === 'on-table' && groupForBall(ball.id) === group)
    .map((ball) => ball.id);
}

function lowestNineBall(balls: BallState[]): number | null {
  return balls
    .filter((ball) => ball.disposition === 'on-table' && ball.id > 0)
    .reduce<number | null>((lowest, ball) => lowest === null || ball.id < lowest ? ball.id : lowest, null);
}

function respot(balls: BallState[], id: number): BallState[] {
  const ball = balls.find((entry) => entry.id === id);
  if (!ball) return balls;
  const withoutTarget = balls.map((entry) => entry.id === id ? { ...entry, disposition: 'pocketed' as const } : entry);
  const point = findRespotPosition(withoutTarget);
  return balls.map((entry) => entry.id === id ? resetBall(entry, point.x, point.y) : entry);
}

function event(code: RuleEvent['code'], message: string, playerIndex?: number, ballId?: number): RuleEvent {
  return { code, message, playerIndex, ballId };
}

function updatedPocketedOrder(game: GameSnapshot, balls: BallState[], newlyPocketed: number[]): number[] {
  const order = [...game.pocketedOrder];
  for (const id of newlyPocketed) if (id !== 0 && !order.includes(id)) order.push(id);
  return order.filter((id) => balls.some((ball) => ball.id === id && ball.disposition === 'pocketed'));
}

function pocketForBall(simulation: ShotSimulation, ballId: number): string | null {
  return simulation.trace.contacts.find((contact) => contact.kind === 'pocket' && contact.ballIds.includes(ballId))?.surfaceId ?? null;
}

export function callRequirement(game: GameSnapshot): 'none' | 'eight-only' | 'all-shots' {
  if (game.breakShot) return 'none';
  if (game.mode === 'nine-ball') return game.ruleset === 'house' && game.houseCallMode === 'all-shots' ? 'all-shots' : 'none';
  if (game.ruleset === 'wpa' || game.ruleset === 'csi-bca' || game.houseCallMode === 'all-shots') return 'all-shots';
  const shooterGroup = game.groups[game.turnIndex];
  return shooterGroup && remainingInGroup(game.balls, shooterGroup).length === 0 ? 'eight-only' : 'none';
}

export function calledShotIsValid(game: GameSnapshot, call: CalledShot | null | undefined): boolean {
  const requirement = callRequirement(game);
  if (requirement === 'none') return true;
  if (!call || !/^((top|bottom)-(left|right|side)-pocket)$/.test(call.pocketId)) return false;
  if (requirement === 'eight-only') return call.ballId === 8;
  const target = game.balls.find((ball) => ball.id === call.ballId && ball.disposition === 'on-table');
  if (!target || call.ballId === 0) return false;
  if (game.mode === 'eight-ball' && !game.tableOpen) {
    const group = game.groups[game.turnIndex];
    const remaining = group ? remainingInGroup(game.balls, group) : [];
    return remaining.length === 0 ? call.ballId === 8 : groupForBall(call.ballId) === group;
  }
  return game.mode !== 'eight-ball' || call.ballId !== 8;
}

function callOutcome(game: GameSnapshot, simulation: ShotSimulation, shot?: ShotInput): { required: boolean; made: boolean; call: CalledShot | null } {
  const required = Boolean(shot) && callRequirement(game) !== 'none';
  const call = shot?.calledShot ?? null;
  return { required, call, made: Boolean(call && pocketForBall(simulation, call.ballId) === call.pocketId) };
}

function awardRack(game: GameSnapshot, winner: 0 | 1, balls: BallState[], events: RuleEvent[], newlyPocketed: number[]): GameSnapshot {
  const scores: [number, number] = [...game.scores];
  scores[winner] += 1;
  events.push(event('rack-won', `Player ${winner + 1} wins the rack.`, winner));
  return {
    ...game,
    revision: game.revision + 1,
    phase: 'rack-over',
    balls,
    pocketedOrder: updatedPocketedOrder(game, balls, newlyPocketed),
    scores,
    winnerIndex: winner,
    ballInHand: false,
    placement: null,
    breakShot: false,
    pushOutAvailable: false,
    pushOutReturnTo: null,
    shotNumber: game.shotNumber + 1,
    shotClockEndsAt: null,
    lastEvents: events
  };
}

function resolveEightBall(game: GameSnapshot, simulation: ShotSimulation, shot?: ShotInput): GameSnapshot {
  const shooter = game.turnIndex;
  const opponent = otherPlayer(shooter);
  let balls = simulation.balls.map((ball) => ({ ...ball }));
  const trace = simulation.trace;
  const events: RuleEvent[] = [];
  const objectPockets = trace.pocketed.filter((id) => id !== 0);
  const eightPocketed = objectPockets.includes(8);
  const eightOffTable = trace.offTable.includes(8);
  const breakLegal = objectPockets.length > 0 || trace.railContacts.length >= 4;
  const shooterGroup = game.groups[shooter];
  const eligibleForEight = shooterGroup !== null && remainingInGroup(game.balls, shooterGroup).length === 0;
  const called = callOutcome(game, simulation, shot);

  let firstContactLegal = trace.firstContact !== null;
  if (!game.breakShot && trace.firstContact !== null) {
    if (game.tableOpen) firstContactLegal = trace.firstContact !== 8;
    else if (eligibleForEight) firstContactLegal = trace.firstContact === 8;
    else firstContactLegal = groupForBall(trace.firstContact) === shooterGroup;
  }

  let foul = trace.cueScratch || trace.offTable.some((id) => id !== 0) || !firstContactLegal || (!trace.anyRailAfterContact && objectPockets.length === 0);
  if (game.breakShot && !breakLegal) {
    foul = true;
    events.push(event('illegal-break', 'Illegal break: pocket a ball or drive four object balls to rails.', shooter));
  } else if (game.breakShot) {
    events.push(event('legal-break', 'Legal break.', shooter));
  }
  if (trace.cueScratch) events.push(event('scratch', 'Scratch. Opponent has ball in hand.', shooter, 0));
  for (const id of trace.offTable.filter((entry) => entry !== 0)) events.push(event('ball-off-table', `Ball ${id} left the table.`, shooter, id));
  if (!firstContactLegal) events.push(event('wrong-first-ball', 'The cue ball did not contact a legal object ball first.', shooter, trace.firstContact ?? undefined));
  if (firstContactLegal && !trace.anyRailAfterContact && objectPockets.length === 0) {
    events.push(event('no-rail-or-pocket', 'No ball reached a rail or pocket after contact.', shooter));
  }

  if ((eightPocketed || eightOffTable) && game.breakShot) {
    balls = respot(balls, 8);
    events.push(event('eight-respotted', 'The 8 ball is respotted after the break.', shooter, 8));
  } else if (eightPocketed || eightOffTable) {
    if (foul || !eligibleForEight || trace.firstContact !== 8 || (called.required && (!called.made || called.call?.ballId !== 8))) {
      if (called.required && !called.made) events.push(event('call-missed', 'The 8-ball dropped in an uncalled pocket.', shooter, 8));
      return awardRack(game, opponent, balls, events, trace.pocketed);
    }
    if (called.required) events.push(event('call-made', 'Called 8-ball pocket made.', shooter, 8));
    return awardRack(game, shooter, balls, events, trace.pocketed);
  }

  if (!foul && called.required) events.push(event(called.made ? 'call-made' : 'call-missed', called.made ? 'Called pocket made.' : 'The called shot was not made.', shooter, called.call?.ballId));

  let groups: GameSnapshot['groups'] = [...game.groups];
  let tableOpen = game.tableOpen;
  if (!foul && !game.breakShot && game.tableOpen) {
    const assignmentPockets = called.required ? objectPockets.filter((id) => called.made && id === called.call?.ballId) : objectPockets;
    const pocketGroups = new Set(assignmentPockets.map(groupForBall).filter((group): group is BallGroup => group !== null));
    if (pocketGroups.size === 1) {
      const group = [...pocketGroups][0]!;
      groups = shooter === 0 ? [group, group === 'solids' ? 'stripes' : 'solids'] : [group === 'solids' ? 'stripes' : 'solids', group];
      tableOpen = false;
      events.push(event('groups-assigned', `${group === 'solids' ? 'Solids' : 'Stripes'} assigned to Player ${shooter + 1}.`, shooter));
    }
  }

  if (foul) {
    events.push(event('ball-in-hand', `Player ${opponent + 1} has ball in hand.`, opponent));
    return {
      ...game,
      revision: game.revision + 1,
      balls,
      pocketedOrder: updatedPocketedOrder(game, balls, trace.pocketed),
      turnIndex: opponent,
      groups,
      tableOpen,
      breakShot: false,
      ballInHand: true,
      placement: 'anywhere',
      shotNumber: game.shotNumber + 1,
      pushOutAvailable: false,
      pushOutReturnTo: null,
      shotClockEndsAt: null,
      lastEvents: events
    };
  }

  const assignedGroup = groups[shooter];
  const normalKeepTurn = game.breakShot
    ? objectPockets.length > 0
    : tableOpen
      ? objectPockets.some((id) => groupForBall(id) !== null)
      : objectPockets.some((id) => groupForBall(id) === assignedGroup);
  const keepTurn = called.required ? called.made && normalKeepTurn : normalKeepTurn;
  const nextTurn = keepTurn ? shooter : opponent;
  events.push(event(keepTurn ? 'turn-continues' : 'turn-changes', keepTurn ? `Player ${shooter + 1} continues.` : `Player ${opponent + 1}'s turn.`, nextTurn));
  return {
    ...game,
    revision: game.revision + 1,
    balls,
    pocketedOrder: updatedPocketedOrder(game, balls, trace.pocketed),
    turnIndex: nextTurn,
    groups,
    tableOpen,
    breakShot: false,
    ballInHand: false,
    placement: null,
    shotNumber: game.shotNumber + 1,
    pushOutAvailable: false,
    pushOutReturnTo: null,
    shotClockEndsAt: null,
    lastEvents: events
  };
}

function resolveNineBall(game: GameSnapshot, simulation: ShotSimulation, shot?: ShotInput): GameSnapshot {
  const shooter = game.turnIndex;
  const opponent = otherPlayer(shooter);
  let balls = simulation.balls.map((ball) => ({ ...ball }));
  const trace = simulation.trace;
  const events: RuleEvent[] = [];
  const objectPockets = trace.pocketed.filter((id) => id !== 0);
  const nineOffTable = trace.offTable.includes(9);
  const expectedFirst = lowestNineBall(game.balls);
  const pushOut = Boolean(shot && shot.shotKind === 'push-out' && game.pushOutAvailable && game.ruleset !== 'house');
  const firstContactLegal = pushOut || (expectedFirst !== null && trace.firstContact === expectedFirst);
  const breakLegal = objectPockets.length > 0 || trace.railContacts.length >= 4;
  const headString = 2.54 * 0.25;
  const crossedHead = new Set(simulation.frames.flatMap((frame) => frame.balls.filter((ball) => ball.id > 0 && ball.x < headString).map((ball) => ball.id))).size;
  const wpaThreePointBreak = game.ruleset !== 'wpa' || objectPockets.length + crossedHead >= 3;
  let foul = trace.cueScratch || trace.offTable.some((id) => id !== 0) || !firstContactLegal || (!pushOut && !trace.anyRailAfterContact && objectPockets.length === 0);
  if (game.breakShot && !breakLegal) {
    foul = true;
    events.push(event('illegal-break', 'Illegal break: pocket a ball or drive four object balls to rails.', shooter));
  } else if (game.breakShot) {
    events.push(event('legal-break', 'Legal break.', shooter));
    if (!wpaThreePointBreak) {
      foul = true;
      events.push(event('illegal-break', 'Illegal WPA break: fewer than three balls crossed the head string or dropped.', shooter));
    }
  }
  if (trace.cueScratch) events.push(event('scratch', 'Scratch. Opponent has ball in hand.', shooter, 0));
  for (const id of trace.offTable.filter((entry) => entry !== 0)) events.push(event('ball-off-table', `Ball ${id} left the table.`, shooter, id));
  if (!firstContactLegal) events.push(event('wrong-first-ball', `The ${expectedFirst ?? 'lowest'} ball must be contacted first.`, shooter, trace.firstContact ?? undefined));
  if (!pushOut && firstContactLegal && !trace.anyRailAfterContact && objectPockets.length === 0) {
    events.push(event('no-rail-or-pocket', 'No ball reached a rail or pocket after contact.', shooter));
  }

  if (pushOut) {
    if (objectPockets.includes(9) || nineOffTable) balls = respot(balls, 9);
    events.push(event('push-out', `Player ${shooter + 1} played a push-out.`, shooter));
    return {
      ...game, revision: game.revision + 1, balls,
      pocketedOrder: updatedPocketedOrder(game, balls, trace.pocketed),
      turnIndex: opponent, breakShot: false, ballInHand: false, placement: null,
      shotNumber: game.shotNumber + 1, pushOutAvailable: false, pushOutReturnTo: shooter,
      shotClockEndsAt: null, lastEvents: events
    };
  }

  const called = callOutcome(game, simulation, shot);
  if (!foul && called.required) events.push(event(called.made ? 'call-made' : 'call-missed', called.made ? 'Called pocket made.' : 'The called shot was not made.', shooter, called.call?.ballId));

  if (objectPockets.includes(9) || nineOffTable) {
    if (!foul && (!called.required || (called.made && called.call?.ballId === 9))) return awardRack(game, shooter, balls, events, trace.pocketed);
    balls = respot(balls, 9);
    events.push(event('nine-respotted', 'The 9 ball is respotted after a foul.', shooter, 9));
  }

  if (foul) {
    const consecutiveFouls: [number, number] = [...game.consecutiveFouls];
    consecutiveFouls[shooter] += 1;
    if (game.ruleset !== 'house' && consecutiveFouls[shooter] >= 3) {
      events.push(event('three-foul-loss', `Player ${shooter + 1} loses after three consecutive fouls.`, shooter));
      return awardRack({ ...game, consecutiveFouls }, opponent, balls, events, trace.pocketed);
    }
    events.push(event('ball-in-hand', `Player ${opponent + 1} has ball in hand.`, opponent));
    return {
      ...game,
      revision: game.revision + 1,
      balls,
      pocketedOrder: updatedPocketedOrder(game, balls, trace.pocketed),
      turnIndex: opponent,
      consecutiveFouls,
      breakShot: false,
      ballInHand: true,
      placement: 'anywhere',
      shotNumber: game.shotNumber + 1,
      pushOutAvailable: false,
      pushOutReturnTo: null,
      shotClockEndsAt: null,
      lastEvents: events
    };
  }

  const keepTurn = called.required ? called.made : objectPockets.length > 0;
  const nextTurn = keepTurn ? shooter : opponent;
  events.push(event(keepTurn ? 'turn-continues' : 'turn-changes', keepTurn ? `Player ${shooter + 1} continues.` : `Player ${opponent + 1}'s turn.`, nextTurn));
  return {
    ...game,
    revision: game.revision + 1,
    balls,
    pocketedOrder: updatedPocketedOrder(game, balls, trace.pocketed),
    turnIndex: nextTurn,
    consecutiveFouls: shooter === 0 ? [0, game.consecutiveFouls[1]] : [game.consecutiveFouls[0], 0],
    breakShot: false,
    ballInHand: false,
    placement: null,
    shotNumber: game.shotNumber + 1,
    pushOutAvailable: game.breakShot && game.ruleset !== 'house',
    pushOutReturnTo: null,
    shotClockEndsAt: null,
    lastEvents: events
  };
}

export function resolveShot(game: GameSnapshot, simulation: ShotSimulation, shot?: ShotInput): GameSnapshot {
  return game.mode === 'eight-ball' ? resolveEightBall(game, simulation, shot) : resolveNineBall(game, simulation, shot);
}

export function returnPushOut(game: GameSnapshot): GameSnapshot {
  if (game.pushOutReturnTo === null) return game;
  const returnedTo = game.pushOutReturnTo;
  return {
    ...game, revision: game.revision + 1, turnIndex: returnedTo,
    pushOutReturnTo: null, shotClockEndsAt: null,
    lastEvents: [event('turn-changes', `Player ${returnedTo + 1} must shoot after the push-out was returned.`, returnedTo)]
  };
}

export function applyShotClockFoul(game: GameSnapshot): GameSnapshot {
  const offender = game.turnIndex;
  const next = otherPlayer(offender);
  const events = [
    event('shot-clock-foul', `Shot clock expired for Player ${offender + 1}.`, offender),
    event('ball-in-hand', `Player ${next + 1} has ball in hand.`, next)
  ];
  if (game.mode === 'nine-ball' && game.ruleset !== 'house') {
    const consecutiveFouls: [number, number] = [...game.consecutiveFouls];
    consecutiveFouls[offender] += 1;
    if (consecutiveFouls[offender] >= 3) {
      events.push(event('three-foul-loss', `Player ${offender + 1} loses after three consecutive fouls.`, offender));
      return awardRack({ ...game, consecutiveFouls }, next, game.balls, events, []);
    }
    return {
      ...game, revision: game.revision + 1, turnIndex: next, consecutiveFouls,
      ballInHand: true, placement: game.breakShot ? 'kitchen' : 'anywhere', breakShot: false,
      pushOutAvailable: false, pushOutReturnTo: null, shotClockEndsAt: null, lastEvents: events
    };
  }
  return {
    ...game,
    revision: game.revision + 1,
    turnIndex: next,
    ballInHand: true,
    placement: game.breakShot ? 'kitchen' : 'anywhere',
    breakShot: false,
    pushOutAvailable: false,
    pushOutReturnTo: null,
    shotClockEndsAt: null,
    lastEvents: events
  };
}

export function applyForfeit(game: GameSnapshot, disconnectedPlayer: 0 | 1): GameSnapshot {
  const winner = otherPlayer(disconnectedPlayer);
  return {
    ...game,
    revision: game.revision + 1,
    phase: 'session-over',
    winnerIndex: winner,
    ballInHand: false,
    placement: null,
    shotClockEndsAt: null,
    lastEvents: [event('player-forfeit', `Player ${disconnectedPlayer + 1} forfeited after disconnecting.`, disconnectedPlayer)]
  };
}
