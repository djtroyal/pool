import { BALL_RADIUS, DEFAULT_SETTINGS, TABLE_HEIGHT, TABLE_WIDTH } from './constants.js';
import { simulateShot } from './physics.js';
import { createGame } from './rack.js';
import type {
  BallState,
  ChallengeMedal,
  GameSnapshot,
  PracticeChallengeDefinition,
  PracticeChallengeId,
  ShotInput,
  ShotSimulation
} from './types.js';

export const PRACTICE_CHALLENGES: PracticeChallengeDefinition[] = [
  {
    id: 'stop-line',
    name: 'Stop Line',
    description: 'Pocket the 1 in the side and leave the cue ball on the contact line.',
    objective: 'A precise center-ball stop shot. Draw or follow costs control score.',
    medalScores: [450, 700, 900]
  },
  {
    id: 'follow-window',
    name: 'Follow Window',
    description: 'Pocket the 1 and roll the cue ball into the forward target zone.',
    objective: 'Use controlled follow; extra travel and excessive power reduce the score.',
    medalScores: [430, 690, 890]
  },
  {
    id: 'draw-ladder',
    name: 'Draw Ladder',
    description: 'Pocket the 1 and draw the cue ball back toward the head string.',
    objective: 'Backspin and landing accuracy matter more than raw power.',
    medalScores: [440, 700, 900]
  },
  {
    id: 'speed-control',
    name: 'Speed Control',
    description: 'Leave the cue ball inside the center-table speed window.',
    objective: 'Reach the target zone without contacting an object ball.',
    medalScores: [420, 680, 900]
  },
  {
    id: 'cut-ladder',
    name: 'Cut Ladder',
    description: 'Convert a thin cut into the far corner.',
    objective: 'Pocket the 1 cleanly and avoid a cue-ball scratch.',
    medalScores: [470, 720, 920]
  },
  {
    id: 'long-pot',
    name: 'Long Pot',
    description: 'Pocket the 1 over nearly the full table length.',
    objective: 'Accuracy and controlled cue-ball speed produce the highest score.',
    medalScores: [450, 710, 910]
  },
  {
    id: 'bank-window',
    name: 'Bank Window',
    description: 'Bank the 1 into any pocket after at least one rail contact.',
    objective: 'The object ball—not the cue ball—must touch a cushion before dropping.',
    medalScores: [500, 760, 920]
  },
  {
    id: 'kick-escape',
    name: 'Kick Escape',
    description: 'Contact the hidden 1 after the cue ball reaches a cushion.',
    objective: 'A legal rail-first escape with controlled separation scores best.',
    medalScores: [470, 730, 920]
  },
  {
    id: 'safety-lock',
    name: 'Safety Lock',
    description: 'Contact the 1 legally and leave distance with no pocket.',
    objective: 'Use speed and rails to hide the cue ball behind the blocker.',
    medalScores: [430, 700, 910]
  },
  {
    id: 'multi-rail-shape',
    name: 'Multi-Rail Shape',
    description: 'Pocket the 1 and send the cue ball around two or more rails.',
    objective: 'Finish in the marked center zone after the multi-rail route.',
    medalScores: [500, 750, 930]
  },
  {
    id: 'jump-gate',
    name: 'Jump Gate',
    description: 'Jump the blocker and contact or pocket the 1.',
    objective: 'Clear the blocker, land on the cloth, and avoid a scratch.',
    medalScores: [500, 760, 930]
  },
  {
    id: 'masse-bend',
    name: 'Massé Bend',
    description: 'Curve around the blocker to contact the 1.',
    objective: 'Verified lateral curve and a legal first contact are required.',
    medalScores: [520, 780, 940]
  },
  {
    id: 'break-lab',
    name: 'Break Lab',
    description: 'Open a 9-ball rack with speed, spread, and cue-ball control.',
    objective: 'Pockets, object-ball rail contacts, and spread score; scratches are penalized.',
    medalScores: [300, 560, 820]
  },
  {
    id: 'eight-ball-pattern',
    name: '8-Ball Pattern Opener',
    description: 'Pocket the opener in a compact three-ball pattern.',
    objective: 'Choose the right first ball and leave a playable route toward the 8.',
    medalScores: [400, 680, 900]
  },
  {
    id: 'nine-ball-rotation',
    name: '9-Ball Rotation Opener',
    description: 'Open a compact 1-2-9 rotation pattern.',
    objective: 'Contact the 1 first, pocket cleanly, and preserve a usable line to the 2.',
    medalScores: [400, 680, 900]
  }
];

function ball(id: number, x: number, y: number): BallState {
  return {
    id, x, y, z: BALL_RADIUS,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    disposition: 'on-table'
  };
}

export function practiceChallengeDefinition(id: PracticeChallengeId): PracticeChallengeDefinition {
  const definition = PRACTICE_CHALLENGES.find((entry) => entry.id === id);
  if (!definition) throw new TypeError('Unknown practice challenge.');
  return definition;
}

export function createPracticeChallenge(id: PracticeChallengeId): GameSnapshot {
  if (id === 'break-lab') {
    const game = createGame({ ...DEFAULT_SETTINGS, mode: 'nine-ball' }, 0, 0x9b4ea);
    return { ...game, ballInHand: false, placement: null };
  }
  const mode = id === 'eight-ball-pattern' ? 'eight-ball' : 'nine-ball';
  const game = createGame({ ...DEFAULT_SETTINGS, mode }, 0, 1);
  let balls: BallState[];
  if (id === 'stop-line') balls = [ball(0, 0.58, TABLE_HEIGHT / 2), ball(1, 1.48, TABLE_HEIGHT / 2)];
  else if (id === 'follow-window') balls = [ball(0, 0.55, TABLE_HEIGHT / 2), ball(1, 1.2, TABLE_HEIGHT / 2)];
  else if (id === 'draw-ladder') balls = [ball(0, 0.88, TABLE_HEIGHT / 2), ball(1, 1.42, TABLE_HEIGHT / 2)];
  else if (id === 'speed-control') balls = [ball(0, 0.45, TABLE_HEIGHT * 0.7)];
  else if (id === 'cut-ladder') balls = [ball(0, 0.54, TABLE_HEIGHT * 0.76), ball(1, 1.54, TABLE_HEIGHT * 0.33)];
  else if (id === 'long-pot') balls = [ball(0, 0.34, TABLE_HEIGHT * 0.52), ball(1, 1.92, TABLE_HEIGHT * 0.31)];
  else if (id === 'bank-window') balls = [ball(0, 0.58, TABLE_HEIGHT * 0.72), ball(1, 1.46, TABLE_HEIGHT * 0.43)];
  else if (id === 'kick-escape') balls = [ball(0, 0.48, TABLE_HEIGHT * 0.68), ball(1, 1.58, TABLE_HEIGHT * 0.36), ball(2, 1.04, TABLE_HEIGHT * 0.52)];
  else if (id === 'safety-lock') balls = [ball(0, 0.55, TABLE_HEIGHT * 0.67), ball(1, 1.34, TABLE_HEIGHT * 0.48), ball(2, 1.85, TABLE_HEIGHT * 0.5)];
  else if (id === 'multi-rail-shape') balls = [ball(0, 0.55, TABLE_HEIGHT * 0.67), ball(1, 1.28, TABLE_HEIGHT * 0.36), ball(2, 2.05, TABLE_HEIGHT * 0.62)];
  else if (id === 'jump-gate' || id === 'masse-bend') balls = [ball(0, 0.5, TABLE_HEIGHT * 0.62), ball(1, 1.62, TABLE_HEIGHT * 0.42), ball(2, 1.02, TABLE_HEIGHT * 0.54)];
  else if (id === 'eight-ball-pattern') balls = [ball(0, 0.55, TABLE_HEIGHT * 0.62), ball(1, 1.18, TABLE_HEIGHT * 0.38), ball(2, 1.55, TABLE_HEIGHT * 0.72), ball(8, 1.95, TABLE_HEIGHT * 0.48)];
  else balls = [ball(0, 0.48, TABLE_HEIGHT * 0.62), ball(1, 1.1, TABLE_HEIGHT * 0.35), ball(2, 1.55, TABLE_HEIGHT * 0.68), ball(9, 2.02, TABLE_HEIGHT * 0.42)];
  return {
    ...game,
    balls,
    breakShot: false,
    ballInHand: false,
    placement: null,
    tableOpen: false,
    groups: [null, null]
  };
}

function medalFor(score: number, thresholds: [number, number, number]): ChallengeMedal {
  if (score >= thresholds[2]) return 3;
  if (score >= thresholds[1]) return 2;
  if (score >= thresholds[0]) return 1;
  return 0;
}

function finishSnapshot(game: GameSnapshot, simulation: ShotSimulation): GameSnapshot {
  const newlyPocketed = simulation.trace.pocketed.filter((id) => id !== 0);
  return {
    ...game,
    revision: game.revision + 1,
    balls: simulation.balls,
    pocketedOrder: [...new Set([...game.pocketedOrder, ...newlyPocketed])],
    shotNumber: game.shotNumber + 1,
    breakShot: false,
    ballInHand: false,
    placement: null,
    lastEvents: []
  };
}

export interface PracticeChallengeEvaluation {
  simulation: ShotSimulation;
  finalSnapshot: GameSnapshot;
  score: number;
  medal: ChallengeMedal;
  summary: string;
}

export function evaluatePracticeChallenge(
  id: PracticeChallengeId,
  game: GameSnapshot,
  shot: ShotInput
): PracticeChallengeEvaluation {
  const definition = practiceChallengeDefinition(id);
  const simulation = simulateShot(game.balls, shot, { clothSpeed: 'standard' });
  let score = 0;
  let summary = 'No score. Reset and adjust the line.';

  if (id === 'stop-line') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    const made = simulation.trace.pocketed.includes(1) && !simulation.trace.cueScratch;
    if (made && cue?.disposition === 'on-table') {
      const contactCenter = { x: 1.48 - BALL_RADIUS * 2, y: TABLE_HEIGHT / 2 };
      const error = Math.hypot(cue.x - contactCenter.x, cue.y - contactCenter.y);
      score = Math.max(250, Math.round(1_000 - error * 1_250));
      summary = error < 0.08 ? 'Cue ball stopped on the contact line.' : `Made, with ${Math.round(error * 100)} cm of cue-ball drift.`;
    }
  } else if (id === 'follow-window' || id === 'draw-ladder') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    if (simulation.trace.pocketed.includes(1) && cue?.disposition === 'on-table' && !simulation.trace.cueScratch) {
      const targetX = id === 'follow-window' ? 1.58 : 0.56;
      const targetY = TABLE_HEIGHT / 2;
      const error = Math.hypot(cue.x - targetX, cue.y - targetY);
      const correctSpin = id === 'follow-window' ? shot.english.vertical > 0.12 : shot.english.vertical < -0.12;
      score = Math.max(180, Math.round(1_000 - error * 780 - (correctSpin ? 0 : 180) - Math.max(0, shot.power - 0.72) * 160));
      summary = `${id === 'follow-window' ? 'Follow' : 'Draw'} converted with ${Math.round(error * 100)} cm position error.`;
    }
  } else if (id === 'speed-control') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    if (cue?.disposition === 'on-table' && simulation.trace.firstContact === null) {
      const target = { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 };
      const error = Math.hypot(cue.x - target.x, cue.y - target.y);
      score = Math.max(0, Math.round(1_000 - error * 900));
      summary = `Cue ball finished ${Math.round(error * 100)} cm from the speed-control center.`;
    }
  } else if (id === 'cut-ladder' || id === 'long-pot') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    if (simulation.trace.pocketed.includes(1) && !simulation.trace.cueScratch && cue?.disposition === 'on-table') {
      const control = Math.min(280, Math.hypot(cue.vx, cue.vy) < 0.01 ? 180 : 80);
      score = Math.min(1_000, 650 + control + Math.round((1 - shot.power) * 120));
      summary = `${id === 'cut-ladder' ? 'Thin cut' : 'Long pot'} converted cleanly.`;
    }
  } else if (id === 'bank-window') {
    const pocket = simulation.trace.contacts.find((contact) => contact.kind === 'pocket' && contact.ballIds.includes(1));
    const objectRails = simulation.trace.contacts.filter((contact) =>
      (contact.kind === 'cushion' || contact.kind === 'jaw') && contact.ballIds.includes(1) && (!pocket || contact.time < pocket.time)
    ).length;
    if (simulation.trace.pocketed.includes(1) && objectRails > 0 && !simulation.trace.cueScratch) {
      score = Math.min(1_000, 680 + objectRails * 120 + Math.round(Math.max(0, 1 - shot.power) * 90));
      summary = `${objectRails}-rail bank converted without a scratch.`;
    } else if (simulation.trace.pocketed.includes(1)) {
      summary = simulation.trace.cueScratch ? 'The bank dropped, but the cue ball scratched.' : 'The 1 dropped without banking first.';
    }
  } else if (id === 'kick-escape') {
    const firstTime = simulation.trace.firstContactTime ?? simulation.trace.duration;
    const cueRails = simulation.trace.contacts.filter((contact) => (contact.kind === 'cushion' || contact.kind === 'jaw') && contact.ballIds.includes(0) && contact.time < firstTime).length;
    if (cueRails > 0 && simulation.trace.firstContact === 1 && !simulation.trace.cueScratch) {
      score = Math.min(1_000, 620 + cueRails * 120 + Math.round((1 - shot.power) * 120));
      summary = `${cueRails}-rail legal kick escape.`;
    }
  } else if (id === 'safety-lock') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    const target = simulation.balls.find((entry) => entry.id === 1);
    if (simulation.trace.firstContact === 1 && !simulation.trace.pocketed.length && cue && target) {
      const separation = Math.hypot(cue.x - target.x, cue.y - target.y);
      score = Math.min(1_000, Math.round(420 + separation / TABLE_WIDTH * 720));
      summary = `Legal safety with ${Math.round(separation * 100)} cm separation.`;
    }
  } else if (id === 'multi-rail-shape') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    const cueRails = simulation.trace.contacts.filter((contact) => (contact.kind === 'cushion' || contact.kind === 'jaw') && contact.ballIds.includes(0)).length;
    if (simulation.trace.pocketed.includes(1) && cueRails >= 2 && cue?.disposition === 'on-table') {
      const error = Math.hypot(cue.x - TABLE_WIDTH / 2, cue.y - TABLE_HEIGHT / 2);
      score = Math.max(300, Math.round(1_000 - error * 650 + Math.min(100, (cueRails - 2) * 35)));
      summary = `${cueRails}-rail route with ${Math.round(error * 100)} cm position error.`;
    }
  } else if (id === 'jump-gate') {
    const firstTime = simulation.trace.firstContactTime ?? simulation.trace.duration;
    const cleared = simulation.frames.some((frame) => frame.time < firstTime && (frame.balls.find((entry) => entry.id === 0)?.z ?? 0) > BALL_RADIUS * 2.25);
    if (cleared && simulation.trace.firstContact === 1 && !simulation.trace.cueScratch) {
      score = Math.min(1_000, 700 + (simulation.trace.pocketed.includes(1) ? 220 : 0) - Math.round(Math.max(0, shot.power - 0.75) * 120));
      summary = `Blocker cleared${simulation.trace.pocketed.includes(1) ? ' and target pocketed' : ''}.`;
    }
  } else if (id === 'masse-bend') {
    const frames = simulation.frames.map((frame) => frame.balls.find((entry) => entry.id === 0)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const start = frames[0]; const end = frames.at(-1);
    const curved = shot.elevation >= 25 && Math.abs(shot.english.side) >= 0.3 && start && end
      ? frames.some((entry) => Math.abs((end.y - start.y) * entry.x - (end.x - start.x) * entry.y + end.x * start.y - end.y * start.x) / (Math.hypot(end.x - start.x, end.y - start.y) || 1) > BALL_RADIUS * 0.55)
      : false;
    if (curved && simulation.trace.firstContact === 1 && !simulation.trace.cueScratch) {
      score = Math.min(1_000, 720 + (simulation.trace.pocketed.includes(1) ? 200 : 0));
      summary = `Verified massé curve${simulation.trace.pocketed.includes(1) ? ' and pocket' : ''}.`;
    }
  } else if (id === 'eight-ball-pattern') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    const madeOpener = simulation.trace.pocketed.find((ballId) => ballId === 1 || ballId === 2);
    const nextTarget = simulation.balls.find((entry) => entry.id === (madeOpener === 1 ? 2 : 1) && entry.disposition === 'on-table')
      ?? simulation.balls.find((entry) => entry.id === 8 && entry.disposition === 'on-table');
    const legal = (simulation.trace.firstContact === 1 || simulation.trace.firstContact === 2)
      && madeOpener !== undefined && !simulation.trace.pocketed.includes(8) && !simulation.trace.cueScratch;
    if (legal && cue?.disposition === 'on-table' && nextTarget) {
      const positionDistance = Math.hypot(cue.x - nextTarget.x, cue.y - nextTarget.y);
      score = Math.max(350, Math.min(1_000, Math.round(940 - positionDistance * 190 - Math.max(0, shot.power - .72) * 140)));
      summary = `Legal opener made; ${Math.round(positionDistance * 100)} cm remains to the next pattern ball.`;
    } else if (simulation.trace.pocketed.includes(8)) summary = 'The 8 fell before the pattern was cleared.';
  } else if (id === 'nine-ball-rotation') {
    const cue = simulation.balls.find((entry) => entry.id === 0);
    const two = simulation.balls.find((entry) => entry.id === 2 && entry.disposition === 'on-table');
    if (simulation.trace.firstContact === 1 && simulation.trace.pocketed.includes(1) && !simulation.trace.cueScratch && cue?.disposition === 'on-table' && two) {
      const positionDistance = Math.hypot(cue.x - two.x, cue.y - two.y);
      score = Math.max(350, Math.min(1_000, Math.round(950 - positionDistance * 210 - Math.max(0, shot.power - .76) * 130)));
      summary = `The 1 dropped legally; ${Math.round(positionDistance * 100)} cm remains to the 2.`;
    }
  } else {
    const objectPockets = simulation.trace.pocketed.filter((ballId) => ballId !== 0).length;
    const objectRails = new Set(simulation.trace.contacts
      .filter((contact) => (contact.kind === 'cushion' || contact.kind === 'jaw') && contact.ballIds.some((ballId) => ballId !== 0))
      .flatMap((contact) => contact.ballIds.filter((ballId) => ballId !== 0))).size;
    const remaining = simulation.balls.filter((entry) => entry.id !== 0 && entry.disposition === 'on-table');
    const centroid = remaining.reduce((total, entry) => ({ x: total.x + entry.x, y: total.y + entry.y }), { x: 0, y: 0 });
    if (remaining.length) { centroid.x /= remaining.length; centroid.y /= remaining.length; }
    const spread = remaining.length
      ? remaining.reduce((total, entry) => total + Math.hypot(entry.x - centroid.x, entry.y - centroid.y), 0) / remaining.length
      : Math.hypot(TABLE_WIDTH, TABLE_HEIGHT) / 2;
    score = Math.round(objectPockets * 220 + objectRails * 24 + Math.min(360, spread / TABLE_WIDTH * 760) - (simulation.trace.cueScratch ? 260 : 0));
    score = Math.max(0, Math.min(1_000, score));
    summary = `${objectPockets} pocketed · ${objectRails} object balls to rails${simulation.trace.cueScratch ? ' · scratch penalty' : ''}.`;
  }

  return {
    simulation,
    finalSnapshot: finishSnapshot(game, simulation),
    score,
    medal: medalFor(score, definition.medalScores),
    summary
  };
}
