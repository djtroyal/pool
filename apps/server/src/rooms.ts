import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  applyForfeit,
  applyShotClockFoul,
  ALL_HOST_TRAJECTORY_AIDS,
  analyzeShotPerformance,
  calledShotIsValid,
  chooseCpuPlacement,
  chooseCpuShot,
  createPracticeChallenge,
  createGame,
  createNextRack,
  defaultAvatar,
  defaultStanding,
  DEFAULT_COSMETIC_LOADOUT,
  evaluatePracticeChallenge,
  isValidPlacement,
  placeBall,
  practiceChallengeDefinition,
  resolveShot,
  returnPushOut,
  simulateShot,
  type ClientToServerEvents,
  type AvatarInput,
  type ChatMessage,
  type ChatSnapshot,
  type CommandResult,
  type ErrorCode,
  type GameSnapshot,
  type InterServerEvents,
  type LeaderboardBoard,
  type LeaderboardPage,
  type LeaderboardPeriod,
  type MasteryTrack,
  type PlayerPublic,
  type PlayerProfile,
  type PublicProfile,
  type FriendsSnapshot,
  type FriendSummary,
  type RoomInvite,
  type PracticeChallengeAttempt,
  type PracticeChallengeId,
  type PracticeChallengeResult,
  type ProfileSession,
  type RackSettlement,
  type RoomProgress,
  type PlayerSession,
  type RoomDirectoryEntry,
  type RoomDirectoryStatus,
  type RoomSettings,
  type RoomSnapshot,
  type StorePurchaseResult,
  type ReplayDocument,
  type ReplayPage,
  type ServerToClientEvents,
  type ShotInput,
  type ShotPlayback,
  type SocketData,
  type Vec2
} from '@breakroom/game-core';
import {
  CosmeticLockedError,
  AlreadyOwnedError,
  FriendError,
  InsufficientXpError,
  PassportInvalidError,
  ProfileNameBlockedError,
  ProfileNameTakenError,
  ProfileNotFoundError,
  type ProgressionStore
} from './progression.js';

type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const RECONNECT_GRACE_MS = 120_000;
const ROOM_IDLE_MS = 30 * 60_000;
const CLOTH_SPEEDS = ['very-slow', 'slow', 'standard', 'fast', 'very-fast'];
const TABLE_DESIGNS = ['classic-walnut', 'light-oak', 'tournament-black', 'midnight-brass', 'burnished-oak', 'graphite-edge', 'black-chrome'];
const CLOTH_DESIGNS = ['emerald-solid', 'tournament-blue', 'burgundy', 'charcoal', 'teal-weave', 'navy-diamond', 'custom-solid', 'bottle-green', 'ink-blue', 'oxblood-weave', 'night-grid'];
const HOST_TRAJECTORY_AIDS = ['advancedCuePath', 'simpleObjectPath', 'advancedObjectPath', 'railContinuations'] as const;
const RULESETS = ['house', 'wpa', 'csi-bca'];
const CALL_MODES = ['eight-only', 'all-shots'];
const CPU_DIFFICULTIES = ['rookie', 'club', 'expert', 'master'];

interface InternalPlayer extends PlayerPublic {
  token: string;
  socketId: string | null;
  disconnectedAt: number | null;
  disconnectTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  listingId: string;
  hostPlayerId: string;
  settings: RoomSettings;
  players: [InternalPlayer | null, InternalPlayer | null];
  game: GameSnapshot | null;
  playbackUntil: number | null;
  lastPlayback: ShotPlayback | null;
  lastActivity: number;
  pausedClockMs: number | null;
  progress: RoomProgress | null;
  mastery: [Partial<Record<MasteryTrack, number>>, Partial<Record<MasteryTrack, number>>];
  shotCounts: [number, number];
  startedAt: number | null;
  cpuActing: boolean;
  turnBeganAt: number;
  replayInitial: GameSnapshot | null;
  replayShots: ReplayDocument['shots'];
  replayHighlights: string[];
  chatMessages: ChatMessage[];
  chatRate: Map<string, number[]>;
  chatMessageIds: Map<string, ChatMessage>;
}

interface SessionContext {
  room: Room;
  player: InternalPlayer;
  index: 0 | 1;
}

interface InternalPracticeAttempt {
  profileId: string;
  challengeId: PracticeChallengeId;
  game: GameSnapshot;
  expiresAt: number;
  assisted: boolean;
}

interface InternalInvite extends RoomInvite { toProfileId: string }

function ok<T>(data: T): CommandResult<T> { return { ok: true, data }; }
function fail<T>(code: ErrorCode, message: string): CommandResult<T> { return { ok: false, code, message }; }

function validSettings(settings: RoomSettings): boolean {
  return (settings.mode === 'eight-ball' || settings.mode === 'nine-ball')
    && (settings.competition === 'casual' || settings.competition === 'ranked')
    && RULESETS.includes(settings.ruleset)
    && CALL_MODES.includes(settings.houseCallMode)
    && (settings.opponent === 'human' || settings.opponent === 'cpu')
    && CPU_DIFFICULTIES.includes(settings.cpuDifficulty)
    && !(settings.competition === 'ranked' && settings.opponent === 'cpu')
    && (settings.visibility === 'private' || settings.visibility === 'open')
    && settings.allowedTrajectoryAids !== null && typeof settings.allowedTrajectoryAids === 'object'
    && HOST_TRAJECTORY_AIDS.every((aid) => typeof settings.allowedTrajectoryAids[aid] === 'boolean')
    && ([0, 45, 60] as number[]).includes(settings.shotClock)
    && CLOTH_SPEEDS.includes(settings.clothSpeed)
    && TABLE_DESIGNS.includes(settings.tableDesign)
    && CLOTH_DESIGNS.includes(settings.clothDesign)
    && /^#[0-9a-f]{6}$/i.test(settings.customClothColor)
    && typeof settings.allowElevatedShots === 'boolean'
    && typeof settings.chatEnabled === 'boolean'
    && typeof settings.chatFilterEnabled === 'boolean';
}

const CHAT_FILTER = /\b(?:fuck(?:ing|er|ed)?|shit(?:ty)?|bitch(?:es)?|cunt|nigg(?:er|a)s?|fagg?ot|retard(?:ed)?|kys)\b/gi;

function cleanChatInput(input: string): string {
  return Array.from(input.normalize('NFKC'), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function normalizeChatText(input: string): { text: string; filtered: boolean } {
  const compact = cleanChatInput(input);
  const filtered = CHAT_FILTER.test(compact);
  CHAT_FILTER.lastIndex = 0;
  return { text: filtered ? compact.replace(CHAT_FILTER, (match) => '•'.repeat(Math.min(8, match.length))) : compact, filtered };
}

function gameplaySettingsChanged(a: RoomSettings, b: RoomSettings): boolean {
  return a.mode !== b.mode || a.competition !== b.competition || a.ruleset !== b.ruleset || a.houseCallMode !== b.houseCallMode
    || a.opponent !== b.opponent || a.cpuDifficulty !== b.cpuDifficulty
    || HOST_TRAJECTORY_AIDS.some((aid) => a.allowedTrajectoryAids[aid] !== b.allowedTrajectoryAids[aid]) || a.shotClock !== b.shotClock
    || a.clothSpeed !== b.clothSpeed || a.allowElevatedShots !== b.allowElevatedShots;
}

function cloneSettings(settings: RoomSettings): RoomSettings {
  const cloned: RoomSettings = {
    ...settings,
    allowedTrajectoryAids: Object.fromEntries(
      HOST_TRAJECTORY_AIDS.map((aid) => [aid, settings.allowedTrajectoryAids[aid]])
    ) as RoomSettings['allowedTrajectoryAids']
  };
  return cloned.competition === 'ranked' ? {
    ...cloned,
    ruleset: 'wpa',
    houseCallMode: 'eight-only',
    opponent: 'human',
    shotClock: 60,
    clothSpeed: 'standard',
    allowElevatedShots: true,
    allowedTrajectoryAids: { ...ALL_HOST_TRAJECTORY_AIDS }
  } : cloned;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly practiceAttempts = new Map<string, InternalPracticeAttempt>();
  private readonly invites = new Map<string, InternalInvite>();

  constructor(private readonly io: GameServer, readonly progression: ProgressionStore) {
    const maintenance = setInterval(() => this.maintain(), 500);
    maintenance.unref();
  }

  createProfile(socket: GameSocket, name: string, avatar?: AvatarInput): CommandResult<{ session: ProfileSession; profile: PlayerProfile; recoveryKey?: string }> {
    try {
      const created = this.progression.createProfile(name, avatar);
      socket.data.profileId = created.profile.id;
      queueMicrotask(() => this.broadcastDirectory());
      return ok(created);
    } catch (error) {
      if (error instanceof ProfileNameTakenError) return fail('name-taken', error.message);
      if (error instanceof ProfileNameBlockedError) return fail('name-blocked', error.message);
      if (error instanceof CosmeticLockedError) return fail('cosmetic-locked', error.message);
      if (error instanceof TypeError) return fail('invalid-input', error.message);
      throw error;
    }
  }

  resumeProfile(socket: GameSocket, token: string): CommandResult<{ session: ProfileSession; profile: PlayerProfile }> {
    try {
      const resumed = this.progression.resumeProfile(token);
      socket.data.profileId = resumed.profile.id;
      queueMicrotask(() => this.broadcastDirectory());
      return ok(resumed);
    } catch (error) {
      if (error instanceof PassportInvalidError) return fail('passport-invalid', error.message);
      if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message);
      throw error;
    }
  }

  updateProfile(socket: GameSocket, name: string): CommandResult<PlayerProfile> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      const profile = this.progression.updateName(socket.data.profileId, name);
      this.refreshProfileInRooms(profile);
      this.emitProfile(profile.id);
      return ok(profile);
    } catch (error) {
      if (error instanceof ProfileNameTakenError) return fail('name-taken', error.message);
      if (error instanceof ProfileNameBlockedError) return fail('name-blocked', error.message);
      if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message);
      if (error instanceof TypeError) return fail('invalid-input', error.message);
      throw error;
    }
  }

  updateAvatar(socket: GameSocket, avatar: AvatarInput): CommandResult<PlayerProfile> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      const profile = this.progression.updateAvatar(socket.data.profileId, avatar);
      this.refreshProfileInRooms(profile);
      this.emitProfile(profile.id);
      return ok(profile);
    } catch (error) {
      if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message);
      if (error instanceof CosmeticLockedError) return fail('cosmetic-locked', error.message);
      if (error instanceof TypeError) return fail('invalid-input', error.message);
      throw error;
    }
  }

  publicProfile(socket: GameSocket, profileId?: string, name?: string): CommandResult<PublicProfile> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try { return ok(this.progression.publicProfile(profileId, name)); }
    catch (error) { if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message); throw error; }
  }

  createRecovery(socket: GameSocket): CommandResult<{ recoveryKey: string }> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    return ok({ recoveryKey: this.progression.createRecoveryKey(socket.data.profileId) });
  }

  recoverProfile(socket: GameSocket, recoveryKey: string): CommandResult<{ session: ProfileSession; profile: PlayerProfile; recoveryKey: string }> {
    try {
      const recovered = this.progression.recoverProfile(recoveryKey);
      socket.data.profileId = recovered.profile.id;
      return ok(recovered);
    } catch (error) { if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message); throw error; }
  }

  equipProfile(socket: GameSocket, loadout: PlayerProfile['loadout']): CommandResult<PlayerProfile> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      const profile = this.progression.equip(socket.data.profileId, loadout);
      this.refreshProfileInRooms(profile);
      this.emitProfile(profile.id);
      return ok(profile);
    } catch (error) {
      if (error instanceof CosmeticLockedError) return fail('cosmetic-locked', error.message);
      if (error instanceof ProfileNotFoundError) return fail('profile-not-found', error.message);
      throw error;
    }
  }

  purchaseCosmetic(socket: GameSocket, cosmeticId: string, idempotencyKey: string): CommandResult<StorePurchaseResult> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      const purchase = this.progression.purchase(socket.data.profileId, cosmeticId, idempotencyKey);
      this.refreshProfileInRooms(purchase.profile);
      this.emitProfile(purchase.profile.id);
      return ok(purchase);
    } catch (error) {
      if (error instanceof AlreadyOwnedError) return fail('already-owned', error.message);
      if (error instanceof InsufficientXpError) return fail('insufficient-xp', error.message);
      if (error instanceof CosmeticLockedError) return fail('cosmetic-locked', error.message);
      if (error instanceof TypeError) return fail('invalid-input', error.message);
      throw error;
    }
  }

  leaderboard(socket: GameSocket, board: LeaderboardBoard, period: LeaderboardPeriod): CommandResult<LeaderboardPage> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    if (!['overall', 'eight-ball', 'nine-ball'].includes(board) || !['all-time', 'thirty-days'].includes(period)) {
      return fail('invalid-input', 'That leaderboard does not exist.');
    }
    return ok(this.progression.leaderboard(board, period, socket.data.profileId));
  }

  private presenceFor(profileId: string): Pick<FriendSummary, 'presence' | 'joinableListingId'> {
    const room = [...this.rooms.values()].find((entry) => entry.players.some((player) => player?.profileId === profileId && player.connected));
    if (room) return {
      presence: room.settings.visibility === 'open' ? 'open-room' : 'private-room',
      joinableListingId: room.settings.visibility === 'open' && !room.game ? room.listingId : null
    };
    const online = [...this.io.sockets.sockets.values()].some((socket) => socket.connected && socket.data.profileId === profileId);
    return { presence: online ? 'online' : 'offline', joinableListingId: null };
  }

  private friendsFor(profileId: string): FriendsSnapshot {
    const records = this.progression.friendRecords(profileId);
    return {
      friends: records.friendIds.map((id): FriendSummary => ({ ...this.progression.publicProfile(id), ...this.presenceFor(id) })),
      requests: records.requests,
      blockedProfileIds: records.blockedProfileIds
    };
  }

  private emitFriends(profileIds: string[]): void {
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.profileId && profileIds.includes(socket.data.profileId)) socket.emit('friends:snapshot', this.friendsFor(socket.data.profileId));
    }
  }

  listFriends(socket: GameSocket): CommandResult<FriendsSnapshot> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    return ok(this.friendsFor(socket.data.profileId));
  }

  searchFriend(socket: GameSocket, name: string): CommandResult<PublicProfile> {
    return this.publicProfile(socket, undefined, name);
  }

  requestFriend(socket: GameSocket, otherId: string): CommandResult<FriendsSnapshot> {
    const id = socket.data.profileId;
    if (!id) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      this.progression.requestFriend(id, otherId);
      this.emitFriends([id, otherId]);
      return ok(this.friendsFor(id));
    } catch (error) {
      if (error instanceof ProfileNotFoundError) return fail('friend-not-found', error.message);
      if (error instanceof FriendError) return fail('friend-blocked', error.message);
      throw error;
    }
  }

  respondFriend(socket: GameSocket, otherId: string, accept: boolean): CommandResult<FriendsSnapshot> {
    const id = socket.data.profileId;
    if (!id) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      this.progression.respondFriend(id, otherId, accept);
      this.emitFriends([id, otherId]);
      return ok(this.friendsFor(id));
    } catch (error) { if (error instanceof FriendError) return fail('friend-not-found', error.message); throw error; }
  }

  removeFriend(socket: GameSocket, otherId: string): CommandResult<FriendsSnapshot> {
    const id = socket.data.profileId;
    if (!id) return fail('profile-required', 'Create or resume a player profile first.');
    this.progression.removeFriend(id, otherId);
    this.emitFriends([id, otherId]);
    return ok(this.friendsFor(id));
  }

  blockFriend(socket: GameSocket, otherId: string, blocked: boolean): CommandResult<FriendsSnapshot> {
    const id = socket.data.profileId;
    if (!id) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      this.progression.blockProfile(id, otherId, blocked);
      this.emitFriends([id, otherId]);
      return ok(this.friendsFor(id));
    } catch (error) { if (error instanceof FriendError || error instanceof ProfileNotFoundError) return fail('friend-not-found', error.message); throw error; }
  }

  inviteFriend(socket: GameSocket, otherId: string): CommandResult<RoomInvite> {
    const context = this.context(socket);
    if (!context || !socket.data.profileId) return fail('session-expired', 'Create a room before inviting a friend.');
    if (!this.progression.friendRecords(socket.data.profileId).friendIds.includes(otherId)) return fail('friend-not-found', 'Only friends can be invited.');
    const invite: InternalInvite = {
      id: randomUUID(), from: this.progression.publicProfile(socket.data.profileId), roomCode: context.room.code,
      expiresAt: Date.now() + 5 * 60_000, toProfileId: otherId
    };
    this.invites.set(invite.id, invite);
    for (const target of this.io.sockets.sockets.values()) if (target.data.profileId === otherId) target.emit('friends:invite', invite);
    return ok(invite);
  }

  joinInvite(socket: GameSocket, inviteId: string): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.expiresAt < Date.now() || invite.toProfileId !== socket.data.profileId) {
      this.invites.delete(inviteId);
      return fail('invite-expired', 'That room invitation expired.');
    }
    const room = this.rooms.get(invite.roomCode);
    if (!room) return fail('room-not-found', 'That room no longer exists.');
    this.invites.delete(inviteId);
    return this.joinRoom(socket, room);
  }

  startPracticeChallenge(socket: GameSocket, challengeId: PracticeChallengeId): CommandResult<PracticeChallengeAttempt> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try {
      const definition = practiceChallengeDefinition(challengeId);
      const game = createPracticeChallenge(challengeId);
      const attemptId = randomUUID();
      this.practiceAttempts.set(attemptId, { profileId: socket.data.profileId, challengeId, game, expiresAt: Date.now() + 30 * 60_000, assisted: false });
      return ok({ attemptId, definition, game, assisted: false });
    } catch (error) {
      if (error instanceof TypeError) return fail('invalid-input', error.message);
      throw error;
    }
  }

  assistPracticeChallenge(socket: GameSocket, attemptId: string): CommandResult<{ assisted: true }> {
    const profileId = socket.data.profileId;
    if (!profileId) return fail('profile-required', 'Create or resume a player profile first.');
    const attempt = this.practiceAttempts.get(attemptId);
    if (!attempt || attempt.profileId !== profileId || attempt.expiresAt < Date.now()) {
      this.practiceAttempts.delete(attemptId);
      return fail('session-expired', 'That practice attempt expired. Reset the challenge and try again.');
    }
    attempt.assisted = true;
    return ok({ assisted: true });
  }

  submitPracticeChallenge(socket: GameSocket, attemptId: string, shot: ShotInput): CommandResult<PracticeChallengeResult> {
    const profileId = socket.data.profileId;
    if (!profileId) return fail('profile-required', 'Create or resume a player profile first.');
    const attempt = this.practiceAttempts.get(attemptId);
    if (!attempt || attempt.profileId !== profileId || attempt.expiresAt < Date.now()) {
      this.practiceAttempts.delete(attemptId);
      return fail('session-expired', 'That practice attempt expired. Reset the challenge and try again.');
    }
    if (shot.revision !== attempt.game.revision) return fail('stale-state', 'The challenge table changed. Reset before shooting.');
    if (!Number.isFinite(shot.angle) || !Number.isFinite(shot.power) || shot.power < 0.04 || shot.power > 1
      || !Number.isFinite(shot.elevation) || shot.elevation < 0 || shot.elevation > 75
      || !Number.isFinite(shot.english.side) || !Number.isFinite(shot.english.vertical)
      || Math.hypot(shot.english.side, shot.english.vertical) > 1.001) {
      return fail('invalid-input', 'Shot angle, power, elevation, or English is invalid.');
    }
    this.practiceAttempts.delete(attemptId);
    const evaluation = evaluatePracticeChallenge(attempt.challengeId, attempt.game, shot);
    const award = attempt.assisted
      ? { xp: 0, newBest: false, unlocks: [], profile: this.progression.getProfile(profileId) }
      : this.progression.awardChallenge(profileId, attempt.challengeId, evaluation.score, evaluation.medal);
    const startedAt = Date.now() + 70;
    const playback: ShotPlayback = {
      id: randomUUID(),
      startedAt,
      durationMs: Math.ceil(evaluation.simulation.trace.duration * 1000),
      shot,
      initialBalls: attempt.game.balls,
      frames: evaluation.simulation.frames,
      trace: evaluation.simulation.trace,
      finalSnapshot: evaluation.finalSnapshot,
      scoreEvent: null
    };
    this.emitProfile(profileId);
    return ok({
      challengeId: attempt.challengeId,
      score: evaluation.score,
      medal: evaluation.medal,
      summary: evaluation.summary,
      xp: award.xp,
      newBest: award.newBest,
      unlocks: award.unlocks,
      profile: award.profile,
      playback,
      assisted: attempt.assisted
    });
  }

  private profileForSocket(socket: GameSocket): PlayerProfile | null {
    if (!socket.data.profileId) return null;
    try { return this.progression.getProfile(socket.data.profileId); } catch { return null; }
  }

  private emitProfile(profileId: string): void {
    const profile = this.progression.getProfile(profileId);
    const passport = this.progression.sessionForProfile(profileId);
    for (const activeSocket of this.io.sockets.sockets.values()) {
      if (activeSocket.data.profileId !== profileId) continue;
      activeSocket.emit('profile:snapshot', profile);
      activeSocket.emit('profile:passport', passport);
    }
  }

  private refreshProfileInRooms(profile: PlayerProfile): void {
    for (const room of this.rooms.values()) {
      let changed = false;
      room.players.forEach((player, index) => {
        if (player?.profileId !== profile.id) return;
        room.players[index as 0 | 1] = { ...player, ...this.publicProgress(profile, room.settings.mode) };
        changed = true;
      });
      if (changed) this.broadcast(room);
    }
  }

  private publicProgress(profile: PlayerProfile, mode: RoomSettings['mode']): Pick<PlayerPublic, 'profileId' | 'name' | 'kind' | 'avatar' | 'level' | 'standing' | 'loadout'> {
    return { profileId: profile.id, name: profile.name, kind: 'human', avatar: profile.avatar, level: profile.level, standing: profile.standings[mode], loadout: profile.loadout };
  }

  private ownsRoomCosmetics(profile: PlayerProfile, settings: RoomSettings): boolean {
    const owned = new Set(profile.unlocks);
    return owned.has(settings.tableDesign) && owned.has(settings.clothDesign);
  }

  private createCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private makePlayer(profile: PlayerProfile, mode: RoomSettings['mode'], socket: GameSocket): InternalPlayer {
    return {
      id: randomUUID(), ...this.publicProgress(profile, mode), token: randomBytes(24).toString('base64url'), socketId: socket.id,
      connected: true, ready: false, disconnectedAt: null, disconnectTimer: null
    };
  }

  private makeCpuPlayer(settings: RoomSettings): InternalPlayer {
    const names = { rookie: 'Rookie CPU', club: 'Club CPU', expert: 'Expert CPU', master: 'Master CPU' } as const;
    return {
      id: randomUUID(), profileId: `cpu:${settings.cpuDifficulty}`, name: names[settings.cpuDifficulty], kind: 'cpu',
      avatar: defaultAvatar(`cpu-${settings.cpuDifficulty}`), level: { rookie: 3, club: 12, expert: 28, master: 45 }[settings.cpuDifficulty],
      standing: defaultStanding(settings.mode), loadout: { ...DEFAULT_COSMETIC_LOADOUT }, token: '', socketId: null,
      connected: true, ready: true, disconnectedAt: null, disconnectTimer: null
    };
  }

  private session(room: Room, player: InternalPlayer): PlayerSession {
    return { roomCode: room.code, playerId: player.id, token: player.token };
  }

  private directoryStatus(room: Room): RoomDirectoryStatus {
    if (room.players.some((player) => player && !player.connected)) return 'reconnecting';
    if (!room.game) return room.players.filter(Boolean).length >= 2 ? 'full' : 'waiting';
    return room.game.phase === 'rack-over' ? 'rack-over' : 'playing';
  }

  directory(): RoomDirectoryEntry[] {
    return [...this.rooms.values()]
      .filter((room) => room.game?.phase !== 'session-over' && room.players.some(Boolean))
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((room): RoomDirectoryEntry => {
        const host = room.players.find((player) => player?.id === room.hostPlayerId) ?? room.players.find(Boolean)!;
        const playerCount = room.players.filter(Boolean).length as 1 | 2;
        const status = this.directoryStatus(room);
        if (room.settings.visibility === 'private') {
          return { listingId: room.listingId, visibility: 'private', joinable: false, hostName: host!.name, mode: room.settings.mode, competition: room.settings.competition, ruleset: room.settings.ruleset, opponent: room.settings.opponent, status, playerCount, hostLevel: host!.level, hostTier: host!.standing.tier };
        }
        return {
          listingId: room.listingId,
          visibility: 'open',
          joinable: room.game === null && playerCount === 1 && status === 'waiting',
          hostName: host!.name,
          mode: room.settings.mode,
          competition: room.settings.competition,
          ruleset: room.settings.ruleset,
          opponent: room.settings.opponent,
          status,
          playerCount,
          hostLevel: host!.level,
          hostTier: host!.standing.tier,
          players: room.players.flatMap((player) => player ? [player.name] : []),
          scores: room.game ? [...room.game.scores] : null
        };
      });
  }

  list(): CommandResult<RoomDirectoryEntry[]> { return ok(this.directory()); }

  private broadcastDirectory(): void {
    this.io.emit('rooms:directory', this.directory());
    const onlineProfiles = new Set([...this.io.sockets.sockets.values()].flatMap((socket) => socket.connected && socket.data.profileId ? [socket.data.profileId] : []));
    for (const profileId of onlineProfiles) {
      const snapshot = this.friendsFor(profileId);
      for (const socket of this.io.sockets.sockets.values()) if (socket.data.profileId === profileId) socket.emit('friends:snapshot', snapshot);
    }
  }

  snapshot(room: Room): RoomSnapshot {
    const status = room.game === null ? 'lobby' : room.game.phase === 'session-over' ? 'finished' : 'playing';
    const publicPlayer = (player: InternalPlayer | null): PlayerPublic | null => player && ({
      id: player.id, profileId: player.profileId, name: player.name, kind: player.kind, avatar: player.avatar, connected: player.connected, ready: player.ready,
      level: player.level, standing: player.standing, loadout: player.loadout
    });
    return {
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      settings: cloneSettings(room.settings),
      status,
      players: [publicPlayer(room.players[0]), publicPlayer(room.players[1])],
      game: room.game,
      playbackUntil: room.playbackUntil,
      progress: room.progress
    };
  }

  private attach(socket: GameSocket, room: Room, player: InternalPlayer): void {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.disconnectedAt = null;
    player.connected = true;
    player.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.data.token = player.token;
    void socket.join(room.code);
    room.lastActivity = Date.now();
    if (room.players.every((entry) => entry?.connected) && room.game && room.pausedClockMs !== null) {
      room.game = { ...room.game, shotClockEndsAt: room.settings.shotClock > 0 ? Date.now() + room.pausedClockMs : null };
      room.pausedClockMs = null;
    }
    if (room.lastPlayback && (room.playbackUntil ?? 0) > Date.now()) socket.emit('shot:playback', room.lastPlayback);
    socket.emit('chat:snapshot', this.chatSnapshot(room));
  }

  private broadcast(room: Room): RoomSnapshot {
    const snapshot = this.snapshot(room);
    this.io.to(room.code).emit('room:snapshot', snapshot);
    this.broadcastDirectory();
    return snapshot;
  }

  private chatSnapshot(room: Room): ChatSnapshot {
    return { enabled: room.settings.chatEnabled, filterEnabled: room.settings.chatFilterEnabled, messages: [...room.chatMessages] };
  }

  updateChatSettings(socket: GameSocket, enabled: boolean, filterEnabled: boolean): CommandResult<ChatSnapshot> {
    const context = this.context(socket);
    if (!context) return fail('session-expired', 'Join a room first.');
    if (context.room.hostPlayerId !== context.player.id) return fail('not-host', 'Only the host can change chat settings.');
    context.room.settings = { ...context.room.settings, chatEnabled: Boolean(enabled), chatFilterEnabled: Boolean(filterEnabled) };
    context.room.lastActivity = Date.now();
    const snapshot = this.chatSnapshot(context.room);
    this.io.to(context.room.code).emit('chat:snapshot', snapshot);
    this.broadcast(context.room);
    return ok(snapshot);
  }

  sendChat(socket: GameSocket, clientMessageId: string, input: string): CommandResult<ChatMessage> {
    const context = this.context(socket);
    if (!context || context.player.kind !== 'human') return fail('session-expired', 'Join a room first.');
    if (!context.room.game) return fail('chat-disabled', 'Game chat opens when the match starts.');
    if (!context.room.settings.chatEnabled) return fail('chat-disabled', 'The host disabled game chat.');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientMessageId)) return fail('invalid-input', 'That message request is invalid.');
    const requestKey = `${context.player.profileId}:${clientMessageId}`;
    const duplicate = context.room.chatMessageIds.get(requestKey);
    if (duplicate) return ok(duplicate);
    const now = Date.now();
    const recent = (context.room.chatRate.get(context.player.profileId) ?? []).filter((time) => now - time < 8_000);
    if (recent.length >= 5) return fail('rate-limited', 'Slow down for a moment.');
    const normalized = normalizeChatText(input);
    if (!normalized.text) return fail('invalid-input', 'Write a message first.');
    const message: ChatMessage = {
      id: randomUUID(), clientMessageId, playerId: context.player.id, profileId: context.player.profileId,
      name: context.player.name,
      text: context.room.settings.chatFilterEnabled ? normalized.text : cleanChatInput(input),
      sentAt: now, filtered: context.room.settings.chatFilterEnabled && normalized.filtered
    };
    context.room.chatRate.set(context.player.profileId, [...recent, now]);
    context.room.chatMessages.push(message);
    if (context.room.chatMessages.length > 60) context.room.chatMessages.splice(0, context.room.chatMessages.length - 60);
    context.room.chatMessageIds.set(requestKey, message);
    if (context.room.chatMessageIds.size > 120) {
      const oldest = context.room.chatMessageIds.keys().next().value as string | undefined;
      if (oldest) context.room.chatMessageIds.delete(oldest);
    }
    context.room.lastActivity = now;
    this.io.to(context.room.code).emit('chat:message', message);
    return ok(message);
  }

  create(socket: GameSocket, settings: RoomSettings): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const profile = this.profileForSocket(socket);
    if (!profile) return fail('profile-required', 'Create or resume a player profile first.');
    if (!validSettings(settings)) return fail('invalid-input', 'Use valid room settings.');
    if (!this.ownsRoomCosmetics(profile, settings)) return fail('cosmetic-locked', 'Equip only table and cloth designs you have unlocked.');
    const code = this.createCode();
    const normalizedSettings = cloneSettings(settings);
    const player = this.makePlayer(profile, normalizedSettings.mode, socket);
    const room: Room = {
      code, listingId: randomUUID(), hostPlayerId: player.id, settings: normalizedSettings,
      players: [player, normalizedSettings.opponent === 'cpu' ? this.makeCpuPlayer(normalizedSettings) : null], game: null, playbackUntil: null, lastPlayback: null,
      lastActivity: Date.now(), pausedClockMs: null, progress: null, mastery: [{}, {}], shotCounts: [0, 0],
      startedAt: null, cpuActing: false, turnBeganAt: Date.now(), replayInitial: null, replayShots: [], replayHighlights: [],
      chatMessages: [], chatRate: new Map(), chatMessageIds: new Map()
    };
    this.rooms.set(code, room);
    this.attach(socket, room, player);
    this.broadcastDirectory();
    return ok({ session: this.session(room, player), room: this.snapshot(room) });
  }

  private joinRoom(socket: GameSocket, room: Room): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const profile = this.profileForSocket(socket);
    if (!profile) return fail('profile-required', 'Create or resume a player profile first.');
    if (room.game) return fail('room-full', 'That game has already started.');
    const slot = room.players.findIndex((player) => player === null);
    if (slot < 0) return fail('room-full', 'That room already has two players.');
    if (room.players.some((player) => player?.profileId === profile.id)) return fail('invalid-input', 'That profile already occupies this room.');
    const player = this.makePlayer(profile, room.settings.mode, socket);
    room.players[slot as 0 | 1] = player;
    this.attach(socket, room, player);
    return ok({ session: this.session(room, player), room: this.broadcast(room) });
  }

  join(socket: GameSocket, codeInput: string): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const room = this.rooms.get(codeInput.toUpperCase().trim());
    if (!room) return fail('room-not-found', 'That room does not exist or has expired.');
    return this.joinRoom(socket, room);
  }

  joinOpen(socket: GameSocket, listingId: string): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const room = [...this.rooms.values()].find((entry) => entry.listingId === listingId);
    if (!room) return fail('room-not-found', 'That room no longer exists.');
    if (room.settings.visibility !== 'open') return fail('room-not-open', 'That room is no longer open.');
    return this.joinRoom(socket, room);
  }

  resume(socket: GameSocket, codeInput: string, token: string): CommandResult<{ session: PlayerSession; room: RoomSnapshot }> {
    const room = this.rooms.get(codeInput.toUpperCase().trim());
    if (!room) return fail('room-not-found', 'That room has expired.');
    const player = room.players.find((entry) => entry?.token === token) ?? null;
    if (!player) return fail('session-expired', 'Your saved room seat has expired.');
    if (!socket.data.profileId || player.profileId !== socket.data.profileId) return fail('profile-required', 'Resume the player profile that owns this seat first.');
    this.attach(socket, room, player);
    const snapshot = this.broadcast(room);
    socket.emit('connection:notice', { message: 'Seat restored. You are back in the game.', tone: 'success' });
    return ok({ session: this.session(room, player), room: snapshot });
  }

  context(socket: GameSocket): SessionContext | null {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : null;
    if (!room || !socket.data.playerId) return null;
    const index = room.players.findIndex((player) => player?.id === socket.data.playerId);
    if (index < 0) return null;
    return { room, player: room.players[index as 0 | 1]!, index: index as 0 | 1 };
  }

  updateSettings(socket: GameSocket, settings: RoomSettings): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    if (!context) return fail('session-expired', 'Join a room first.');
    if (context.room.hostPlayerId !== context.player.id) return fail('not-host', 'Only the host can change room settings.');
    if (context.room.game) return fail('invalid-input', 'Settings are locked after the game starts.');
    if (!validSettings(settings)) return fail('invalid-input', 'Those room settings are not valid.');
    if (settings.opponent === 'cpu' && context.room.players.filter((player) => player?.kind === 'human').length > 1) return fail('invalid-input', 'The human guest must leave before switching to CPU play.');
    const profile = this.profileForSocket(socket);
    if (!profile || !this.ownsRoomCosmetics(profile, settings)) return fail('cosmetic-locked', 'Equip only table and cloth designs you have unlocked.');
    const resetReady = gameplaySettingsChanged(context.room.settings, settings);
    context.room.settings = cloneSettings(settings);
    const cpuIndex = context.room.players.findIndex((player) => player?.kind === 'cpu');
    if (context.room.settings.opponent === 'cpu') {
      if (cpuIndex < 0) {
        const slot = context.room.players.findIndex((player) => player === null);
        if (slot >= 0) context.room.players[slot as 0 | 1] = this.makeCpuPlayer(context.room.settings);
      } else context.room.players[cpuIndex as 0 | 1] = this.makeCpuPlayer(context.room.settings);
    } else if (cpuIndex >= 0) context.room.players[cpuIndex as 0 | 1] = null;
    context.room.players.forEach((player, index) => {
      if (!player || player.kind === 'cpu') return;
      const profile = this.progression.getProfile(player.profileId);
      context.room.players[index as 0 | 1] = { ...player, ...this.publicProgress(profile, context.room.settings.mode) };
    });
    if (resetReady) context.room.players.forEach((player) => { if (player?.kind === 'human') player.ready = false; });
    context.room.lastActivity = Date.now();
    return ok(this.broadcast(context.room));
  }

  setReady(socket: GameSocket, ready: boolean): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    if (!context) return fail('session-expired', 'Join a room first.');
    if (context.room.game) return fail('invalid-input', 'The game has already started.');
    context.player.ready = Boolean(ready);
    context.room.lastActivity = Date.now();
    return ok(this.broadcast(context.room));
  }

  start(socket: GameSocket): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    if (!context) return fail('session-expired', 'Join a room first.');
    const { room, player } = context;
    if (room.hostPlayerId !== player.id) return fail('not-host', 'Only the host can start the game.');
    if (room.players.some((entry) => !entry?.connected || !entry.ready)) return fail('not-ready', 'Both players must be connected and ready.');
    room.game = createGame(room.settings, randomInt(2) as 0 | 1);
    room.replayInitial = structuredClone(room.game);
    room.replayShots = [];
    room.replayHighlights = [];
    room.progress = { rackId: randomUUID(), performanceScores: [0, 0], shotStreaks: [0, 0], settled: false };
    room.mastery = [{}, {}];
    room.shotCounts = [0, 0];
    room.startedAt = Date.now();
    room.turnBeganAt = room.startedAt;
    room.game.shotClockEndsAt = room.settings.shotClock > 0 ? Date.now() + room.settings.shotClock * 1000 : null;
    room.lastActivity = Date.now();
    return ok(this.broadcast(room));
  }

  placeCue(socket: GameSocket, point: Vec2): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    const game = context?.room.game;
    if (!context || !game) return fail('session-expired', 'There is no active game.');
    const { room, index } = context;
    if (game.turnIndex !== index) return fail('not-your-turn', 'Wait for your turn.');
    if (!game.ballInHand) return fail('invalid-placement', 'The cue ball is not in hand.');
    if ((room.playbackUntil ?? 0) > Date.now()) return fail('shot-in-progress', 'Wait for the balls to stop.');
    if (!isValidPlacement(game, point)) return fail('invalid-placement', 'Place the cue ball on open cloth without touching another ball.');
    room.game = placeBall(game, point);
    room.lastActivity = Date.now();
    return ok(this.broadcast(room));
  }

  private settleCompletedRack(room: Room, forcedWinner: 0 | 1 | null = null): RackSettlement | null {
    const game = room.game;
    const progress = room.progress;
    const players = room.players;
    const winnerIndex = forcedWinner ?? game?.winnerIndex ?? null;
    if (!game || !progress || progress.settled || winnerIndex === null || (forcedWinner === null && game.phase !== 'rack-over') || !players[0] || !players[1]) return null;
    const endedAt = Date.now();
    const cpuIndex = players.findIndex((player) => player?.kind === 'cpu');
    const humanIndex = (cpuIndex === 0 ? 1 : 0) as 0 | 1;
    const settlement = cpuIndex >= 0 ? this.progression.settleCpuRack({
      rackId: progress.rackId, mode: room.settings.mode, profileId: players[humanIndex]!.profileId,
      humanIndex, winnerIndex, performanceScores: progress.performanceScores, mastery: room.mastery[humanIndex], endedAt
    }) : this.progression.settleRack({
      rackId: progress.rackId, competition: room.settings.competition, mode: room.settings.mode,
      profileIds: [players[0].profileId, players[1].profileId], winnerIndex,
      performanceScores: progress.performanceScores, mastery: room.mastery, endedAt
    });
    players.forEach((player, index) => {
      if (player?.kind !== 'human') return;
      this.progression.recordRackStats(player.profileId, room.settings.mode, cpuIndex >= 0, winnerIndex === index, endedAt - (room.startedAt ?? endedAt));
      const won = winnerIndex === index;
      const breakAndRun = won && game.breakerIndex === index && room.shotCounts[index === 0 ? 1 : 0] === 0;
      const eightFoulLoss = !won && room.settings.mode === 'eight-ball'
        && Boolean(room.lastPlayback?.trace.pocketed.includes(8))
        && room.lastPlayback?.scoreEvent?.shooterIndex === index;
      this.progression.recordShot(player.profileId, room.settings.mode, cpuIndex >= 0, {
        winsAsBreaker: won && game.breakerIndex === index ? 1 : 0,
        breakAndRuns: breakAndRun ? 1 : 0, runouts: breakAndRun ? 1 : 0,
        eightBallFoulLosses: eightFoulLoss ? 1 : 0
      });
    });
    room.progress = { ...progress, settled: true };
    players.forEach((player, index) => {
      if (!player) return;
      if (player.kind === 'cpu') return;
      const profile = this.progression.getProfile(player.profileId);
      room.players[index as 0 | 1] = { ...player, ...this.publicProgress(profile, room.settings.mode) };
      this.emitProfile(player.profileId);
    });
    this.io.to(room.code).emit('rack:settlement', settlement);
    if (cpuIndex < 0 && room.replayInitial) {
      const replayBase = {
        id: progress.rackId, version: 1 as const, mode: room.settings.mode, ruleset: room.settings.ruleset,
        endedAt, qualityScore: Math.max(0, Math.round(progress.performanceScores[0] + progress.performanceScores[1]
          + room.replayHighlights.length * 90 + Math.max(0, 650 - room.replayShots.length * 18)
          + (room.settings.competition === 'ranked' ? 180 : 0)
          + (players[0].standing.rating + players[1].standing.rating) * 0.06)),
        participants: players.map((entry) => ({
          profileId: entry!.profileId, name: entry!.name, avatar: entry!.avatar, standing: entry!.standing, loadout: entry!.loadout
        })) as ReplayDocument['participants'],
        winnerIndex, shotCount: room.replayShots.length, highlights: [...new Set(room.replayHighlights)].slice(0, 12),
        settings: cloneSettings(room.settings), initialSnapshot: room.replayInitial, shots: room.replayShots
      };
      const checksum = createHash('sha256').update(JSON.stringify(replayBase)).digest('hex');
      this.progression.saveReplay({ ...replayBase, checksum });
    }
    return settlement;
  }

  takeShot(socket: GameSocket, shot: ShotInput): CommandResult<{ shotId: string }> {
    const context = this.context(socket);
    const game = context?.room.game;
    if (!context || !game) return fail('session-expired', 'There is no active game.');
    const { room, index } = context;
    if ((room.playbackUntil ?? 0) > Date.now()) return fail('shot-in-progress', 'Wait for the balls to stop.');
    if (game.phase !== 'aiming') return fail('invalid-input', 'This rack is over.');
    if (game.turnIndex !== index) return fail('not-your-turn', 'Wait for your turn.');
    if (game.ballInHand) return fail('invalid-placement', 'Place the cue ball before shooting.');
    if (shot.revision !== game.revision) return fail('stale-state', 'The table changed. Aim again before shooting.');
    if (!Number.isFinite(shot.angle) || !Number.isFinite(shot.power) || shot.power < 0.04 || shot.power > 1
      || !Number.isFinite(shot.elevation) || shot.elevation < 0 || shot.elevation > 75
      || (!room.settings.allowElevatedShots && shot.elevation > 0.001)
      || !Number.isFinite(shot.english.side) || !Number.isFinite(shot.english.vertical)
      || Math.hypot(shot.english.side, shot.english.vertical) > 1.001) {
      return fail('invalid-input', 'Shot angle, power, elevation, or English is invalid.');
    }
    if (!calledShotIsValid(game, shot.calledShot)) return fail('invalid-call', 'Select the legal ball and intended pocket before shooting.');
    return ok({ shotId: this.executeShot(room, index, shot).id });
  }

  private executeShot(room: Room, index: 0 | 1, shot: ShotInput): ShotPlayback {
    const game = room.game!;
    const initialBalls = game.balls.map((ball) => ({ ...ball, orientation: { ...ball.orientation } }));
    const simulation = simulateShot(initialBalls, shot, { clothSpeed: room.settings.clothSpeed });
    const finalSnapshot = resolveShot(game, simulation, shot);
    room.progress ??= { rackId: randomUUID(), performanceScores: [0, 0], shotStreaks: [0, 0], settled: false };
    const performance = analyzeShotPerformance({
      before: game,
      after: finalSnapshot,
      simulation,
      shot,
      shooterIndex: index,
      streakBefore: room.progress.shotStreaks[index],
      opponentShotCount: room.shotCounts[index === 0 ? 1 : 0]
    });
    const performanceScores: [number, number] = [...room.progress.performanceScores];
    performanceScores[index] = Math.max(0, performanceScores[index] + performance.delta);
    const shotStreaks: [number, number] = [0, 0];
    if (performance.nextStreak > 0) shotStreaks[index] = performance.nextStreak;
    room.progress = { ...room.progress, performanceScores, shotStreaks };
    room.shotCounts[index] += 1;
    for (const [track, amount] of Object.entries(performance.mastery) as Array<[MasteryTrack, number]>) {
      room.mastery[index][track] = (room.mastery[index][track] ?? 0) + amount;
    }
    const startedAt = Date.now() + 90;
    const durationMs = Math.ceil(simulation.trace.duration * 1000);
    room.playbackUntil = startedAt + durationMs;
    finalSnapshot.shotClockEndsAt = finalSnapshot.phase === 'aiming' && room.settings.shotClock > 0
      ? room.playbackUntil + room.settings.shotClock * 1000 : null;
    const playback: ShotPlayback = {
      id: randomUUID(), startedAt, durationMs, initialBalls, frames: simulation.frames,
      shot, trace: simulation.trace, finalSnapshot,
      scoreEvent: {
        id: randomUUID(), shooterIndex: index, shotNumber: game.shotNumber,
        components: performance.components, delta: performance.delta,
        totals: performanceScores, streak: performance.nextStreak, technique: performance.technique
      }
    };
    room.replayShots.push({
      shooterIndex: index,
      aimTimeMs: Math.max(0, Date.now() - room.turnBeganAt),
      playback: { ...playback, frames: playback.frames.filter((_frame, frameIndex) => frameIndex % 3 === 0 || frameIndex === playback.frames.length - 1) }
    });
    room.replayHighlights.push(...performance.components.filter((component) => component.points >= 90).map((component) => component.label));
    room.game = finalSnapshot;
    room.lastPlayback = playback;
    room.lastActivity = Date.now();
    this.io.to(room.code).emit('shot:playback', playback);
    const ruleCodes = new Set(finalSnapshot.lastEvents.map((event) => event.code));
    const components = new Set(performance.components.map((component) => component.code));
    const player = room.players[index];
    if (player?.kind === 'human') {
      const objectPockets = simulation.trace.pocketed.filter((id) => id > 0).length;
      const ballBallContacts = simulation.trace.contacts.filter((contact) => contact.kind === 'ball-ball');
      this.progression.recordShot(player.profileId, room.settings.mode, room.settings.opponent === 'cpu', {
        strokes: 1, ballsPocketed: objectPockets, legalPockets: components.has('legal-pocket') ? objectPockets : 0,
        fouls: components.has('foul') ? 1 : 0, scratches: simulation.trace.cueScratch ? 1 : 0,
        breakScratches: game.breakShot && simulation.trace.cueScratch ? 1 : 0,
        illegalBreaks: ruleCodes.has('illegal-break') ? 1 : 0, wrongFirstBalls: ruleCodes.has('wrong-first-ball') ? 1 : 0,
        offTableBalls: simulation.trace.offTable.length, breaksTaken: game.breakShot ? 1 : 0,
        ballsOnBreak: game.breakShot ? objectPockets : 0, calledShots: shot.calledShot ? 1 : 0,
        calledMakes: ruleCodes.has('call-made') ? 1 : 0, wrongPockets: ruleCodes.has('call-missed') ? 1 : 0,
        slopPockets: !shot.calledShot && objectPockets > 0 && !components.has('legal-pocket') ? objectPockets : 0,
        jumps: shot.elevation >= 24 ? 1 : 0, jumpMakes: shot.elevation >= 24 && objectPockets > 0 ? 1 : 0,
        masses: shot.elevation >= 35 && Math.abs(shot.english.side) >= 0.35 ? 1 : 0,
        masseMakes: shot.elevation >= 35 && Math.abs(shot.english.side) >= 0.35 && objectPockets > 0 ? 1 : 0,
        swerves: components.has('curve') ? 1 : 0, banks: components.has('bank') ? 1 : 0,
        kicks: components.has('kick') ? 1 : 0, combinations: ballBallContacts.some((contact) => contact.ballIds.every((id) => id > 0)) ? 1 : 0,
        multiRailShots: simulation.trace.railContacts.length >= 2 ? 1 : 0, safeties: components.has('safety') ? 1 : 0,
        powerSum: shot.power, aimTimeMs: Math.max(0, Date.now() - room.turnBeganAt),
        englishShots: Math.hypot(shot.english.side, shot.english.vertical) > 0.05 ? 1 : 0,
        followShots: shot.english.vertical > 0.2 ? 1 : 0, drawShots: shot.english.vertical < -0.2 ? 1 : 0,
        leftEnglishShots: shot.english.side < -0.2 ? 1 : 0, rightEnglishShots: shot.english.side > 0.2 ? 1 : 0,
        nineOnBreak: game.mode === 'nine-ball' && game.breakShot && simulation.trace.pocketed.includes(9) ? 1 : 0,
        eightOnBreak: game.mode === 'eight-ball' && game.breakShot && simulation.trace.pocketed.includes(8) ? 1 : 0
      });
      this.emitProfile(player.profileId);
    }
    this.settleCompletedRack(room);
    for (const ruleEvent of finalSnapshot.lastEvents) this.io.to(room.code).emit('rules:event', ruleEvent);
    this.broadcast(room);
    room.turnBeganAt = room.playbackUntil;
    return playback;
  }

  nextRack(socket: GameSocket): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    const game = context?.room.game;
    if (!context || !game) return fail('session-expired', 'There is no active game.');
    const { room } = context;
    if ((room.playbackUntil ?? 0) > Date.now()) return fail('shot-in-progress', 'Wait for the rack result.');
    if (game.phase !== 'rack-over') return fail('invalid-input', 'The current rack is not over.');
    room.game = createNextRack(game);
    room.progress = { rackId: randomUUID(), performanceScores: [0, 0], shotStreaks: [0, 0], settled: false };
    room.mastery = [{}, {}];
    room.shotCounts = [0, 0];
    room.startedAt = Date.now();
    room.turnBeganAt = room.startedAt;
    room.game.shotClockEndsAt = room.settings.shotClock > 0 ? Date.now() + room.settings.shotClock * 1000 : null;
    room.lastPlayback = null;
    room.playbackUntil = null;
    room.lastActivity = Date.now();
    room.replayInitial = structuredClone(room.game);
    room.replayShots = [];
    room.replayHighlights = [];
    return ok(this.broadcast(room));
  }

  returnPushOut(socket: GameSocket): CommandResult<RoomSnapshot> {
    const context = this.context(socket);
    const game = context?.room.game;
    if (!context || !game) return fail('session-expired', 'There is no active game.');
    if (game.turnIndex !== context.index) return fail('not-your-turn', 'Only the incoming player may return a push-out.');
    if (game.pushOutReturnTo === null) return fail('invalid-input', 'There is no push-out decision to return.');
    context.room.game = returnPushOut(game);
    context.room.turnBeganAt = Date.now();
    return ok(this.broadcast(context.room));
  }

  leave(socket: GameSocket): CommandResult<undefined> {
    const context = this.context(socket);
    if (!context) return ok(undefined);
    const { room, index } = context;
    if (room.game && room.game.phase !== 'session-over') {
      room.game = applyForfeit(room.game, index);
      if (room.shotCounts[0] + room.shotCounts[1] > 0 && room.progress) {
        const winner = index === 0 ? 1 : 0;
        const scores: [number, number] = [...room.progress.performanceScores]; scores[winner] += 200;
        room.progress = { ...room.progress, performanceScores: scores };
        this.settleCompletedRack(room, winner);
      }
    }
    else {
      room.players[index] = null;
      this.promoteHost(room);
    }
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    void socket.leave(room.code);
    if (room.settings.opponent === 'cpu' || room.players.every((entry) => entry === null)) this.rooms.delete(room.code);
    else this.broadcast(room);
    this.broadcastDirectory();
    return ok(undefined);
  }

  disconnect(socket: GameSocket): void {
    const context = this.context(socket);
    if (!context) { this.broadcastDirectory(); return; }
    const { room, player, index } = context;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    if (room.game?.shotClockEndsAt) {
      room.pausedClockMs = Math.max(0, room.game.shotClockEndsAt - Date.now());
      room.game = { ...room.game, shotClockEndsAt: null };
    }
    player.disconnectTimer = setTimeout(() => this.expireSeat(room.code, player.id, index), RECONNECT_GRACE_MS);
    player.disconnectTimer.unref();
    this.broadcast(room);
  }

  private expireSeat(code: string, playerId: string, index: 0 | 1): void {
    const room = this.rooms.get(code);
    const player = room?.players[index];
    if (!room || !player || player.id !== playerId || player.connected) return;
    if (room.game && room.game.phase !== 'session-over') {
      room.game = applyForfeit(room.game, index);
      room.pausedClockMs = null;
      if (room.shotCounts[0] + room.shotCounts[1] > 0 && room.progress) {
        const winner = index === 0 ? 1 : 0;
        const scores: [number, number] = [...room.progress.performanceScores]; scores[winner] += 200;
        room.progress = { ...room.progress, performanceScores: scores };
        this.settleCompletedRack(room, winner);
      }
    } else {
      room.players[index] = null;
      this.promoteHost(room);
    }
    if (room.settings.opponent === 'cpu' || room.players.every((entry) => !entry?.connected)) this.rooms.delete(code);
    else this.broadcast(room);
    this.broadcastDirectory();
  }

  private promoteHost(room: Room): void {
    const first = room.players.find((entry) => entry !== null);
    if (first) room.hostPlayerId = first.id;
  }

  private maintain(): void {
    const now = Date.now();
    for (const [attemptId, attempt] of this.practiceAttempts) if (attempt.expiresAt < now) this.practiceAttempts.delete(attemptId);
    for (const [inviteId, invite] of this.invites) if (invite.expiresAt < now) this.invites.delete(inviteId);
    let directoryChanged = false;
    for (const room of [...this.rooms.values()]) {
      if (room.playbackUntil !== null && room.playbackUntil <= now) {
        room.playbackUntil = null;
        room.turnBeganAt = now;
      }
      this.playCpuTurn(room);
      if (room.game?.phase === 'aiming' && room.game.shotClockEndsAt !== null && room.game.shotClockEndsAt <= now
        && room.players.every((player) => player?.connected)) {
        const timedOut = room.game.turnIndex;
        room.game = applyShotClockFoul(room.game);
        room.shotCounts[timedOut] += 1;
        const timedOutPlayer = room.players[timedOut];
        if (timedOutPlayer?.kind === 'human') this.progression.recordShot(timedOutPlayer.profileId, room.settings.mode, room.settings.opponent === 'cpu', { strokes: 1, fouls: 1, shotClockFouls: 1 });
        if (room.progress) {
          const scores: [number, number] = [...room.progress.performanceScores];
          scores[timedOut] = Math.max(0, scores[timedOut] - 100);
          room.progress = { ...room.progress, performanceScores: scores, shotStreaks: [0, 0] };
        }
        room.game.shotClockEndsAt = room.game.phase === 'aiming' && room.settings.shotClock > 0 ? now + room.settings.shotClock * 1000 : null;
        this.settleCompletedRack(room);
        for (const ruleEvent of room.game.lastEvents) this.io.to(room.code).emit('rules:event', ruleEvent);
        this.broadcast(room);
      }
      const anyConnected = room.players.some((player) => player?.connected);
      if (!anyConnected && now - room.lastActivity > ROOM_IDLE_MS) {
        this.rooms.delete(room.code);
        directoryChanged = true;
      }
    }
    if (directoryChanged) this.broadcastDirectory();
  }

  replayList(socket: GameSocket, mode: RoomSettings['mode'], period: LeaderboardPeriod): CommandResult<ReplayPage> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    if (!['eight-ball', 'nine-ball'].includes(mode) || !['all-time', 'thirty-days'].includes(period)) return fail('invalid-input', 'That replay board does not exist.');
    return ok(this.progression.replays(mode, period));
  }

  replayGet(socket: GameSocket, replayId: string): CommandResult<ReplayDocument> {
    if (!socket.data.profileId) return fail('profile-required', 'Create or resume a player profile first.');
    try { return ok(this.progression.replay(replayId)); }
    catch (error) { if (error instanceof ProfileNotFoundError) return fail('replay-not-found', error.message); throw error; }
  }

  private playCpuTurn(room: Room): void {
    const game = room.game;
    if (!game || game.phase !== 'aiming' || room.playbackUntil !== null || room.cpuActing) return;
    const player = room.players[game.turnIndex];
    if (player?.kind !== 'cpu') return;
    room.cpuActing = true;
    try {
      let current = game;
      if (current.pushOutReturnTo !== null) {
        const returnChance = { rookie: 0.2, club: 0.35, expert: 0.48, master: 0.58 }[room.settings.cpuDifficulty];
        const pseudoRandom = ((current.revision * 9301 + current.shotNumber * 49297) % 233280) / 233280;
        if (pseudoRandom < returnChance) {
          current = returnPushOut(current);
          room.game = current;
        }
      }
      if (current.ballInHand) {
        const point = chooseCpuPlacement(current, current.revision * 17 + current.shotNumber * 31);
        current = placeBall(current, point);
        room.game = current;
      }
      const shot = chooseCpuShot(current, room.settings.cpuDifficulty, { clothSpeed: room.settings.clothSpeed }, current.revision * 65_537 + current.shotNumber);
      this.executeShot(room, current.turnIndex, shot);
    } finally { room.cpuActing = false; }
  }
}
