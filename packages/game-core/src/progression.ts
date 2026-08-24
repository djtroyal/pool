import type {
  CareerStats,
  CosmeticLoadout,
  GameMode,
  MasteryTrack,
  ModeStanding,
  PlayerStats,
  PlaystyleProfile,
  PlaystyleTag,
  RankTier
} from './types.js';

export type CosmeticCategory = 'cue' | 'tableFinish' | 'cloth' | 'trail' | 'frame' | 'stinger' | 'cueBall' | 'ballSet' | 'soundSet' | 'avatarAccent';

export interface CosmeticDefinition {
  id: string;
  name: string;
  category: CosmeticCategory;
  level?: number | undefined;
  mastery?: { track: MasteryTrack; rank: 1 | 2 | 3 } | undefined;
  priceXp?: number | undefined;
}

const STORE_CATEGORY_MULTIPLIER: Record<CosmeticCategory, number> = {
  cue: 1, tableFinish: 1.25, cloth: 1, trail: .75, frame: .75, stinger: .75,
  cueBall: 1, ballSet: 1.25, soundSet: 1, avatarAccent: .75
};

export function storePriceForCosmetic(item: Pick<CosmeticDefinition, 'category' | 'level' | 'mastery'>): number | null {
  if (!item.level || item.level <= 1 || item.mastery) return null;
  const raw = (125 + 55 * item.level) * STORE_CATEGORY_MULTIPLIER[item.category];
  return Math.ceil(raw / 25) * 25;
}

export const DEFAULT_COSMETIC_LOADOUT: CosmeticLoadout = {
  cue: 'house-maple',
  tableFinish: 'classic-walnut',
  cloth: 'emerald-solid',
  trail: 'chalk-white',
  frame: 'plain-brass',
  stinger: 'felt-click',
  cueBall: 'red-dot-cue-ball',
  ballSet: 'classic-ball-set',
  soundSet: 'tournament-resin'
};

const LEVEL_REWARDS: CosmeticDefinition[] = [
  { id: 'cue-smoked-maple', name: 'Smoked Maple Cue', category: 'cue', level: 2 },
  { id: 'trail-amber-line', name: 'Amber Trace', category: 'trail', level: 3 },
  { id: 'frame-slate', name: 'Slate Profile Frame', category: 'frame', level: 4 },
  { id: 'stinger-brass-tick', name: 'Brass Score Tick', category: 'stinger', level: 5 },
  { id: 'cue-ebony-thread', name: 'Ebony Thread Cue', category: 'cue', level: 6 },
  { id: 'bottle-green', name: 'Bottle Green Cloth', category: 'cloth', level: 7 },
  { id: 'trail-cool-vapor', name: 'Cool Vapor Trace', category: 'trail', level: 8 },
  { id: 'burnished-oak', name: 'Burnished Oak Table', category: 'tableFinish', level: 9 },
  { id: 'frame-double-line', name: 'Double Line Frame', category: 'frame', level: 10 },
  { id: 'cue-carbon-brass', name: 'Carbon Brass Cue', category: 'cue', level: 11 },
  { id: 'stinger-low-relay', name: 'Low Relay Stinger', category: 'stinger', level: 12 },
  { id: 'ink-blue', name: 'Ink Blue Cloth', category: 'cloth', level: 13 },
  { id: 'trail-silver-dust', name: 'Silver Dust Trace', category: 'trail', level: 14 },
  { id: 'graphite-edge', name: 'Graphite Edge Table', category: 'tableFinish', level: 15 },
  { id: 'cue-copper-splice', name: 'Copper Splice Cue', category: 'cue', level: 16 },
  { id: 'frame-precision', name: 'Precision Profile Frame', category: 'frame', level: 17 },
  { id: 'stinger-glass-clack', name: 'Glass Clack Stinger', category: 'stinger', level: 18 },
  { id: 'oxblood-weave', name: 'Oxblood Weave Cloth', category: 'cloth', level: 19 },
  { id: 'cue-midnight-inlay', name: 'Midnight Inlay Cue', category: 'cue', level: 20 },
  { id: 'trail-gold-filament', name: 'Gold Filament Trace', category: 'trail', level: 25 },
  { id: 'black-chrome', name: 'Black Chrome Table', category: 'tableFinish', level: 30 },
  { id: 'cue-tournament-carbon', name: 'Tournament Carbon Cue', category: 'cue', level: 35 },
  { id: 'night-grid', name: 'Night Grid Cloth', category: 'cloth', level: 40 },
  { id: 'frame-master-line', name: 'Master Line Frame', category: 'frame', level: 45 }
  ,{ id: 'cue-blue-dot', name: 'Blue Dot Cue Ball', category: 'cueBall', level: 4 }
  ,{ id: 'cue-measles', name: 'Training Spot Cue Ball', category: 'cueBall', level: 9 }
  ,{ id: 'cue-graphite-dot', name: 'Graphite Dot Cue Ball', category: 'cueBall', level: 17 }
  ,{ id: 'balls-high-contrast', name: 'High Contrast Ball Set', category: 'ballSet', level: 6 }
  ,{ id: 'balls-muted-club', name: 'Muted Club Ball Set', category: 'ballSet', level: 14 }
  ,{ id: 'balls-geometric', name: 'Geometric Ball Set', category: 'ballSet', level: 24 }
  ,{ id: 'sound-warm-club', name: 'Warm Club Sound', category: 'soundSet', level: 5 }
  ,{ id: 'sound-slate-room', name: 'Slate Room Sound', category: 'soundSet', level: 12 }
  ,{ id: 'sound-quiet-practice', name: 'Quiet Practice Sound', category: 'soundSet', level: 20 }
  ,{ id: 'avatar-round-glasses', name: 'Round Avatar Glasses', category: 'avatarAccent', level: 3 }
  ,{ id: 'avatar-moustache', name: 'Avatar Moustache', category: 'avatarAccent', level: 5 }
  ,{ id: 'avatar-locs', name: 'Avatar Locs', category: 'avatarAccent', level: 7 }
  ,{ id: 'avatar-hoop-earring', name: 'Avatar Hoop', category: 'avatarAccent', level: 8 }
  ,{ id: 'avatar-browline-glasses', name: 'Browline Avatar Glasses', category: 'avatarAccent', level: 9 }
  ,{ id: 'avatar-cut-mark', name: 'Avatar Cut Mark', category: 'avatarAccent', level: 10 }
  ,{ id: 'avatar-full-beard', name: 'Full Avatar Beard', category: 'avatarAccent', level: 12 }
  ,{ id: 'avatar-undercut', name: 'Avatar Undercut', category: 'avatarAccent', level: 14 }
  ,{ id: 'avatar-double-stud', name: 'Avatar Double Stud', category: 'avatarAccent', level: 16 }
  ,{ id: 'avatar-sport-glasses', name: 'Sport Avatar Glasses', category: 'avatarAccent', level: 18 }
  ,{ id: 'avatar-swept-hair', name: 'Swept Avatar Hair', category: 'avatarAccent', level: 22 }
];

const MASTERY_REWARDS: CosmeticDefinition[] = (['break', 'precision', 'rails', 'control', 'technique', 'runout'] as MasteryTrack[])
  .flatMap((track) => ([1, 2, 3] as const).map((rank): CosmeticDefinition => ({
    id: `${track}-mastery-${rank}`,
    name: `${track.charAt(0).toUpperCase()}${track.slice(1)} Mastery ${rank}`,
    category: rank === 1 ? 'frame' : rank === 2 ? 'trail' : 'cue',
    mastery: { track, rank }
  })));

const RAW_COSMETIC_CATALOG: CosmeticDefinition[] = [
  { id: 'house-maple', name: 'House Maple Cue', category: 'cue', level: 1 },
  { id: 'classic-walnut', name: 'Classic Walnut Table', category: 'tableFinish', level: 1 },
  { id: 'light-oak', name: 'Light Oak Table', category: 'tableFinish', level: 1 },
  { id: 'tournament-black', name: 'Tournament Black Table', category: 'tableFinish', level: 1 },
  { id: 'midnight-brass', name: 'Midnight Brass Table', category: 'tableFinish', level: 1 },
  { id: 'emerald-solid', name: 'Emerald Cloth', category: 'cloth', level: 1 },
  { id: 'tournament-blue', name: 'Tournament Blue Cloth', category: 'cloth', level: 1 },
  { id: 'burgundy', name: 'Burgundy Cloth', category: 'cloth', level: 1 },
  { id: 'charcoal', name: 'Charcoal Cloth', category: 'cloth', level: 1 },
  { id: 'teal-weave', name: 'Teal Weave Cloth', category: 'cloth', level: 1 },
  { id: 'navy-diamond', name: 'Navy Diamond Cloth', category: 'cloth', level: 1 },
  { id: 'custom-solid', name: 'Custom Solid Cloth', category: 'cloth', level: 1 },
  { id: 'chalk-white', name: 'Chalk White Trace', category: 'trail', level: 1 },
  { id: 'plain-brass', name: 'Plain Brass Frame', category: 'frame', level: 1 },
  { id: 'felt-click', name: 'Felt Click Stinger', category: 'stinger', level: 1 },
  { id: 'red-dot-cue-ball', name: 'Red Dot Cue Ball', category: 'cueBall', level: 1 },
  { id: 'classic-ball-set', name: 'Classic Ball Set', category: 'ballSet', level: 1 },
  { id: 'tournament-resin', name: 'Tournament Resin Sound', category: 'soundSet', level: 1 },
  ...LEVEL_REWARDS,
  ...MASTERY_REWARDS
];

export const COSMETIC_CATALOG: CosmeticDefinition[] = RAW_COSMETIC_CATALOG.map((item) => {
  const priceXp = storePriceForCosmetic(item);
  return priceXp === null ? item : { ...item, priceXp };
});

export const MASTERY_THRESHOLDS: Record<MasteryTrack, [number, number, number]> = {
  break: [5, 25, 100],
  precision: [10, 50, 200],
  rails: [5, 25, 100],
  control: [10, 50, 200],
  technique: [3, 15, 60],
  runout: [1, 5, 20]
};

export function xpForLevel(level: number): number {
  const offset = Math.max(0, Math.floor(level) - 1);
  return 150 * offset * offset + 250 * offset;
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level += 1;
  return level;
}

export function tierForRating(rating: number, ratedRacks: number): RankTier {
  if (ratedRacks < 5) return 'unranked';
  if (rating < 900) return 'bronze';
  if (rating < 1_050) return 'silver';
  if (rating < 1_200) return 'gold';
  if (rating < 1_400) return 'platinum';
  if (rating < 1_600) return 'diamond';
  return 'master';
}

export function defaultStanding(mode: GameMode): ModeStanding {
  return {
    mode, rating: 1_000, ratingDeviation: 350, volatility: 0.06, lastRatedAt: null,
    ratedRacks: 0, wins: 0, losses: 0, tier: 'unranked', provisional: true
  };
}

export function eloDelta(own: ModeStanding, opponent: ModeStanding, won: boolean, multiplier = 1): number {
  const expected = 1 / (1 + 10 ** ((opponent.rating - own.rating) / 400));
  const k = own.ratedRacks < 5 ? 48 : 24;
  return Math.round(k * ((won ? 1 : 0) - expected) * multiplier);
}

const GLICKO_SCALE = 173.7178;
function glickoG(phi: number): number { return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI)); }
function glickoE(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-glickoG(opponentPhi) * (mu - opponentMu)));
}

/** One deterministic Glicko-2 rating period containing one rack result. */
export function glicko2Update(
  own: ModeStanding,
  opponent: ModeStanding,
  won: boolean,
  at = Date.now(),
  multiplier = 1
): ModeStanding {
  if (multiplier <= 0) return { ...own };
  const tau = 0.5;
  const mu = (own.rating - 1_000) / GLICKO_SCALE;
  const inactivityDays = own.lastRatedAt ? Math.max(0, (at - own.lastRatedAt) / 86_400_000) : 0;
  const basePhi = own.ratingDeviation / GLICKO_SCALE;
  const phi = Math.min(350 / GLICKO_SCALE, Math.sqrt(basePhi * basePhi + own.volatility * own.volatility * inactivityDays));
  const opponentMu = (opponent.rating - 1_000) / GLICKO_SCALE;
  const opponentPhi = opponent.ratingDeviation / GLICKO_SCALE;
  const g = glickoG(opponentPhi);
  const expected = glickoE(mu, opponentMu, opponentPhi);
  const variance = 1 / (g * g * expected * (1 - expected));
  const delta = variance * g * ((won ? 1 : 0) - expected) * multiplier;
  const a = Math.log(own.volatility * own.volatility);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - variance - ex);
    const denominator = 2 * (phi * phi + variance + ex) ** 2;
    return numerator / denominator - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + variance) B = Math.log(delta * delta - phi * phi - variance);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A); let fB = f(B);
  while (Math.abs(B - A) > 0.000001) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const nextPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);
  const nextMu = mu + nextPhi * nextPhi * g * ((won ? 1 : 0) - expected) * multiplier;
  const ratedRacks = own.ratedRacks + 1;
  const rating = Math.max(100, Math.round(1_000 + GLICKO_SCALE * nextMu));
  const ratingDeviation = Math.max(30, Math.min(350, Math.round(GLICKO_SCALE * nextPhi * 10) / 10));
  return {
    ...own,
    rating,
    ratingDeviation,
    volatility: Math.round(sigma * 100_000) / 100_000,
    lastRatedAt: at,
    ratedRacks,
    wins: own.wins + (won ? 1 : 0),
    losses: own.losses + (won ? 0 : 1),
    tier: tierForRating(rating, ratedRacks),
    provisional: ratedRacks < 10
  };
}

export const EMPTY_CAREER_STATS: CareerStats = {
  gamesPlayed: 0, wins: 0, losses: 0, strokes: 0, playtimeMs: 0,
  ballsPocketed: 0, legalPockets: 0, fouls: 0, scratches: 0, breakScratches: 0,
  illegalBreaks: 0, wrongFirstBalls: 0, offTableBalls: 0, shotClockFouls: 0,
  breaksTaken: 0, ballsOnBreak: 0, winsAsBreaker: 0, breakAndRuns: 0,
  eightOnBreak: 0, nineOnBreak: 0, eightBallFoulLosses: 0, runouts: 0,
  safeties: 0, calledShots: 0, calledMakes: 0, wrongPockets: 0, slopPockets: 0,
  jumps: 0, jumpMakes: 0, masses: 0, masseMakes: 0, swerves: 0,
  banks: 0, kicks: 0, combinations: 0, multiRailShots: 0,
  powerSum: 0, aimTimeMs: 0, englishShots: 0, followShots: 0, drawShots: 0,
  leftEnglishShots: 0, rightEnglishShots: 0, longestRun: 0
};

function freshCareerStats(): CareerStats { return { ...EMPTY_CAREER_STATS }; }
export function emptyPlayerStats(trackingSince = Date.now()): PlayerStats {
  return {
    total: freshCareerStats(),
    byMode: { 'eight-ball': freshCareerStats(), 'nine-ball': freshCareerStats() },
    humanGames: freshCareerStats(), cpuGames: freshCareerStats(), styleSamples: [], trackingSince
  };
}

export function inferPlaystyle(stats: PlayerStats): PlaystyleProfile {
  const s = stats.total;
  const shots = Math.max(1, s.strokes);
  const games = Math.max(1, s.gamesPlayed);
  const tags: PlaystyleTag[] = [];
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const add = (id: string, label: string, raw: number, threshold: number, evidence: string, minimum = 30, kind: PlaystyleTag['kind'] = 'specialist') => {
    if (s.strokes < minimum || raw < threshold) return;
    const confidence = Math.min(1, Math.sqrt(s.strokes / Math.max(1, minimum)) * Math.min(1, raw / threshold) * 0.55);
    tags.push({ id, label, score: Math.round(raw * 1_000), confidence: Math.round(confidence * 100) / 100, evidence, trend: 'steady', kind });
  };
  const englishRate = s.englishShots / shots;
  const foulRate = s.fouls / shots;
  const scratchRate = s.scratches / shots;
  const safetyRate = s.safeties / shots;
  const railRate = (s.banks + s.kicks + s.multiRailShots) / shots;
  const techniqueRate = (s.jumps + s.masses + s.swerves) / shots;
  const legalRate = s.legalPockets / Math.max(1, s.ballsPocketed);
  const averagePower = s.powerSum / shots;
  const averageAimSeconds = s.aimTimeMs / shots / 1_000;
  const axis = (id: string, lowLabel: string, highLabel: string, careerValue: number, minimum: number) => {
    const boundedCareer = Math.max(-1, Math.min(1, careerValue));
    const recent = stats.styleSamples.flatMap((sample) => {
      const value = sample.axes[id as keyof typeof sample.axes];
      return Number.isFinite(value) ? [Math.max(-1, Math.min(1, value!))] : [];
    });
    let ewma = recent[0] ?? boundedCareer;
    for (const value of recent.slice(1)) ewma = ewma * .78 + value * .22;
    const recentWeight = Math.min(.35, recent.length / 60 * .35);
    const value = boundedCareer * (1 - recentWeight) + ewma * recentWeight;
    const delta = ewma - boundedCareer;
    const trend = recent.length < 8 || Math.abs(delta) < .18 ? 'steady' : delta > 0 ? 'rising' : 'falling';
    return {
      id, lowLabel, highLabel,
      value: Math.round(value * 100) / 100,
      confidence: Math.round(Math.min(1, Math.sqrt(s.strokes / minimum)) * 100) / 100,
      trend
    } as const;
  };
  const axes = [
    axis('power', 'Soft touch', 'Power', (averagePower - .5) / .32, 30),
    axis('spin', 'Center ball', 'English', (englishRate - .42) / .38, 30),
    axis('vertical-spin', 'Draw', 'Follow', (s.followShots - s.drawShots) / Math.max(1, s.followShots + s.drawShots), 20),
    axis('tempo', 'Quick', 'Deliberate', (averageAimSeconds - 15) / 12, 30),
    axis('intent', 'Safety', 'Attack', 1 - clamp01(safetyRate / .12) * 2, 30),
    axis('route', 'Direct', 'Rails', railRate / .18 * 2 - 1, 30),
    axis('technique', 'Traditional', 'Elevated', techniqueRate / .12 * 2 - 1, 30),
    axis('discipline', 'Chaos', 'Control', 1 - clamp01((foulRate + scratchRate) / .25) * 2, 30)
  ];
  const high = (id: string) => clamp01(((axes.find((entry) => entry.id === id)?.value ?? 0) + 1) / 2);
  const low = (id: string) => 1 - high(id);
  const breakStrength = clamp01((s.ballsOnBreak / Math.max(1, s.breaksTaken)) / 1.35);
  const patternStrength = clamp01((s.runouts * 3 + Math.max(0, s.longestRun - 1)) / Math.max(1, games));
  const combinationRate = clamp01(s.combinations / shots / .12);
  const archetypes = [
    ['surgeon', 'The Surgeon', high('discipline') * .42 + legalRate * .34 + clamp01(s.calledMakes / Math.max(1, s.calledShots)) * .24, `${Math.round(legalRate * 100)}% legal pots`],
    ['gunslinger', 'The Gunslinger', high('intent') * .34 + high('power') * .34 + low('tempo') * .32, `${Math.round(averagePower * 100)}% power · ${Math.round(averageAimSeconds)}s aim`],
    ['cartographer', 'The Cartographer', high('route') * .62 + high('discipline') * .2 + legalRate * .18, `${s.banks + s.kicks} verified rail shots`],
    ['locksmith', 'The Locksmith', low('intent') * .55 + high('tempo') * .2 + high('discipline') * .25, `${s.safeties} verified safeties`],
    ['engineer', 'The Engineer', high('spin') * .4 + high('tempo') * .25 + high('discipline') * .35, `${s.englishShots} English shots`],
    ['showman', 'The Showman', high('technique') * .62 + combinationRate * .25 + high('intent') * .13, `${s.jumps + s.masses + s.combinations} technical shots`],
    ['hammer', 'The Hammer', high('power') * .5 + breakStrength * .5, `${s.ballsOnBreak} balls on ${s.breaksTaken} breaks`],
    ['conductor', 'The Conductor', patternStrength * .55 + high('discipline') * .3 + legalRate * .15, `${s.runouts} runouts · longest run ${s.longestRun}`],
    ['natural', 'The Natural', low('spin') * .4 + low('route') * .3 + low('tempo') * .3, `${Math.round((1 - englishRate) * 100)}% center ball`],
    ['wildcard', 'The Wildcard', low('discipline') * .42 + high('intent') * .24 + clamp01(s.slopPockets / Math.max(1, s.ballsPocketed) / .25) * .34, `${s.slopPockets} slop pockets · ${s.fouls} fouls`]
  ] as const;
  if (s.strokes >= 30 && s.gamesPlayed >= 5) {
    for (const [id, label, score, evidence] of archetypes) {
      if (score >= .68) tags.push({ id, label, score: Math.round(score * 1_000), confidence: Math.round(Math.min(1, Math.sqrt(s.strokes / 60) * score) * 100) / 100, evidence, trend: 'steady', kind: 'archetype' });
    }
  }
  add('center-purist', 'Center-Ball Purist', 1 - s.englishShots / shots, 0.72, `${Math.round((1 - s.englishShots / shots) * 100)}% center ball`);
  add('english-artist', 'English Artist', s.englishShots / shots, 0.48, `${Math.round(s.englishShots / shots * 100)}% English use`);
  add('follow-player', 'Follow Player', s.followShots / shots, 0.32, `${s.followShots} follow shots`);
  add('draw-specialist', 'Draw Specialist', s.drawShots / shots, 0.28, `${s.drawShots} draw shots`);
  add('left-english', 'Left English Bias', s.leftEnglishShots / Math.max(1, s.englishShots), 0.62, `${s.leftEnglishShots} left-spin shots`);
  add('right-english', 'Right English Bias', s.rightEnglishShots / Math.max(1, s.englishShots), 0.62, `${s.rightEnglishShots} right-spin shots`);
  add('power-hitter', 'Power Hitter', s.powerSum / shots, 0.72, `${Math.round(s.powerSum / shots * 100)}% average power`);
  add('soft-touch', 'Soft Touch', 1 - s.powerSum / shots, 0.58, `${Math.round(s.powerSum / shots * 100)}% average power`);
  add('quick-shooter', 'Quick Shooter', 1 - Math.min(1, s.aimTimeMs / shots / 18_000), 0.62, `${Math.round(s.aimTimeMs / shots / 1_000)}s average aim`);
  add('deliberate', 'Deliberate Planner', Math.min(1, s.aimTimeMs / shots / 25_000), 0.62, `${Math.round(s.aimTimeMs / shots / 1_000)}s average aim`);
  for (const [id, label, count] of [
    ['jump-shotter', 'Jump Shotter', s.jumps], ['masse-fan', 'Massé Fan', s.masses],
    ['bank-shotter', 'Bank Shotter', s.banks], ['kick-specialist', 'Kick Specialist', s.kicks],
    ['combo-architect', 'Combo Architect', s.combinations], ['multi-rail-hero', 'Multi-Rail Hero', s.multiRailShots],
    ['safety-player', 'Safety Player', s.safeties], ['train-runner', 'Train Runner', s.runouts],
    ['break-specialist', 'Break Specialist', s.breakAndRuns]
  ] as const) add(id, label, count / shots, id === 'train-runner' || id === 'break-specialist' ? 0.025 : 0.06, `${count} verified`, 20);
  add('eight-sinker', '8-Ball Sinker', stats.byMode['eight-ball'].wins / Math.max(1, stats.byMode['eight-ball'].gamesPlayed), 0.58, `${stats.byMode['eight-ball'].wins} 8-ball wins`, 20);
  add('nine-closer', '9-Ball Closer', stats.byMode['nine-ball'].wins / Math.max(1, stats.byMode['nine-ball'].gamesPlayed), 0.58, `${stats.byMode['nine-ball'].wins} 9-ball wins`, 20);
  add('fouler', 'Foul Magnet', s.fouls / shots, 0.14, `${s.fouls} fouls`, 40, 'after-hours');
  add('wrong-ball', 'Oops Wrong Ball', s.wrongFirstBalls / shots, 0.06, `${s.wrongFirstBalls} wrong first contacts`, 40, 'after-hours');
  add('wrong-hole', 'Oops Wrong Hole', s.wrongPockets / Math.max(1, s.calledShots), 0.12, `${s.wrongPockets} missed calls`, 30, 'after-hours');
  add('slop-hero', 'Slop Hero', s.slopPockets / Math.max(1, s.ballsPocketed), 0.15, `${s.slopPockets} inferred slop pockets`, 30, 'after-hours');
  add('scratch-again', 'Oops I Scratched Again', s.scratches / shots, 0.09, `${s.scratches} scratches`, 40, 'after-hours');
  add('break-scratch', 'Break Scratch Specialist', s.breakScratches / Math.max(1, s.breaksTaken), 0.12, `${s.breakScratches} scratches on ${s.breaksTaken} breaks`, 40, 'after-hours');
  if (s.gamesPlayed >= 25 && s.wins / games < 0.3) tags.push({ id: 'loser', label: 'Loser', score: Math.round((1 - s.wins / games) * 1_000), confidence: Math.min(1, s.gamesPlayed / 60), evidence: `${s.wins}-${s.losses} record`, trend: 'steady', kind: 'after-hours' });
  tags.sort((first, second) => second.score * second.confidence - first.score * first.confidence);
  const totalModeGames = Math.max(1, stats.byMode['eight-ball'].gamesPlayed + stats.byMode['nine-ball'].gamesPlayed);
  return {
    primary: tags.filter((tag) => tag.kind === 'archetype').slice(0, 3), tags,
    axes,
    preferences: {
      'eight-ball': stats.byMode['eight-ball'].gamesPlayed / totalModeGames,
      'nine-ball': stats.byMode['nine-ball'].gamesPlayed / totalModeGames,
      human: stats.humanGames.gamesPlayed / games,
      cpu: stats.cpuGames.gamesPlayed / games
    },
    qualifyingShots: s.strokes, qualifyingRacks: s.gamesPlayed
  };
}

export function repeatOpponentMultiplier(racksInWindow: number): number {
  return [1, 1, 1, 0.75, 0.5, 0.25][racksInWindow] ?? 0;
}

export function rackXp(
  performance: number,
  won: boolean,
  competitionMultiplier: number,
  repeatMultiplier: number,
  ownRating: number,
  opponentRating: number
): number {
  const resultBonus = won ? 75 : 25;
  const underdogBonus = won ? Math.min(40, Math.max(0, Math.round((opponentRating - ownRating) / 10))) : 0;
  return Math.max(0, Math.round((25 + performance * 0.2 + resultBonus + underdogBonus) * competitionMultiplier * repeatMultiplier));
}

export function levelUnlocksBetween(before: number, after: number): CosmeticDefinition[] {
  return COSMETIC_CATALOG.filter((item) => item.level !== undefined && item.level > before && item.level <= after);
}

export function masteryRank(track: MasteryTrack, progress: number): 0 | 1 | 2 | 3 {
  const thresholds = MASTERY_THRESHOLDS[track];
  if (progress >= thresholds[2]) return 3;
  if (progress >= thresholds[1]) return 2;
  if (progress >= thresholds[0]) return 1;
  return 0;
}
