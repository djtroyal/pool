import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  COSMETIC_CATALOG,
  DEFAULT_COSMETIC_LOADOUT,
  AVATAR_FEATURES,
  avatarOwned,
  avatarPartUnlockId,
  defaultAvatar,
  defaultStanding,
  emptyPlayerStats,
  glicko2Update,
  inappropriateUsername,
  inferPlaystyle,
  levelForXp,
  masteryRank,
  normalizeUsername,
  normalizeAvatar,
  rackXp,
  repeatOpponentMultiplier,
  tierForRating,
  validAvatar,
  type Competition,
  type AvatarInput,
  type CareerStats,
  type ChallengeMedal,
  type CosmeticLoadout,
  type GameMode,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LeaderboardPeriod,
  type MasteryTrack,
  type ModeStanding,
  type PlayerStats,
  type PlayerProfile,
  type PublicProfile,
  type FriendRequest,
  type PracticeChallengeId,
  type ProfileSession,
  type RackSettlement,
  type ReplayDocument,
  type ReplayPage,
  type ReplaySummary,
  type StorePurchaseResult,
  type UnlockEvent
} from '@breakroom/game-core';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

interface ProfileRow {
  id: string;
  token_hash: string;
  name: string;
  total_xp: number;
  xp_spent: number;
  level: number;
  loadout_json: string;
  avatar_json: string;
  stats_json: string;
  created_at: number;
}

interface RatingRow {
  mode: GameMode;
  rating: number;
  rated_racks: number;
  wins: number;
  losses: number;
  rating_deviation: number;
  volatility: number;
  last_rated_at: number | null;
}

interface LeaderboardRow {
  profile_id: string;
  name: string;
  level: number;
  value: number;
  rating: number | null;
  rated_racks: number;
  wins: number;
  losses: number;
  frame: string;
  avatar_json: string;
  rating_deviation: number | null;
}

export interface RackSettlementInput {
  rackId: string;
  competition: Competition;
  mode: GameMode;
  profileIds: [string, string];
  winnerIndex: 0 | 1;
  performanceScores: [number, number];
  mastery: [Partial<Record<MasteryTrack, number>>, Partial<Record<MasteryTrack, number>>];
  endedAt: number;
}

export interface ChallengeAward {
  xp: number;
  newBest: boolean;
  unlocks: UnlockEvent[];
  profile: PlayerProfile;
}

export interface FriendRecords { friendIds: string[]; requests: FriendRequest[]; blockedProfileIds: string[] }

export class ProfileNameTakenError extends Error {}
export class ProfileNotFoundError extends Error {}
export class CosmeticLockedError extends Error {}
export class ProfileNameBlockedError extends Error {}
export class FriendError extends Error {}
export class InsufficientXpError extends Error {}
export class AlreadyOwnedError extends Error {}
export class PassportInvalidError extends Error {}

const TRACKS: MasteryTrack[] = ['break', 'precision', 'rails', 'control', 'technique', 'runout'];
const BASE_UNLOCKS = COSMETIC_CATALOG.filter((item) => item.level === 1).map((item) => item.id);

function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function nameKey(name: string): string { return name.normalize('NFKC').toLocaleLowerCase('en-US'); }
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function statsFromJson(value: string | null | undefined, trackingSince: number): PlayerStats {
  const fallback = emptyPlayerStats(trackingSince);
  const parsed = parseJson<Partial<PlayerStats>>(value, {});
  return {
    ...fallback, ...parsed,
    total: { ...fallback.total, ...(parsed.total ?? {}) },
    byMode: {
      'eight-ball': { ...fallback.byMode['eight-ball'], ...(parsed.byMode?.['eight-ball'] ?? {}) },
      'nine-ball': { ...fallback.byMode['nine-ball'], ...(parsed.byMode?.['nine-ball'] ?? {}) }
    },
    humanGames: { ...fallback.humanGames, ...(parsed.humanGames ?? {}) },
    cpuGames: { ...fallback.cpuGames, ...(parsed.cpuGames ?? {}) },
    styleSamples: Array.isArray(parsed.styleSamples) ? parsed.styleSamples.slice(-60) : []
  };
}

export function defaultDatabasePath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(process.env.DATABASE_PATH);
  const directory = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'breakroom.sqlite');
}

interface PassportPayload {
  version: 1;
  profileId: string;
  sequence: number;
  authEpoch: number;
  issuedAt: number;
  profile: PlayerProfile;
}

interface PassportHeadRow {
  profile_id: string;
  sequence: number;
  auth_epoch: number;
  encrypted_backup: string;
}

function passportMasterKey(filename: string): Buffer {
  const configuredPath = process.env.PASSPORT_MASTER_KEY_FILE;
  const configured = configuredPath ? readFileSync(configuredPath, 'utf8').trim() : process.env.PASSPORT_MASTER_KEY;
  if (configuredPath && !configured) throw new TypeError('PASSPORT_MASTER_KEY_FILE must not be empty.');
  if (configured) return createHash('sha256').update(configured).digest();
  if (filename === ':memory:') return randomBytes(32);
  const keyPath = `${filename}.passport-key`;
  if (existsSync(keyPath)) return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64url');
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('base64url'), { mode: 0o600 });
  return key;
}

export class ProgressionStore {
  readonly db: DatabaseSyncType;
  private readonly passportKey: Buffer;

  constructor(filename = defaultDatabasePath()) {
    this.passportKey = passportMasterKey(filename);
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void { this.db.close(); }

  healthy(): boolean {
    try { return this.db.prepare('SELECT 1 AS ok').get() !== undefined; }
    catch { return false; }
  }

  checkpoint(): void { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        total_xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        loadout_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ratings (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('eight-ball','nine-ball')),
        rating INTEGER NOT NULL DEFAULT 1000,
        rated_racks INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(profile_id, mode)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profile_unlocks (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        cosmetic_id TEXT NOT NULL,
        source TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, cosmetic_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS mastery_progress (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        track TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(profile_id, track)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS challenge_progress (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL,
        medal INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(profile_id, challenge_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rack_results (
        id TEXT PRIMARY KEY,
        competition TEXT NOT NULL CHECK(competition IN ('casual','ranked')),
        mode TEXT NOT NULL CHECK(mode IN ('eight-ball','nine-ball')),
        ended_at INTEGER NOT NULL,
        profile_0 TEXT NOT NULL REFERENCES profiles(id),
        profile_1 TEXT NOT NULL REFERENCES profiles(id),
        winner_index INTEGER NOT NULL,
        performance_0 INTEGER NOT NULL,
        performance_1 INTEGER NOT NULL,
        xp_0 INTEGER NOT NULL,
        xp_1 INTEGER NOT NULL,
        rating_delta_0 INTEGER NOT NULL,
        rating_delta_1 INTEGER NOT NULL,
        settlement_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS rack_results_profiles_ended ON rack_results(profile_0, profile_1, ended_at);
      CREATE INDEX IF NOT EXISTS rack_results_mode_ended ON rack_results(mode, ended_at);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch() * 1000);
    `);
    this.ensureColumn('profiles', 'avatar_json', `TEXT NOT NULL DEFAULT '{}'`);
    this.ensureColumn('profiles', 'stats_json', `TEXT NOT NULL DEFAULT '{}'`);
    this.ensureColumn('profiles', 'recovery_hash', 'TEXT');
    this.ensureColumn('profiles', 'xp_spent', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('ratings', 'rating_deviation', 'REAL NOT NULL DEFAULT 350');
    this.ensureColumn('ratings', 'volatility', 'REAL NOT NULL DEFAULT 0.06');
    this.ensureColumn('ratings', 'last_rated_at', 'INTEGER');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_sessions (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS friend_requests (
        sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        receiver_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(sender_id, receiver_id),
        CHECK(sender_id <> receiver_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS friendships (
        profile_0 TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        profile_1 TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(profile_0, profile_1),
        CHECK(profile_0 < profile_1)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profile_blocks (
        blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(blocker_id, blocked_id),
        CHECK(blocker_id <> blocked_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS game_replays (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('eight-ball','nine-ball')),
        ended_at INTEGER NOT NULL,
        quality_score INTEGER NOT NULL,
        participant_0 TEXT NOT NULL REFERENCES profiles(id),
        participant_1 TEXT NOT NULL REFERENCES profiles(id),
        document_json TEXT NOT NULL,
        checksum TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS game_replays_mode_score ON game_replays(mode, quality_score DESC, ended_at DESC);
      CREATE TABLE IF NOT EXISTS passport_heads (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        auth_epoch INTEGER NOT NULL DEFAULT 1,
        passport_hash TEXT NOT NULL,
        encrypted_backup TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS store_purchases (
        idempotency_key TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        cosmetic_id TEXT NOT NULL,
        price_xp INTEGER NOT NULL,
        purchased_at INTEGER NOT NULL,
        UNIQUE(profile_id, cosmetic_id)
      ) STRICT;
    `);
    const passportMigration = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = 2').get();
    if (!passportMigration) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare(`INSERT OR IGNORE INTO profile_sessions(profile_id, token_hash, created_at, last_seen_at)
          SELECT id, token_hash, created_at, updated_at FROM profiles`).run();
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)').run(Date.now());
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    const storeMigration = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get();
    if (!storeMigration) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare("DELETE FROM profile_unlocks WHERE source LIKE 'Level %'").run();
        this.db.prepare('UPDATE profiles SET xp_spent = 0').run();
        const rows = this.db.prepare('SELECT id, name, loadout_json, avatar_json FROM profiles').all() as unknown as Array<Pick<ProfileRow, 'id' | 'name' | 'loadout_json' | 'avatar_json'>>;
        for (const row of rows) {
          const unlockRows = this.db.prepare('SELECT cosmetic_id FROM profile_unlocks WHERE profile_id = ?').all(row.id) as unknown as Array<{ cosmetic_id: string }>;
          const owned = new Set([...BASE_UNLOCKS, ...unlockRows.map((entry) => entry.cosmetic_id)]);
          const storedLoadout = { ...DEFAULT_COSMETIC_LOADOUT, ...parseJson<Partial<CosmeticLoadout>>(row.loadout_json, {}) };
          const repairedLoadout = Object.fromEntries((Object.keys(DEFAULT_COSMETIC_LOADOUT) as Array<keyof CosmeticLoadout>)
            .map((key) => [key, owned.has(storedLoadout[key]) ? storedLoadout[key] : DEFAULT_COSMETIC_LOADOUT[key]])) as unknown as CosmeticLoadout;
          const avatar = normalizeAvatar(parseJson<unknown>(row.avatar_json, null), row.name);
          const fallback = defaultAvatar(row.name);
          for (const feature of AVATAR_FEATURES) {
            const unlockId = avatarPartUnlockId(feature, avatar[feature]);
            if (!unlockId || owned.has(unlockId)) continue;
            avatar[feature] = fallback[feature];
            delete avatar.transforms[feature];
          }
          this.db.prepare('UPDATE profiles SET loadout_json = ?, avatar_json = ? WHERE id = ?')
            .run(JSON.stringify(repairedLoadout), JSON.stringify(avatar), row.id);
        }
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)').run(Date.now());
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!rows.some((entry) => entry.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private derivedKey(label: string): Buffer {
    return createHmac('sha256', this.passportKey).update(label).digest();
  }

  private encodePassport(payload: PassportPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `p1.${body}`;
    const signature = createHmac('sha256', this.derivedKey('passport-signing-v1')).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  private decodePassport(passport: string): PassportPayload {
    const [prefix, body, signature, extra] = passport.split('.');
    if (prefix !== 'p1' || !body || !signature || extra) throw new PassportInvalidError('That player passport is invalid.');
    const expected = createHmac('sha256', this.derivedKey('passport-signing-v1')).update(`${prefix}.${body}`).digest();
    let received: Buffer;
    try { received = Buffer.from(signature, 'base64url'); } catch { throw new PassportInvalidError('That player passport is invalid.'); }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new PassportInvalidError('That player passport was modified.');
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PassportPayload;
      if (parsed.version !== 1 || typeof parsed.profileId !== 'string' || !Number.isSafeInteger(parsed.sequence)
        || !Number.isSafeInteger(parsed.authEpoch) || parsed.profile?.id !== parsed.profileId) throw new Error('invalid');
      return parsed;
    } catch { throw new PassportInvalidError('That player passport is invalid.'); }
  }

  private encryptPassport(passport: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derivedKey('passport-backup-v1'), iv);
    const ciphertext = Buffer.concat([cipher.update(passport, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  private decryptPassport(value: string): string {
    try {
      const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part!, 'base64url'));
      if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16) throw new Error('invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.derivedKey('passport-backup-v1'), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { throw new PassportInvalidError('The encrypted player passport could not be opened.'); }
  }

  private issuePassport(profileId: string, rotateEpoch = false): string {
    const head = this.db.prepare('SELECT * FROM passport_heads WHERE profile_id = ?').get(profileId) as PassportHeadRow | undefined;
    const sequence = (head?.sequence ?? 0) + 1;
    const authEpoch = (head?.auth_epoch ?? 1) + (rotateEpoch ? 1 : 0);
    const passport = this.encodePassport({
      version: 1, profileId, sequence, authEpoch, issuedAt: Date.now(), profile: this.getProfile(profileId)
    });
    this.db.prepare(`INSERT INTO passport_heads(profile_id, sequence, auth_epoch, passport_hash, encrypted_backup, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET sequence = excluded.sequence,
      auth_epoch = excluded.auth_epoch, passport_hash = excluded.passport_hash,
      encrypted_backup = excluded.encrypted_backup, updated_at = excluded.updated_at`)
      .run(profileId, sequence, authEpoch, tokenHash(passport), this.encryptPassport(passport), Date.now());
    return passport;
  }

  passportForProfile(profileId: string): string {
    const head = this.db.prepare('SELECT * FROM passport_heads WHERE profile_id = ?').get(profileId) as PassportHeadRow | undefined;
    return head ? this.decryptPassport(head.encrypted_backup) : this.issuePassport(profileId);
  }

  private session(profileId: string, passport = this.passportForProfile(profileId)): ProfileSession {
    return { profileId, token: passport, passport };
  }

  syncPassport(profileId: string): ProfileSession {
    return this.session(profileId, this.issuePassport(profileId));
  }

  sessionForProfile(profileId: string): ProfileSession {
    this.getProfile(profileId);
    return this.session(profileId);
  }

  createProfile(nameInput: string, avatarInput?: AvatarInput): { session: ProfileSession; profile: PlayerProfile; recoveryKey: string } {
    const name = normalizeUsername(nameInput);
    if (!name) throw new TypeError('Use a 1–20 character name.');
    if (inappropriateUsername(name)) throw new ProfileNameBlockedError('Choose another name.');
    if (avatarInput && !validAvatar(avatarInput)) throw new TypeError('That avatar contains invalid parts or adjustments.');
    const id = randomUUID();
    const legacyToken = randomBytes(32).toString('base64url');
    const recoveryKey = this.newRecoveryKey();
    const now = Date.now();
    const avatar = avatarInput ? normalizeAvatar(avatarInput, name) : defaultAvatar(name);
    if (!avatarOwned(avatar, BASE_UNLOCKS)) throw new CosmeticLockedError('That avatar uses a part you have not unlocked.');
    try {
      this.db.prepare(`INSERT INTO profiles(id, token_hash, name, name_key, loadout_json, avatar_json, stats_json, recovery_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, tokenHash(legacyToken), name, nameKey(name), JSON.stringify(DEFAULT_COSMETIC_LOADOUT), JSON.stringify(avatar),
        JSON.stringify(emptyPlayerStats(now)), tokenHash(recoveryKey), now, now
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: profiles.name_key')) throw new ProfileNameTakenError('That name is already taken.');
      throw error;
    }
    for (const mode of ['eight-ball', 'nine-ball'] as GameMode[]) {
      this.db.prepare('INSERT INTO ratings(profile_id, mode) VALUES (?, ?)').run(id, mode);
    }
    for (const track of TRACKS) this.db.prepare('INSERT INTO mastery_progress(profile_id, track) VALUES (?, ?)').run(id, track);
    const passport = this.issuePassport(id);
    return { session: this.session(id, passport), profile: this.getProfile(id), recoveryKey };
  }

  resumeProfile(token: string): { session: ProfileSession; profile: PlayerProfile } {
    try {
      const payload = this.decodePassport(token);
      const head = this.db.prepare('SELECT * FROM passport_heads WHERE profile_id = ?').get(payload.profileId) as PassportHeadRow | undefined;
      if (!head || payload.authEpoch !== head.auth_epoch) throw new PassportInvalidError('That player passport has been replaced by recovery.');
      const current = this.decryptPassport(head.encrypted_backup);
      return { session: this.session(payload.profileId, current), profile: this.getProfile(payload.profileId) };
    } catch (error) {
      if (!(error instanceof PassportInvalidError)) throw error;
      const hashed = tokenHash(token);
      const row = this.db.prepare('SELECT profile_id AS id FROM profile_sessions WHERE token_hash = ?').get(hashed) as { id: string } | undefined;
      if (!row) throw error;
      this.db.prepare('DELETE FROM profile_sessions WHERE token_hash = ?').run(hashed);
      const passport = this.issuePassport(row.id);
      return { session: this.session(row.id, passport), profile: this.getProfile(row.id) };
    }
  }

  private newRecoveryKey(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(25);
    const groups = Array.from({ length: 5 }, (_, group) => Array.from({ length: 5 }, (_value, index) => alphabet[bytes[group * 5 + index]! % alphabet.length]).join(''));
    return groups.join('-');
  }

  createRecoveryKey(profileId: string): string {
    const recoveryKey = this.newRecoveryKey();
    const result = this.db.prepare('UPDATE profiles SET recovery_hash = ?, updated_at = ? WHERE id = ?')
      .run(tokenHash(recoveryKey), Date.now(), profileId);
    if (!result.changes) throw new ProfileNotFoundError('Profile not found.');
    return recoveryKey;
  }

  recoverProfile(recoveryKeyInput: string): { session: ProfileSession; profile: PlayerProfile; recoveryKey: string } {
    const recoveryKey = recoveryKeyInput.toUpperCase().trim();
    const row = this.db.prepare('SELECT id FROM profiles WHERE recovery_hash = ?').get(tokenHash(recoveryKey)) as { id: string } | undefined;
    if (!row) throw new ProfileNotFoundError('That recovery key is not valid.');
    const nextRecoveryKey = this.newRecoveryKey();
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE profiles SET recovery_hash = ?, updated_at = ? WHERE id = ?').run(tokenHash(nextRecoveryKey), now, row.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const passport = this.issuePassport(row.id, true);
    return { session: this.session(row.id, passport), profile: this.getProfile(row.id), recoveryKey: nextRecoveryKey };
  }

  updateName(profileId: string, nameInput: string): PlayerProfile {
    const name = normalizeUsername(nameInput);
    if (!name) throw new TypeError('Use a 1–20 character name.');
    if (inappropriateUsername(name)) throw new ProfileNameBlockedError('Choose another name.');
    try {
      const result = this.db.prepare('UPDATE profiles SET name = ?, name_key = ?, updated_at = ? WHERE id = ?')
        .run(name, nameKey(name), Date.now(), profileId);
      if (result.changes === 0) throw new ProfileNotFoundError('Profile not found.');
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: profiles.name_key')) throw new ProfileNameTakenError('That name is already taken.');
      throw error;
    }
    this.syncPassport(profileId);
    return this.getProfile(profileId);
  }

  updateAvatar(profileId: string, avatarInput: AvatarInput): PlayerProfile {
    if (!validAvatar(avatarInput)) throw new TypeError('That avatar contains invalid parts or adjustments.');
    const current = this.getProfile(profileId);
    const avatar = normalizeAvatar(avatarInput, current.name);
    if (!avatarOwned(avatar, current.unlocks)) throw new CosmeticLockedError('That avatar uses a part you have not unlocked.');
    const result = this.db.prepare('UPDATE profiles SET avatar_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(avatar), Date.now(), profileId);
    if (!result.changes) throw new ProfileNotFoundError('Profile not found.');
    this.syncPassport(profileId);
    return this.getProfile(profileId);
  }

  equip(profileId: string, loadout: CosmeticLoadout): PlayerProfile {
    const owned = new Set(this.getProfile(profileId).unlocks);
    const entries: Array<[keyof CosmeticLoadout, string]> = Object.entries(loadout) as Array<[keyof CosmeticLoadout, string]>;
    for (const [category, id] of entries) {
      const definition = COSMETIC_CATALOG.find((item) => item.id === id);
      if (!definition || definition.category !== category || !owned.has(id)) throw new CosmeticLockedError('That cosmetic is not unlocked.');
    }
    this.db.prepare('UPDATE profiles SET loadout_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(loadout), Date.now(), profileId);
    this.syncPassport(profileId);
    return this.getProfile(profileId);
  }

  purchase(profileId: string, cosmeticId: string, idempotencyKey: string): StorePurchaseResult {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw new TypeError('Use a valid purchase request ID.');
    const previous = this.db.prepare('SELECT profile_id, cosmetic_id FROM store_purchases WHERE idempotency_key = ?')
      .get(idempotencyKey) as { profile_id: string; cosmetic_id: string } | undefined;
    if (previous) {
      if (previous.profile_id !== profileId) throw new TypeError('That purchase request ID is already in use.');
      const profile = this.getProfile(profileId);
      return { profile, session: this.session(profileId), cosmeticId: previous.cosmetic_id };
    }
    const profile = this.getProfile(profileId);
    const item = COSMETIC_CATALOG.find((entry) => entry.id === cosmeticId);
    if (!item || !item.level || item.level <= 1 || item.mastery || item.priceXp === undefined) {
      throw new CosmeticLockedError('That cosmetic is earned outside the Store.');
    }
    if (profile.unlocks.includes(item.id)) throw new AlreadyOwnedError('You already own that cosmetic.');
    if (profile.level < item.level) throw new CosmeticLockedError(`Reach level ${item.level} to buy that cosmetic.`);
    if (profile.availableXp < item.priceXp) throw new InsufficientXpError('You do not have enough available XP.');
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const balance = this.db.prepare('SELECT total_xp, xp_spent FROM profiles WHERE id = ?').get(profileId) as { total_xp: number; xp_spent: number } | undefined;
      if (!balance || balance.total_xp - balance.xp_spent < item.priceXp) throw new InsufficientXpError('You do not have enough available XP.');
      this.db.prepare('UPDATE profiles SET xp_spent = xp_spent + ?, updated_at = ? WHERE id = ?').run(item.priceXp, now, profileId);
      this.db.prepare('INSERT INTO profile_unlocks(profile_id, cosmetic_id, source, unlocked_at) VALUES (?, ?, ?, ?)')
        .run(profileId, item.id, `Store · ${item.priceXp} XP`, now);
      this.db.prepare('INSERT INTO store_purchases(idempotency_key, profile_id, cosmetic_id, price_xp, purchased_at) VALUES (?, ?, ?, ?, ?)')
        .run(idempotencyKey, profileId, item.id, item.priceXp, now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const session = this.syncPassport(profileId);
    return { profile: this.getProfile(profileId), session, cosmeticId: item.id };
  }

  getProfile(profileId: string): PlayerProfile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as ProfileRow | undefined;
    if (!row) throw new ProfileNotFoundError('Profile not found.');
    const ratings = this.db.prepare(`SELECT mode, rating, rated_racks, wins, losses, rating_deviation, volatility, last_rated_at
      FROM ratings WHERE profile_id = ?`).all(profileId) as unknown as RatingRow[];
    const standings = Object.fromEntries(ratings.map((rating) => [rating.mode, {
      mode: rating.mode,
      rating: rating.rating,
      ratingDeviation: rating.rating_deviation,
      volatility: rating.volatility,
      lastRatedAt: rating.last_rated_at,
      ratedRacks: rating.rated_racks,
      wins: rating.wins,
      losses: rating.losses,
      tier: tierForRating(rating.rating, rating.rated_racks),
      provisional: rating.rated_racks < 10
    }])) as Record<GameMode, ModeStanding>;
    standings['eight-ball'] ??= defaultStanding('eight-ball');
    standings['nine-ball'] ??= defaultStanding('nine-ball');
    const unlockRows = this.db.prepare('SELECT cosmetic_id FROM profile_unlocks WHERE profile_id = ? ORDER BY unlocked_at').all(profileId) as unknown as Array<{ cosmetic_id: string }>;
    const masteryRows = this.db.prepare('SELECT track, progress FROM mastery_progress WHERE profile_id = ?').all(profileId) as unknown as Array<{ track: MasteryTrack; progress: number }>;
    const mastery = Object.fromEntries(TRACKS.map((track) => [track, masteryRows.find((entry) => entry.track === track)?.progress ?? 0])) as Record<MasteryTrack, number>;
    const challenges = this.db.prepare('SELECT challenge_id, medal, best_score FROM challenge_progress WHERE profile_id = ? ORDER BY challenge_id').all(profileId) as unknown as Array<{ challenge_id: PracticeChallengeId; medal: ChallengeMedal; best_score: number }>;
    const fallbackLoadout = { ...DEFAULT_COSMETIC_LOADOUT, ...parseJson<Partial<CosmeticLoadout>>(row.loadout_json, {}) };
    const avatar = normalizeAvatar(parseJson<unknown>(row.avatar_json, null), row.name);
    const stats = statsFromJson(row.stats_json, row.created_at);
    return {
      id: row.id,
      name: row.name,
      avatar,
      totalXp: row.total_xp,
      xpSpent: row.xp_spent,
      availableXp: Math.max(0, row.total_xp - row.xp_spent),
      level: row.level,
      standings,
      loadout: fallbackLoadout,
      unlocks: [...new Set([...BASE_UNLOCKS, ...unlockRows.map((entry) => entry.cosmetic_id)])],
      mastery,
      challenges: challenges.map((entry) => ({ challengeId: entry.challenge_id, medal: entry.medal, bestScore: entry.best_score })),
      stats,
      playstyle: inferPlaystyle(stats)
    };
  }

  publicProfile(profileId?: string, name?: string): PublicProfile {
    let id = profileId;
    if (!id && name) {
      const normalized = normalizeUsername(name);
      if (!normalized) throw new ProfileNotFoundError('Player not found.');
      const row = this.db.prepare('SELECT id FROM profiles WHERE name_key = ?').get(nameKey(normalized)) as { id: string } | undefined;
      id = row?.id;
    }
    if (!id) throw new ProfileNotFoundError('Player not found.');
    const profile = this.getProfile(id);
    return {
      id: profile.id, name: profile.name, avatar: profile.avatar, level: profile.level,
      standings: profile.standings, stats: profile.stats, playstyle: profile.playstyle, loadout: profile.loadout
    };
  }

  private mutateStats(profileId: string, mutate: (stats: PlayerStats) => void): void {
    const row = this.db.prepare('SELECT stats_json, created_at FROM profiles WHERE id = ?').get(profileId) as Pick<ProfileRow, 'stats_json' | 'created_at'> | undefined;
    if (!row) throw new ProfileNotFoundError('Profile not found.');
    const stats = statsFromJson(row.stats_json, row.created_at);
    mutate(stats);
    this.db.prepare('UPDATE profiles SET stats_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(stats), Date.now(), profileId);
  }

  recordShot(profileId: string, mode: GameMode, versusCpu: boolean, increments: Partial<CareerStats>): void {
    this.mutateStats(profileId, (stats) => {
      for (const target of [stats.total, stats.byMode[mode], versusCpu ? stats.cpuGames : stats.humanGames]) {
        for (const [key, amount] of Object.entries(increments) as Array<[keyof CareerStats, number]>) {
          if (Number.isFinite(amount)) target[key] = Math.max(0, target[key] + amount);
        }
      }
      const strokes = increments.strokes ?? 0;
      if (strokes > 0) {
        const value = (key: keyof CareerStats) => Number(increments[key] ?? 0) / strokes;
        const bounded = (amount: number) => Math.max(-1, Math.min(1, amount));
        const follow = value('followShots'); const draw = value('drawShots');
        const rail = value('banks') + value('kicks') + value('multiRailShots');
        const elevated = value('jumps') + value('masses') + value('swerves');
        stats.styleSamples = [...stats.styleSamples, {
          at: Date.now(),
          axes: {
            power: bounded((value('powerSum') - .5) / .32),
            spin: bounded((value('englishShots') - .42) / .38),
            'vertical-spin': bounded((follow - draw) / Math.max(.001, follow + draw)),
            tempo: bounded((value('aimTimeMs') / 1_000 - 15) / 12),
            intent: value('safeties') > 0 ? -1 : value('legalPockets') > 0 ? 1 : 0,
            route: rail > 0 ? 1 : -.65,
            technique: elevated > 0 ? 1 : -.7,
            discipline: value('fouls') + value('scratches') > 0 ? -1 : 1
          }
        }].slice(-60);
      }
    });
    this.syncPassport(profileId);
  }

  recordRackStats(profileId: string, mode: GameMode, versusCpu: boolean, won: boolean, playtimeMs: number): void {
    this.recordShot(profileId, mode, versusCpu, {
      gamesPlayed: 1, wins: won ? 1 : 0, losses: won ? 0 : 1, playtimeMs: Math.max(0, Math.round(playtimeMs))
    });
  }

  friendRecords(profileId: string): FriendRecords {
    this.getProfile(profileId);
    const friendships = this.db.prepare(`SELECT CASE WHEN profile_0 = ? THEN profile_1 ELSE profile_0 END AS friend_id
      FROM friendships WHERE profile_0 = ? OR profile_1 = ? ORDER BY created_at DESC`).all(profileId, profileId, profileId) as unknown as Array<{ friend_id: string }>;
    const requestRows = this.db.prepare(`SELECT sender_id, receiver_id, created_at FROM friend_requests
      WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC`).all(profileId, profileId) as unknown as Array<{ sender_id: string; receiver_id: string; created_at: number }>;
    const requests = requestRows.map((row): FriendRequest => ({
      profile: this.publicProfile(row.sender_id === profileId ? row.receiver_id : row.sender_id),
      direction: row.receiver_id === profileId ? 'incoming' : 'outgoing', createdAt: row.created_at
    }));
    const blocks = this.db.prepare('SELECT blocked_id FROM profile_blocks WHERE blocker_id = ?').all(profileId) as unknown as Array<{ blocked_id: string }>;
    return { friendIds: friendships.map((row) => row.friend_id), requests, blockedProfileIds: blocks.map((row) => row.blocked_id) };
  }

  requestFriend(profileId: string, otherId: string): void {
    if (profileId === otherId) throw new FriendError('You cannot friend yourself.');
    this.getProfile(otherId);
    const blocked = this.db.prepare(`SELECT 1 FROM profile_blocks WHERE
      (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`).get(profileId, otherId, otherId, profileId);
    if (blocked) throw new FriendError('That player is unavailable.');
    const [first, second] = [profileId, otherId].sort() as [string, string];
    if (this.db.prepare('SELECT 1 FROM friendships WHERE profile_0 = ? AND profile_1 = ?').get(first, second)) return;
    if (this.db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(otherId, profileId)) {
      this.respondFriend(profileId, otherId, true);
      return;
    }
    this.db.prepare('INSERT OR IGNORE INTO friend_requests(sender_id, receiver_id, created_at) VALUES (?, ?, ?)').run(profileId, otherId, Date.now());
  }

  respondFriend(profileId: string, otherId: string, accept: boolean): void {
    const request = this.db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(otherId, profileId);
    if (!request) throw new FriendError('That friend request no longer exists.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').run(otherId, profileId);
      if (accept) {
        const [first, second] = [profileId, otherId].sort() as [string, string];
        this.db.prepare('INSERT OR IGNORE INTO friendships(profile_0, profile_1, created_at) VALUES (?, ?, ?)').run(first, second, Date.now());
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  removeFriend(profileId: string, otherId: string): void {
    const [first, second] = [profileId, otherId].sort() as [string, string];
    this.db.prepare('DELETE FROM friendships WHERE profile_0 = ? AND profile_1 = ?').run(first, second);
    this.db.prepare('DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)')
      .run(profileId, otherId, otherId, profileId);
  }

  blockProfile(profileId: string, otherId: string, blocked: boolean): void {
    if (profileId === otherId) throw new FriendError('You cannot block yourself.');
    this.getProfile(otherId);
    if (blocked) {
      this.removeFriend(profileId, otherId);
      this.db.prepare('INSERT OR IGNORE INTO profile_blocks(blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(profileId, otherId, Date.now());
    } else this.db.prepare('DELETE FROM profile_blocks WHERE blocker_id = ? AND blocked_id = ?').run(profileId, otherId);
  }

  awardChallenge(profileId: string, challengeId: PracticeChallengeId, score: number, medal: ChallengeMedal): ChallengeAward {
    const safeScore = Math.max(0, Math.min(1_000, Math.round(score)));
    const safeMedal = Math.max(0, Math.min(3, Math.round(medal))) as ChallengeMedal;
    const previous = this.db.prepare('SELECT medal, best_score FROM challenge_progress WHERE profile_id = ? AND challenge_id = ?')
      .get(profileId, challengeId) as { medal: ChallengeMedal; best_score: number } | undefined;
    const previousMedal = previous?.medal ?? 0;
    const previousScore = previous?.best_score ?? 0;
    const nextMedal = Math.max(previousMedal, safeMedal) as ChallengeMedal;
    const nextScore = Math.max(previousScore, safeScore);
    const newBest = safeScore > previousScore;
    const medalBonuses = [0, 45, 105, 190];
    const xp = Math.max(0, Math.round((nextScore - previousScore) * 0.1)
      + medalBonuses.slice(previousMedal + 1, nextMedal + 1).reduce((total, bonus) => total + bonus, 0));
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const before = this.getProfile(profileId);
      this.db.prepare(`INSERT INTO challenge_progress(profile_id, challenge_id, medal, best_score) VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, challenge_id) DO UPDATE SET medal = excluded.medal, best_score = excluded.best_score`)
        .run(profileId, challengeId, nextMedal, nextScore);
      const totalXp = before.totalXp + xp;
      const levelAfter = levelForXp(totalXp);
      this.db.prepare('UPDATE profiles SET total_xp = ?, level = ?, updated_at = ? WHERE id = ?').run(totalXp, levelAfter, now, profileId);
      const unlocks: UnlockEvent[] = [];
      this.db.exec('COMMIT');
      const profile = this.getProfile(profileId);
      this.syncPassport(profileId);
      return { xp, newBest, unlocks, profile };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  settleCpuRack(input: {
    rackId: string; mode: GameMode; profileId: string; humanIndex: 0 | 1; winnerIndex: 0 | 1;
    performanceScores: [number, number]; mastery: Partial<Record<MasteryTrack, number>>; endedAt: number;
  }): RackSettlement {
    const before = this.getProfile(input.profileId);
    const won = input.winnerIndex === input.humanIndex;
    const performance = input.performanceScores[input.humanIndex];
    const xp = rackXp(performance, won, 0.45, 1, before.standings[input.mode].rating, 1_000);
    const totalXp = before.totalXp + xp;
    const levelAfter = levelForXp(totalXp);
    const unlocks: UnlockEvent[] = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE profiles SET total_xp = ?, level = ?, updated_at = ? WHERE id = ?').run(totalXp, levelAfter, input.endedAt, before.id);
      for (const [track, increment] of Object.entries(input.mastery) as Array<[MasteryTrack, number]>) {
        if (!increment) continue;
        this.db.prepare('UPDATE mastery_progress SET progress = progress + ? WHERE profile_id = ? AND track = ?').run(increment, before.id, track);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const standing = before.standings[input.mode];
    const reward = {
      profileId: before.id, xp, totalXp, levelBefore: before.level, levelAfter,
      ratingBefore: standing.rating, ratingAfter: standing.rating, tierBefore: standing.tier, tierAfter: standing.tier, unlocks
    };
    const cpuReward = {
      profileId: 'cpu', xp: 0, totalXp: 0, levelBefore: 1, levelAfter: 1,
      ratingBefore: 1_000, ratingAfter: 1_000, tierBefore: 'unranked' as const, tierAfter: 'unranked' as const, unlocks: []
    };
    this.syncPassport(before.id);
    return {
      rackId: input.rackId, competition: 'casual', mode: input.mode, winnerIndex: input.winnerIndex,
      performanceScores: input.performanceScores,
      rewards: (input.humanIndex === 0 ? [reward, cpuReward] : [cpuReward, reward]) as RackSettlement['rewards']
    };
  }

  private pairCount(profileIds: [string, string], endedAt: number): number {
    const since = endedAt - 24 * 60 * 60 * 1_000;
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM rack_results WHERE ended_at >= ? AND (
      (profile_0 = ? AND profile_1 = ?) OR (profile_0 = ? AND profile_1 = ?)
    )`).get(since, profileIds[0], profileIds[1], profileIds[1], profileIds[0]) as { count: number };
    return row.count;
  }

  settleRack(input: RackSettlementInput): RackSettlement {
    const existing = this.db.prepare('SELECT settlement_json FROM rack_results WHERE id = ?').get(input.rackId) as { settlement_json: string } | undefined;
    if (existing) return JSON.parse(existing.settlement_json) as RackSettlement;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const profiles = input.profileIds.map((id) => this.getProfile(id)) as [PlayerProfile, PlayerProfile];
      const repeat = repeatOpponentMultiplier(this.pairCount(input.profileIds, input.endedAt));
      const competitionMultiplier = input.competition === 'ranked' ? 1 : 0.5;
      const standings = profiles.map((profile) => profile.standings[input.mode]) as [ModeStanding, ModeStanding];
      const xp = [0, 1].map((index) => rackXp(
        input.performanceScores[index]!, input.winnerIndex === index, competitionMultiplier, repeat,
        standings[index]!.rating, standings[index === 0 ? 1 : 0]!.rating
      )) as [number, number];
      const nextStandings = input.competition === 'ranked' && repeat > 0
        ? [
            glicko2Update(standings[0], standings[1], input.winnerIndex === 0, input.endedAt, repeat),
            glicko2Update(standings[1], standings[0], input.winnerIndex === 1, input.endedAt, repeat)
          ] as [ModeStanding, ModeStanding]
        : standings;
      const ratingDeltas: [number, number] = [
        nextStandings[0].rating - standings[0].rating,
        nextStandings[1].rating - standings[1].rating
      ];
      const rewardRows = [0, 1].map((index) => {
        const profile = profiles[index]!;
        const standing = standings[index]!;
        const totalXp = profile.totalXp + xp[index]!;
        const levelAfter = levelForXp(totalXp);
        const nextStanding = nextStandings[index]!;
        const ratingAfter = nextStanding.rating;
        const ratedAfter = nextStanding.ratedRacks;
        const unlocks: UnlockEvent[] = [];
        this.db.prepare('UPDATE profiles SET total_xp = ?, level = ?, updated_at = ? WHERE id = ?').run(totalXp, levelAfter, input.endedAt, profile.id);
        if (input.competition === 'ranked' && repeat > 0) {
          this.db.prepare(`UPDATE ratings SET rating = ?, rating_deviation = ?, volatility = ?, last_rated_at = ?,
            rated_racks = ?, wins = ?, losses = ? WHERE profile_id = ? AND mode = ?`)
            .run(ratingAfter, nextStanding.ratingDeviation, nextStanding.volatility, nextStanding.lastRatedAt,
              nextStanding.ratedRacks, nextStanding.wins, nextStanding.losses, profile.id, input.mode);
        }
        for (const track of TRACKS) {
          const increment = input.mastery[index]![track] ?? 0;
          if (!increment) continue;
          const beforeProgress = profile.mastery[track];
          const afterProgress = beforeProgress + increment;
          this.db.prepare('UPDATE mastery_progress SET progress = ? WHERE profile_id = ? AND track = ?').run(afterProgress, profile.id, track);
          const beforeRank = masteryRank(track, beforeProgress);
          const afterRank = masteryRank(track, afterProgress);
          for (let rank = beforeRank + 1; rank <= afterRank; rank += 1) {
            const reward = COSMETIC_CATALOG.find((item) => item.mastery?.track === track && item.mastery.rank === rank);
            if (!reward) continue;
            const source = `${track} mastery ${rank}`;
            const result = this.db.prepare('INSERT OR IGNORE INTO profile_unlocks(profile_id, cosmetic_id, source, unlocked_at) VALUES (?, ?, ?, ?)')
              .run(profile.id, reward.id, source, input.endedAt);
            if (result.changes) unlocks.push({ cosmeticId: reward.id, name: reward.name, source });
          }
        }
        return {
          profileId: profile.id,
          xp: xp[index]!, totalXp,
          levelBefore: profile.level, levelAfter,
          ratingBefore: standing.rating, ratingAfter,
          tierBefore: standing.tier,
          tierAfter: tierForRating(ratingAfter, ratedAfter),
          unlocks
        };
      }) as RackSettlement['rewards'];
      const settlement: RackSettlement = {
        rackId: input.rackId,
        competition: input.competition,
        mode: input.mode,
        winnerIndex: input.winnerIndex,
        performanceScores: input.performanceScores,
        rewards: rewardRows
      };
      this.db.prepare(`INSERT INTO rack_results(
        id, competition, mode, ended_at, profile_0, profile_1, winner_index,
        performance_0, performance_1, xp_0, xp_1, rating_delta_0, rating_delta_1, settlement_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.rackId, input.competition, input.mode, input.endedAt, input.profileIds[0], input.profileIds[1], input.winnerIndex,
        input.performanceScores[0], input.performanceScores[1], xp[0], xp[1], ratingDeltas[0], ratingDeltas[1], JSON.stringify(settlement)
      );
      this.db.exec('COMMIT');
      input.profileIds.forEach((profileId) => this.syncPassport(profileId));
      return settlement;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  leaderboard(board: LeaderboardBoard, period: LeaderboardPeriod, selfId: string): LeaderboardPage {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    let rows: LeaderboardRow[];
    if (board === 'overall') {
      const valueExpression = period === 'all-time'
        ? 'p.total_xp'
        : `(SELECT COALESCE(SUM(CASE WHEN rr.profile_0 = p.id THEN rr.xp_0 ELSE rr.xp_1 END), 0)
           FROM rack_results rr WHERE rr.ended_at >= ${since} AND (rr.profile_0 = p.id OR rr.profile_1 = p.id))`;
      rows = this.db.prepare(`SELECT p.id AS profile_id, p.name, p.level, ${valueExpression} AS value,
        NULL AS rating, 0 AS rated_racks, 0 AS wins, 0 AS losses,
        json_extract(p.loadout_json, '$.frame') AS frame, p.avatar_json, NULL AS rating_deviation
        FROM profiles p ORDER BY value DESC, p.created_at ASC`).all() as unknown as LeaderboardRow[];
    } else {
      const activity = period === 'thirty-days'
        ? `AND (SELECT COUNT(*) FROM rack_results rr WHERE rr.competition = 'ranked' AND rr.mode = ? AND rr.ended_at >= ? AND (rr.profile_0 = p.id OR rr.profile_1 = p.id)) >= 5`
        : '';
      const parameters = period === 'thirty-days' ? [board, board, since] : [board];
      rows = this.db.prepare(`SELECT p.id AS profile_id, p.name, p.level, r.rating AS value, r.rating,
        r.rated_racks, r.wins, r.losses, json_extract(p.loadout_json, '$.frame') AS frame,
        p.avatar_json, r.rating_deviation
        FROM profiles p JOIN ratings r ON r.profile_id = p.id WHERE r.mode = ? AND r.rated_racks >= 10 ${activity}
        ORDER BY r.rating DESC, r.wins DESC, p.created_at ASC`).all(...parameters) as unknown as LeaderboardRow[];
    }
    const entries = rows.map((row, index): LeaderboardEntry => ({
      rank: index + 1,
      profileId: row.profile_id,
      name: row.name,
      level: row.level,
      value: row.value,
      tier: board === 'overall' ? null : tierForRating(row.rating ?? 1_000, row.rated_racks),
      ratedRacks: row.rated_racks,
      wins: row.wins,
      losses: row.losses,
      frame: row.frame,
      avatar: normalizeAvatar(parseJson<unknown>(row.avatar_json, null), row.name),
      ratingDeviation: row.rating_deviation,
      isSelf: row.profile_id === selfId
    }));
    const selfIndex = entries.findIndex((entry) => entry.isSelf);
    return {
      board, period,
      entries: entries.slice(0, 100),
      aroundMe: selfIndex < 0 ? [] : entries.slice(Math.max(0, selfIndex - 2), selfIndex + 3)
    };
  }

  saveReplay(document: ReplayDocument): void {
    this.db.prepare(`INSERT OR REPLACE INTO game_replays(id, mode, ended_at, quality_score, participant_0, participant_1, document_json, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      document.id, document.mode, document.endedAt, Math.round(document.qualityScore), document.participants[0].profileId,
      document.participants[1].profileId, JSON.stringify(document), document.checksum
    );
    this.db.prepare(`DELETE FROM game_replays WHERE mode = ? AND id NOT IN (
      SELECT id FROM game_replays WHERE mode = ? ORDER BY quality_score DESC, ended_at DESC LIMIT 250
    )`).run(document.mode, document.mode);
  }

  replays(mode: GameMode, period: LeaderboardPeriod): ReplayPage {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    const rows = this.db.prepare(`SELECT document_json FROM game_replays WHERE mode = ? ${period === 'thirty-days' ? 'AND ended_at >= ?' : ''}
      ORDER BY quality_score DESC, ended_at DESC LIMIT ?`).all(...(period === 'thirty-days' ? [mode, since, 100] : [mode, 250])) as unknown as Array<{ document_json: string }>;
    return { mode, period, entries: rows.map((row) => {
      const document = JSON.parse(row.document_json) as ReplayDocument;
      const { version: _version, settings: _settings, initialSnapshot: _initialSnapshot, shots: _shots, checksum: _checksum, ...summary } = document;
      return summary as ReplaySummary;
    }) };
  }

  replay(replayId: string): ReplayDocument {
    const row = this.db.prepare('SELECT document_json FROM game_replays WHERE id = ?').get(replayId) as { document_json: string } | undefined;
    if (!row) throw new ProfileNotFoundError('Replay not found.');
    return JSON.parse(row.document_json) as ReplayDocument;
  }
}
