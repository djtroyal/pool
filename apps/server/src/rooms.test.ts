import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from '@breakroom/game-core';
import { DEFAULT_SETTINGS } from '@breakroom/game-core';
import { RoomManager } from './rooms.js';
import { ProgressionStore } from './progression.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

function fakeIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() }
  };
}

function fakeSocket(id: string): GameSocket {
  const roomEmitter = { emit: () => undefined };
  return {
    id,
    data: {},
    join: async () => undefined,
    leave: async () => undefined,
    emit: () => true,
    to: () => ({ volatile: roomEmitter })
  } as unknown as GameSocket;
}

function roomManager(): RoomManager { return new RoomManager(fakeIo() as any, new ProgressionStore(':memory:')); }

function identify(manager: RoomManager, socket: GameSocket, name: string): void {
  const result = manager.createProfile(socket, name);
  if (!result.ok) throw new Error(result.message);
}

describe('authoritative rooms', () => {
  it('creates, joins, starts, and rejects an out-of-turn shot', () => {
    const manager = roomManager();
    const first = fakeSocket('first');
    const second = fakeSocket('second');
    identify(manager, first, 'Avery'); identify(manager, second, 'Morgan');
    const created = manager.create(first, { ...DEFAULT_SETTINGS, mode: 'eight-ball' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = manager.join(second, created.data.room.code);
    expect(joined.ok).toBe(true);
    expect(manager.setReady(first, true).ok).toBe(true);
    expect(manager.setReady(second, true).ok).toBe(true);
    const started = manager.start(first);
    expect(started.ok).toBe(true);
    if (!started.ok || !started.data.game) return;

    const activeIndex = started.data.game.turnIndex;
    const inactiveClient = activeIndex === 0 ? second : first;
    const rejected = manager.takeShot(inactiveClient, {
      revision: started.data.game.revision,
      angle: 0,
      power: 0.5,
      elevation: 0,
      english: { side: 0, vertical: 0 }
    });
    expect(rejected).toMatchObject({ ok: false, code: 'not-your-turn' });
  });

  it('restores the same player seat with a reconnect token', () => {
    const manager = roomManager();
    const original = fakeSocket('original');
    identify(manager, original, 'Avery');
    const created = manager.create(original, { ...DEFAULT_SETTINGS, mode: 'nine-ball', shotClock: 45 });
    if (!created.ok) throw new Error(created.message);
    manager.disconnect(original);
    const restored = fakeSocket('restored');
    const profile = manager.progression.getProfile(original.data.profileId!);
    restored.data.profileId = profile.id;
    const resumed = manager.resume(restored, created.data.room.code, created.data.session.token);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.data.session.playerId).toBe(created.data.session.playerId);
  });

  it('accepts a one-character name and redacts private room details', () => {
    const manager = roomManager();
    const host = fakeSocket('host'); identify(manager, host, 'Q');
    const created = manager.create(host, DEFAULT_SETTINGS);
    expect(created.ok).toBe(true);
    const listed = manager.directory()[0]!;
    expect(listed).toMatchObject({ visibility: 'private', hostName: 'Q', joinable: false });
    expect('players' in listed).toBe(false);
  });

  it('allows joining an open waiting room by its listing id', () => {
    const manager = roomManager();
    const host = fakeSocket('host'); const guest = fakeSocket('guest'); identify(manager, host, 'H'); identify(manager, guest, 'G');
    const created = manager.create(host, { ...DEFAULT_SETTINGS, visibility: 'open' });
    if (!created.ok) throw new Error(created.message);
    const listing = manager.directory()[0]!;
    expect(listing.joinable).toBe(true);
    expect(manager.joinOpen(guest, listing.listingId).ok).toBe(true);
    expect(manager.directory()[0]!.joinable).toBe(false);
  });

  it('validates and defensively copies the host trajectory allowlist', () => {
    const manager = roomManager();
    const host = fakeSocket('host');
    identify(manager, host, 'H');
    const settings = {
      ...DEFAULT_SETTINGS,
      allowedTrajectoryAids: { ...DEFAULT_SETTINGS.allowedTrajectoryAids, advancedObjectPath: false }
    };
    const created = manager.create(host, settings);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    settings.allowedTrajectoryAids.advancedObjectPath = true;
    expect(created.data.room.settings.allowedTrajectoryAids.advancedObjectPath).toBe(false);
    const invalid = {
      ...DEFAULT_SETTINGS,
      allowedTrajectoryAids: { ...DEFAULT_SETTINGS.allowedTrajectoryAids, advancedObjectPath: 'sometimes' }
    };
    const invalidSocket = fakeSocket('invalid'); identify(manager, invalidSocket, 'I');
    expect(manager.create(invalidSocket, invalid as any).ok).toBe(false);
  });

  it('keeps game chat ephemeral, filtered, deduplicated, and host-controlled', () => {
    const manager = roomManager();
    const host = fakeSocket('chat-host'); const guest = fakeSocket('chat-guest');
    identify(manager, host, 'Host'); identify(manager, guest, 'Guest');
    const created = manager.create(host, { ...DEFAULT_SETTINGS, chatEnabled: true, chatFilterEnabled: true });
    if (!created.ok) throw new Error(created.message);
    const joined = manager.join(guest, created.data.room.code);
    if (!joined.ok) throw new Error(joined.message);
    manager.setReady(host, true); manager.setReady(guest, true); manager.start(host);
    const first = manager.sendChat(guest, 'message_request_01', 'that shot was shit');
    expect(first).toMatchObject({ ok: true, data: { filtered: true } });
    if (!first.ok) return;
    expect(first.data.text).not.toContain('shit');
    const duplicate = manager.sendChat(guest, 'message_request_01', 'different text');
    expect(duplicate).toEqual(first);
    expect(manager.updateChatSettings(guest, false, true)).toMatchObject({ ok: false, code: 'not-host' });
    expect(manager.updateChatSettings(host, false, true).ok).toBe(true);
    expect(manager.sendChat(guest, 'message_request_02', 'hello')).toMatchObject({ ok: false, code: 'chat-disabled' });
  });

  it('locks ranked rooms to standardized competitive settings', () => {
    const manager = roomManager();
    const host = fakeSocket('ranked-host'); identify(manager, host, 'Ranked');
    const created = manager.create(host, {
      ...DEFAULT_SETTINGS,
      competition: 'ranked',
      shotClock: 0,
      clothSpeed: 'very-slow',
      allowElevatedShots: false,
      allowedTrajectoryAids: { advancedCuePath: false, simpleObjectPath: false, advancedObjectPath: false, railContinuations: false }
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.room.settings).toMatchObject({ shotClock: 60, clothSpeed: 'standard', allowElevatedShots: true });
    expect(Object.values(created.data.room.settings.allowedTrajectoryAids)).toEqual([true, true, true, true]);
  });

  it('simulates and rewards practice challenges on the server', () => {
    const manager = roomManager();
    const player = fakeSocket('drill-player'); identify(manager, player, 'DrillPlayer');
    const started = manager.startPracticeChallenge(player, 'break-lab');
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const submitted = manager.submitPracticeChallenge(player, started.data.attemptId, {
      revision: started.data.game.revision,
      angle: 0,
      power: 0.9,
      elevation: 0,
      english: { side: 0, vertical: 0 }
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.data.score).toBeGreaterThan(0);
    expect(submitted.data.profile.challenges).toContainEqual(expect.objectContaining({ challengeId: 'break-lab' }));
    expect(manager.submitPracticeChallenge(player, started.data.attemptId, submitted.data.playback.shot)).toMatchObject({ ok: false, code: 'session-expired' });
  });

  it('irrevocably marks optimizer-assisted drill attempts as unscored', () => {
    const manager = roomManager();
    const player = fakeSocket('assisted-drill-player'); identify(manager, player, 'Assist');
    const started = manager.startPracticeChallenge(player, 'break-lab');
    expect(started).toMatchObject({ ok: true, data: { assisted: false } });
    if (!started.ok) return;
    expect(manager.assistPracticeChallenge(player, started.data.attemptId)).toEqual({ ok: true, data: { assisted: true } });
    const submitted = manager.submitPracticeChallenge(player, started.data.attemptId, {
      revision: started.data.game.revision, angle: 0, power: 0.9, elevation: 0,
      english: { side: 0, vertical: 0 }
    });
    expect(submitted).toMatchObject({
      ok: true,
      data: { assisted: true, xp: 0, newBest: false, unlocks: [] }
    });
    if (!submitted.ok) return;
    expect(submitted.data.profile.challenges).not.toContainEqual(expect.objectContaining({ challengeId: 'break-lab' }));
  });
});
