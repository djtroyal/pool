export type GameMode = 'eight-ball' | 'nine-ball';
export type Competition = 'casual' | 'ranked';
export type RulesetId = 'house' | 'wpa' | 'csi-bca';
export type HouseCallMode = 'eight-only' | 'all-shots';
export type OpponentKind = 'human' | 'cpu';
export type CpuDifficulty = 'rookie' | 'club' | 'expert' | 'master';
export type GamePhase = 'aiming' | 'rack-over' | 'session-over';
export type BallGroup = 'solids' | 'stripes';
export type ShotClock = 0 | 45 | 60;
export type AimGuideLevel = 0 | 1 | 2 | 3 | 4;
export type TrajectoryAid = 'advancedCuePath' | 'simpleObjectPath' | 'advancedObjectPath' | 'pottedPocket' | 'railContinuations' | 'jumpArc';
export type TrajectoryAidFlags = Record<TrajectoryAid, boolean>;
export type ReboundDepth = 0 | 1 | 2 | 3 | 4;
export type ImpactDepth = 1 | 2 | 3 | 4 | 5;
export interface TrajectoryPreferences {
  aids: TrajectoryAidFlags;
  rebounds: ReboundDepth;
  impacts: ImpactDepth;
}
export type HostTrajectoryAid = Exclude<TrajectoryAid, 'jumpArc' | 'pottedPocket'>;
export type HostTrajectoryAidFlags = Record<HostTrajectoryAid, boolean>;
export type ClothSpeed = 'very-slow' | 'slow' | 'standard' | 'fast' | 'very-fast';
export type TableDesignId = 'classic-walnut' | 'light-oak' | 'tournament-black' | 'midnight-brass' | 'burnished-oak' | 'graphite-edge' | 'black-chrome';
export type ClothDesignId = 'emerald-solid' | 'tournament-blue' | 'burgundy' | 'charcoal' | 'teal-weave' | 'navy-diamond' | 'custom-solid' | 'bottle-green' | 'ink-blue' | 'oxblood-weave' | 'night-grid';
export type RoomVisibility = 'private' | 'open';
export type BallDisposition = 'on-table' | 'pocketed' | 'off-table';
export type RankTier = 'unranked' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';
export type MasteryTrack = 'break' | 'precision' | 'rails' | 'control' | 'technique' | 'runout';
export type LeaderboardBoard = 'overall' | GameMode;
export type LeaderboardPeriod = 'all-time' | 'thirty-days';
export type PracticeChallengeId =
  | 'stop-line' | 'follow-window' | 'draw-ladder' | 'speed-control'
  | 'cut-ladder' | 'long-pot' | 'bank-window'
  | 'kick-escape' | 'safety-lock' | 'multi-rail-shape'
  | 'jump-gate' | 'masse-bend' | 'break-lab'
  | 'eight-ball-pattern' | 'nine-ball-rotation';
export type ChallengeMedal = 0 | 1 | 2 | 3;
export type PlayerKind = 'human' | 'cpu';
export type ShotKind = 'normal' | 'push-out';

export interface Vec2 { x: number; y: number }
export interface Vec3 extends Vec2 { z: number }
export interface Quaternion { x: number; y: number; z: number; w: number }

export interface BallState {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  orientation: Quaternion;
  disposition: BallDisposition;
}

export interface SpinInput { side: number; vertical: number }

export interface CalledShot { ballId: number; pocketId: string }

export interface ShotInput {
  revision: number;
  angle: number;
  power: number;
  elevation: number;
  english: SpinInput;
  calledShot?: CalledShot | null | undefined;
  shotKind?: ShotKind | undefined;
}

export interface PhysicsConfig { clothSpeed: ClothSpeed }

export interface RoomSettings {
  mode: GameMode;
  competition: Competition;
  ruleset: RulesetId;
  houseCallMode: HouseCallMode;
  opponent: OpponentKind;
  cpuDifficulty: CpuDifficulty;
  visibility: RoomVisibility;
  allowedTrajectoryAids: HostTrajectoryAidFlags;
  shotClock: ShotClock;
  clothSpeed: ClothSpeed;
  tableDesign: TableDesignId;
  clothDesign: ClothDesignId;
  customClothColor: string;
  allowElevatedShots: boolean;
  chatEnabled: boolean;
  chatFilterEnabled: boolean;
}

export interface CosmeticLoadout {
  cue: string;
  tableFinish: TableDesignId;
  cloth: ClothDesignId;
  trail: string;
  frame: string;
  stinger: string;
  cueBall: string;
  ballSet: string;
  soundSet: string;
}

export type LegacyAvatarFeature = 'face' | 'hair' | 'brows' | 'eyes' | 'nose' | 'mouth' | 'facialHair' | 'glasses' | 'mark';
export type AvatarFeature = 'face' | 'ears' | 'hair' | 'brows' | 'eyes' | 'nose' | 'mouth' | 'facialHair' | 'glasses' | 'detail' | 'accessory';
export interface AvatarPartTransform { x: number; y: number; scale: number; rotation: number }
export interface LegacyAvatarSpec {
  version: 1;
  skinTone: string;
  face: string;
  hair: string;
  hairColor: string;
  brows: string;
  browColor: string;
  eyes: string;
  eyeColor: string;
  nose: string;
  mouth: string;
  mouthColor: string;
  facialHair: string;
  glasses: string;
  mark: string;
  transforms: Partial<Record<LegacyAvatarFeature, AvatarPartTransform>>;
}
export interface AvatarSpec {
  version: 2;
  skinTone: string;
  face: string;
  ears: string;
  hair: string;
  hairColor: string;
  brows: string;
  browColor: string;
  eyes: string;
  eyeColor: string;
  nose: string;
  mouth: string;
  mouthColor: string;
  facialHair: string;
  glasses: string;
  glassesColor: string;
  detail: string;
  detailColor: string;
  accessory: string;
  accessoryColor: string;
  backgroundColor: string;
  transforms: Partial<Record<AvatarFeature, AvatarPartTransform>>;
}
export type AvatarInput = AvatarSpec | LegacyAvatarSpec;

export interface ModeStanding {
  mode: GameMode;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  lastRatedAt: number | null;
  ratedRacks: number;
  wins: number;
  losses: number;
  tier: RankTier;
  provisional: boolean;
}

export interface CareerStats {
  gamesPlayed: number; wins: number; losses: number; strokes: number; playtimeMs: number;
  ballsPocketed: number; legalPockets: number; fouls: number; scratches: number; breakScratches: number;
  illegalBreaks: number; wrongFirstBalls: number; offTableBalls: number; shotClockFouls: number;
  breaksTaken: number; ballsOnBreak: number; winsAsBreaker: number; breakAndRuns: number;
  eightOnBreak: number; nineOnBreak: number; eightBallFoulLosses: number; runouts: number;
  safeties: number; calledShots: number; calledMakes: number; wrongPockets: number; slopPockets: number;
  jumps: number; jumpMakes: number; masses: number; masseMakes: number; swerves: number;
  banks: number; kicks: number; combinations: number; multiRailShots: number;
  powerSum: number; aimTimeMs: number; englishShots: number; followShots: number; drawShots: number;
  leftEnglishShots: number; rightEnglishShots: number; longestRun: number;
}

export interface PlayerStats {
  total: CareerStats;
  byMode: Record<GameMode, CareerStats>;
  humanGames: CareerStats;
  cpuGames: CareerStats;
  styleSamples: PlaystyleSample[];
  trackingSince: number;
}

export interface PlaystyleSample {
  at: number;
  axes: Partial<Record<'power' | 'spin' | 'vertical-spin' | 'tempo' | 'intent' | 'route' | 'technique' | 'discipline', number>>;
}

export type PlaystyleTrend = 'rising' | 'steady' | 'falling';
export interface PlaystyleTag {
  id: string;
  label: string;
  score: number;
  confidence: number;
  evidence: string;
  trend?: PlaystyleTrend | undefined;
  kind?: 'archetype' | 'specialist' | 'after-hours' | undefined;
}
export interface PlaystyleAxis {
  id: string;
  lowLabel: string;
  highLabel: string;
  value: number;
  confidence: number;
  trend: PlaystyleTrend;
}
export interface PlaystyleProfile {
  primary: PlaystyleTag[];
  tags: PlaystyleTag[];
  axes: PlaystyleAxis[];
  preferences: Record<string, number>;
  qualifyingShots: number;
  qualifyingRacks: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: AvatarSpec;
  totalXp: number;
  xpSpent: number;
  availableXp: number;
  level: number;
  standings: Record<GameMode, ModeStanding>;
  loadout: CosmeticLoadout;
  unlocks: string[];
  mastery: Record<MasteryTrack, number>;
  challenges: ChallengeProgress[];
  stats: PlayerStats;
  playstyle: PlaystyleProfile;
}

export interface ChallengeProgress {
  challengeId: PracticeChallengeId;
  medal: ChallengeMedal;
  bestScore: number;
}

export interface PracticeChallengeDefinition {
  id: PracticeChallengeId;
  name: string;
  description: string;
  objective: string;
  medalScores: [number, number, number];
}

export interface PracticeChallengeAttempt {
  attemptId: string;
  definition: PracticeChallengeDefinition;
  game: GameSnapshot;
  assisted: boolean;
}

export interface PracticeChallengeResult {
  challengeId: PracticeChallengeId;
  score: number;
  medal: ChallengeMedal;
  summary: string;
  xp: number;
  newBest: boolean;
  unlocks: UnlockEvent[];
  profile: PlayerProfile;
  playback: ShotPlayback;
  assisted: boolean;
}

export interface ProfileSession { profileId: string; token: string; passport: string }
export interface ProfileEnvelope { session: ProfileSession; profile: PlayerProfile; recoveryKey?: string | undefined }

export type RuleEventCode =
  | 'legal-break' | 'illegal-break' | 'scratch' | 'ball-off-table'
  | 'wrong-first-ball' | 'no-rail-or-pocket' | 'groups-assigned'
  | 'turn-continues' | 'turn-changes' | 'ball-in-hand'
  | 'eight-respotted' | 'nine-respotted' | 'rack-won'
  | 'shot-clock-foul' | 'player-forfeit'
  | 'call-required' | 'call-missed' | 'call-made'
  | 'push-out-available' | 'push-out' | 'three-foul-loss';

export interface RuleEvent {
  code: RuleEventCode;
  message: string;
  playerIndex?: number | undefined;
  ballId?: number | undefined;
}

export interface GameSnapshot {
  revision: number;
  mode: GameMode;
  ruleset: RulesetId;
  rulesetVersion: number;
  houseCallMode: HouseCallMode;
  phase: GamePhase;
  balls: BallState[];
  pocketedOrder: number[];
  turnIndex: 0 | 1;
  breakerIndex: 0 | 1;
  scores: [number, number];
  groups: [BallGroup | null, BallGroup | null];
  tableOpen: boolean;
  breakShot: boolean;
  ballInHand: boolean;
  placement: 'kitchen' | 'anywhere' | null;
  shotNumber: number;
  winnerIndex: 0 | 1 | null;
  consecutiveFouls: [number, number];
  pushOutAvailable: boolean;
  pushOutReturnTo: 0 | 1 | null;
  shotClockEndsAt: number | null;
  lastEvents: RuleEvent[];
}

export type ContactKind = 'ball-ball' | 'cushion' | 'jaw' | 'pocket' | 'cloth' | 'off-table';

export interface ContactEvent {
  kind: ContactKind;
  time: number;
  impactSpeed: number;
  point: Vec3;
  ballIds: number[];
  surfaceId?: string | undefined;
  normal?: Vec3 | undefined;
}

export interface ShotTrace {
  firstContact: number | null;
  firstContactTime: number | null;
  pocketed: number[];
  offTable: number[];
  railContacts: number[];
  anyRailAfterContact: boolean;
  cueScratch: boolean;
  contacts: ContactEvent[];
  duration: number;
}

export interface PlaybackBall {
  id: number;
  x: number;
  y: number;
  z: number;
  orientation: Quaternion;
  disposition: BallDisposition;
}

export interface PlaybackFrame { time: number; balls: PlaybackBall[] }

export interface ShotPlayback {
  id: string;
  startedAt: number;
  durationMs: number;
  shot: ShotInput;
  initialBalls: BallState[];
  frames: PlaybackFrame[];
  trace: ShotTrace;
  finalSnapshot: GameSnapshot;
  scoreEvent: ShotScoreEvent | null;
}

export interface ShotSimulation { balls: BallState[]; frames: PlaybackFrame[]; trace: ShotTrace }

export interface TrajectoryPoint extends Vec3 { time: number; airborne: boolean }

export interface TrajectoryBallPath {
  ballId: number;
  parentBallId: number | null;
  generation: number;
  activatedAt: number;
  points: TrajectoryPoint[];
}

export interface TrajectoryImpact {
  index: number;
  generation: number;
  time: number;
  point: Vec3;
  incomingBallId: number;
  outgoingBallId: number;
}

export interface TrajectoryPreview {
  cuePath: TrajectoryPoint[];
  objectPath: TrajectoryPoint[];
  contactPoint: Vec2 | null;
  ghostBall: Vec2 | null;
  objectBallId: number | null;
  objectPaths: TrajectoryBallPath[];
  impacts: TrajectoryImpact[];
  contacts: ContactEvent[];
}

export type ShotOptimizerQuality = 'fast' | 'balanced' | 'deep';
export type ShotOptimizerTarget = BallGroup | 'rotation' | 'open';
export type ShotOptimizerPhase = 'first-shot' | 'follow-up' | 'validating';

export interface OptimizedPot {
  ballId: number;
  pocketId: string;
  time: number;
}

export interface OptimizedShotLine {
  shot: ShotInput;
  pots: OptimizedPot[];
  ownedPots: number[];
  opponentPots: number[];
  rackWin: boolean;
  afterFingerprint: string;
}

export interface ShotOptimizerRequest {
  game: GameSnapshot;
  config: PhysicsConfig;
  quality: ShotOptimizerQuality;
  sandbox: boolean;
  initialShot?: ShotInput | undefined;
}

export interface ShotOptimizerProgress {
  phase: ShotOptimizerPhase;
  evaluated: number;
  total: number;
  bestNow: number;
  bestNext: number;
}

export interface ShotOptimizerResult {
  quality: ShotOptimizerQuality;
  target: ShotOptimizerTarget;
  provisionalTarget: boolean;
  primary: OptimizedShotLine;
  followUp: OptimizedShotLine | null;
  robustness: number;
  evaluated: number;
}

export interface TrajectoryPredictionConfig extends PhysicsConfig {
  rebounds: ReboundDepth;
  impacts: ImpactDepth;
}

export type PerformanceCode =
  | 'legal-pocket' | 'cut' | 'distance' | 'bank' | 'kick' | 'combination'
  | 'jump' | 'curve' | 'multi-pot' | 'legal-break' | 'break-spread'
  | 'position' | 'safety' | 'streak' | 'rack-win' | 'runout' | 'break-and-run'
  | 'foul' | 'scratch' | 'illegal-break' | 'off-table';

export interface PerformanceComponent {
  code: PerformanceCode;
  label: string;
  points: number;
  atTime: number;
  point: Vec2 | null;
  ballId: number | null;
}

export interface ShotScoreEvent {
  id: string;
  shooterIndex: 0 | 1;
  shotNumber: number;
  components: PerformanceComponent[];
  delta: number;
  totals: [number, number];
  streak: number;
  technique: string | null;
}

export interface RoomProgress {
  rackId: string;
  performanceScores: [number, number];
  shotStreaks: [number, number];
  settled: boolean;
}

export interface UnlockEvent { cosmeticId: string; name: string; source: string }

export interface PlayerRackReward {
  profileId: string;
  xp: number;
  totalXp: number;
  levelBefore: number;
  levelAfter: number;
  ratingBefore: number;
  ratingAfter: number;
  tierBefore: RankTier;
  tierAfter: RankTier;
  unlocks: UnlockEvent[];
}

export interface RackSettlement {
  rackId: string;
  competition: Competition;
  mode: GameMode;
  winnerIndex: 0 | 1;
  performanceScores: [number, number];
  rewards: [PlayerRackReward, PlayerRackReward];
}

export interface LeaderboardEntry {
  rank: number;
  profileId: string;
  name: string;
  level: number;
  value: number;
  tier: RankTier | null;
  ratedRacks: number;
  wins: number;
  losses: number;
  frame: string;
  avatar: AvatarSpec;
  ratingDeviation: number | null;
  isSelf: boolean;
}

export interface LeaderboardPage {
  board: LeaderboardBoard;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  aroundMe: LeaderboardEntry[];
}

export interface PlayerPublic {
  id: string;
  profileId: string;
  name: string;
  kind: PlayerKind;
  avatar: AvatarSpec;
  connected: boolean;
  ready: boolean;
  level: number;
  standing: ModeStanding;
  loadout: CosmeticLoadout;
}

export interface RoomSnapshot {
  code: string;
  hostPlayerId: string;
  settings: RoomSettings;
  status: 'lobby' | 'playing' | 'finished';
  players: [PlayerPublic | null, PlayerPublic | null];
  game: GameSnapshot | null;
  playbackUntil: number | null;
  progress: RoomProgress | null;
}

export type RoomDirectoryStatus = 'waiting' | 'full' | 'playing' | 'rack-over' | 'reconnecting';

interface RoomDirectoryBase {
  listingId: string;
  hostName: string;
  mode: GameMode;
  competition: Competition;
  status: RoomDirectoryStatus;
  playerCount: 1 | 2;
  hostLevel: number;
  hostTier: RankTier;
  ruleset: RulesetId;
  opponent: OpponentKind;
}

export interface PrivateRoomDirectoryEntry extends RoomDirectoryBase {
  visibility: 'private';
  joinable: false;
}

export interface OpenRoomDirectoryEntry extends RoomDirectoryBase {
  visibility: 'open';
  joinable: boolean;
  players: string[];
  scores: [number, number] | null;
}

export type RoomDirectoryEntry = PrivateRoomDirectoryEntry | OpenRoomDirectoryEntry;

export interface PlayerSession { roomCode: string; playerId: string; token: string }

export type ErrorCode =
  | 'invalid-input' | 'room-not-found' | 'room-not-open' | 'room-full'
  | 'not-host' | 'not-ready' | 'not-your-turn' | 'stale-state'
  | 'invalid-placement' | 'shot-in-progress' | 'session-expired'
  | 'profile-required' | 'profile-not-found' | 'name-taken' | 'name-blocked' | 'cosmetic-locked'
  | 'invalid-call' | 'friend-not-found' | 'friend-blocked' | 'invite-expired' | 'replay-not-found'
  | 'passport-invalid' | 'insufficient-xp' | 'already-owned' | 'chat-disabled' | 'rate-limited';

export interface StorePurchaseResult { profile: PlayerProfile; session: ProfileSession; cosmeticId: string }

export interface ChatMessage {
  id: string;
  clientMessageId: string;
  playerId: string;
  profileId: string;
  name: string;
  text: string;
  sentAt: number;
  filtered: boolean;
}

export interface ChatSnapshot { enabled: boolean; filterEnabled: boolean; messages: ChatMessage[] }

export type CommandResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export type Ack<T = undefined> = (result: CommandResult<T>) => void;

export interface AimPresence {
  angle: number;
  power: number;
  elevation: number;
  english: SpinInput;
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar: AvatarSpec;
  level: number;
  standings: Record<GameMode, ModeStanding>;
  stats: PlayerStats;
  playstyle: PlaystyleProfile;
  loadout: CosmeticLoadout;
}

export type FriendPresence = 'offline' | 'online' | 'open-room' | 'private-room';
export interface FriendSummary extends PublicProfile { presence: FriendPresence; joinableListingId: string | null }
export interface FriendRequest { profile: PublicProfile; direction: 'incoming' | 'outgoing'; createdAt: number }
export interface FriendsSnapshot { friends: FriendSummary[]; requests: FriendRequest[]; blockedProfileIds: string[] }
export interface RoomInvite { id: string; from: PublicProfile; roomCode: string; expiresAt: number }

export interface ReplayParticipant {
  profileId: string;
  name: string;
  avatar: AvatarSpec;
  standing: ModeStanding;
  loadout: CosmeticLoadout;
}
export interface ReplayShotRecord { shooterIndex: 0 | 1; aimTimeMs: number; playback: ShotPlayback }
export interface ReplaySummary {
  id: string;
  mode: GameMode;
  ruleset: RulesetId;
  endedAt: number;
  qualityScore: number;
  participants: [ReplayParticipant, ReplayParticipant];
  winnerIndex: 0 | 1;
  shotCount: number;
  highlights: string[];
}
export interface ReplayDocument extends ReplaySummary {
  version: 1;
  settings: RoomSettings;
  initialSnapshot: GameSnapshot;
  shots: ReplayShotRecord[];
  checksum: string;
}
export interface ReplayPage { mode: GameMode; period: LeaderboardPeriod; entries: ReplaySummary[] }

export interface ClientToServerEvents {
  'profile:create': (payload: { name: string; avatar?: AvatarInput | undefined }, ack: Ack<{ session: ProfileSession; profile: PlayerProfile; recoveryKey?: string | undefined }>) => void;
  'profile:resume': (payload: { token: string }, ack: Ack<{ session: ProfileSession; profile: PlayerProfile }>) => void;
  'profile:update': (payload: { name: string }, ack: Ack<PlayerProfile>) => void;
  'profile:avatar': (payload: { avatar: AvatarInput }, ack: Ack<PlayerProfile>) => void;
  'profile:public': (payload: { profileId?: string | undefined; name?: string | undefined }, ack: Ack<PublicProfile>) => void;
  'profile:recovery-create': (payload: Record<string, never>, ack: Ack<{ recoveryKey: string }>) => void;
  'profile:recover': (payload: { recoveryKey: string }, ack: Ack<{ session: ProfileSession; profile: PlayerProfile; recoveryKey: string }>) => void;
  'profile:equip': (payload: { loadout: CosmeticLoadout }, ack: Ack<PlayerProfile>) => void;
  'store:purchase': (payload: { cosmeticId: string; idempotencyKey: string }, ack: Ack<StorePurchaseResult>) => void;
  'friends:list': (payload: Record<string, never>, ack: Ack<FriendsSnapshot>) => void;
  'friends:search': (payload: { name: string }, ack: Ack<PublicProfile>) => void;
  'friends:request': (payload: { profileId: string }, ack: Ack<FriendsSnapshot>) => void;
  'friends:respond': (payload: { profileId: string; accept: boolean }, ack: Ack<FriendsSnapshot>) => void;
  'friends:remove': (payload: { profileId: string }, ack: Ack<FriendsSnapshot>) => void;
  'friends:block': (payload: { profileId: string; blocked: boolean }, ack: Ack<FriendsSnapshot>) => void;
  'friends:invite': (payload: { profileId: string }, ack: Ack<RoomInvite>) => void;
  'room:join-invite': (payload: { inviteId: string }, ack: Ack<{ session: PlayerSession; room: RoomSnapshot }>) => void;
  'replays:list': (payload: { mode: GameMode; period: LeaderboardPeriod }, ack: Ack<ReplayPage>) => void;
  'replay:get': (payload: { replayId: string }, ack: Ack<ReplayDocument>) => void;
  'leaderboard:list': (payload: { board: LeaderboardBoard; period: LeaderboardPeriod }, ack: Ack<LeaderboardPage>) => void;
  'practice:challenge-start': (payload: { challengeId: PracticeChallengeId }, ack: Ack<PracticeChallengeAttempt>) => void;
  'practice:challenge-assist': (payload: { attemptId: string }, ack: Ack<{ assisted: true }>) => void;
  'practice:challenge-submit': (payload: { attemptId: string; shot: ShotInput }, ack: Ack<PracticeChallengeResult>) => void;
  'rooms:list': (payload: Record<string, never>, ack: Ack<RoomDirectoryEntry[]>) => void;
  'room:create': (payload: { settings: RoomSettings }, ack: Ack<{ session: PlayerSession; room: RoomSnapshot }>) => void;
  'room:join': (payload: { code: string }, ack: Ack<{ session: PlayerSession; room: RoomSnapshot }>) => void;
  'room:join-open': (payload: { listingId: string }, ack: Ack<{ session: PlayerSession; room: RoomSnapshot }>) => void;
  'room:resume': (payload: { code: string; token: string }, ack: Ack<{ session: PlayerSession; room: RoomSnapshot }>) => void;
  'room:settings': (payload: { settings: RoomSettings }, ack: Ack<RoomSnapshot>) => void;
  'room:chat-settings': (payload: { enabled: boolean; filterEnabled: boolean }, ack: Ack<ChatSnapshot>) => void;
  'chat:send': (payload: { clientMessageId: string; text: string }, ack: Ack<ChatMessage>) => void;
  'player:ready': (payload: { ready: boolean }, ack: Ack<RoomSnapshot>) => void;
  'match:start': (payload: Record<string, never>, ack: Ack<RoomSnapshot>) => void;
  'cue:place': (payload: Vec2, ack: Ack<RoomSnapshot>) => void;
  'shot:take': (payload: ShotInput, ack: Ack<{ shotId: string }>) => void;
  'rack:next': (payload: Record<string, never>, ack: Ack<RoomSnapshot>) => void;
  'push-out:return': (payload: Record<string, never>, ack: Ack<RoomSnapshot>) => void;
  'room:leave': (payload: Record<string, never>, ack: Ack) => void;
  'aim:update': (payload: AimPresence) => void;
}

export interface ServerToClientEvents {
  'profile:snapshot': (profile: PlayerProfile) => void;
  'profile:passport': (session: ProfileSession) => void;
  'rack:settlement': (settlement: RackSettlement) => void;
  'rooms:directory': (rooms: RoomDirectoryEntry[]) => void;
  'room:snapshot': (room: RoomSnapshot) => void;
  'shot:playback': (playback: ShotPlayback) => void;
  'rules:event': (event: RuleEvent) => void;
  'presence:aim': (payload: { playerId: string } & AimPresence) => void;
  'friends:snapshot': (snapshot: FriendsSnapshot) => void;
  'friends:invite': (invite: RoomInvite) => void;
  'connection:notice': (payload: { message: string; tone: 'info' | 'warning' | 'success' }) => void;
  'chat:message': (message: ChatMessage) => void;
  'chat:snapshot': (snapshot: ChatSnapshot) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  profileId?: string | undefined;
  roomCode?: string | undefined;
  playerId?: string | undefined;
  token?: string | undefined;
}
