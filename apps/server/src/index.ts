import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import cors, { type CorsOptions } from 'cors';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from '@breakroom/game-core';
import { RoomManager } from './rooms.js';
import { ProgressionStore } from './progression.js';
import { originAllowed, requestAddress, runtimeConfig, SlidingWindowRateLimiter } from './runtime.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const config = runtimeConfig();
const app = express();
const progression = new ProgressionStore();
const rateLimits = new SlidingWindowRateLimiter();
let shuttingDown = false;

const corsOrigin: NonNullable<CorsOptions['origin']> = (origin, callback) => {
  if (originAllowed(origin, config)) callback(null, true);
  else callback(new Error('Origin is not allowed.'));
};

app.disable('x-powered-by');
app.use(cors({ origin: corsOrigin, credentials: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false
  },
  maxHttpBufferSize: 8e6
});
const rooms = new RoomManager(io, progression);

function clientIdentity(socket: GameSocket): string {
  const address = requestAddress(socket.handshake.headers, socket.handshake.address, config.trustCloudflareIp);
  return rateLimits.identity(address);
}

function permitted(socket: GameSocket, scope: string, maximum: number, windowMs: number, profileAware = false): boolean {
  if (!config.rateLimitsEnabled) return true;
  const actor = profileAware && socket.data.profileId ? `profile:${socket.data.profileId}` : `client:${clientIdentity(socket)}`;
  return rateLimits.allow(`${scope}:${actor}`, maximum, windowMs);
}

const rateLimited = { ok: false as const, code: 'rate-limited' as const, message: 'Slow down for a moment.' };

io.use((socket, next) => {
  if (shuttingDown) return next(new Error('Server is restarting.'));
  if (!permitted(socket, 'connection', 60, 60_000)) return next(new Error('Too many connection attempts.'));
  next();
});

io.on('connection', (socket) => {
  socket.emit('rooms:directory', rooms.directory());
  socket.on('profile:create', (payload, ack) => {
    if (!permitted(socket, 'profile-create', 5, 60 * 60_000)) return ack(rateLimited);
    ack(rooms.createProfile(socket, payload.name, payload.avatar));
  });
  socket.on('profile:resume', (payload, ack) => {
    if (!permitted(socket, 'profile-resume', 60, 60_000)) return ack(rateLimited);
    ack(rooms.resumeProfile(socket, payload.token));
  });
  socket.on('profile:update', (payload, ack) => ack(rooms.updateProfile(socket, payload.name)));
  socket.on('profile:avatar', (payload, ack) => ack(rooms.updateAvatar(socket, payload.avatar)));
  socket.on('profile:public', (payload, ack) => ack(rooms.publicProfile(socket, payload.profileId, payload.name)));
  socket.on('profile:recovery-create', (_payload, ack) => ack(rooms.createRecovery(socket)));
  socket.on('profile:recover', (payload, ack) => {
    if (!permitted(socket, 'profile-recover', 10, 15 * 60_000)) return ack(rateLimited);
    ack(rooms.recoverProfile(socket, payload.recoveryKey));
  });
  socket.on('profile:equip', (payload, ack) => ack(rooms.equipProfile(socket, payload.loadout)));
  socket.on('store:purchase', (payload, ack) => ack(rooms.purchaseCosmetic(socket, payload.cosmeticId, payload.idempotencyKey)));
  socket.on('friends:list', (_payload, ack) => ack(rooms.listFriends(socket)));
  socket.on('friends:search', (payload, ack) => ack(rooms.searchFriend(socket, payload.name)));
  socket.on('friends:request', (payload, ack) => ack(rooms.requestFriend(socket, payload.profileId)));
  socket.on('friends:respond', (payload, ack) => ack(rooms.respondFriend(socket, payload.profileId, payload.accept)));
  socket.on('friends:remove', (payload, ack) => ack(rooms.removeFriend(socket, payload.profileId)));
  socket.on('friends:block', (payload, ack) => ack(rooms.blockFriend(socket, payload.profileId, payload.blocked)));
  socket.on('friends:invite', (payload, ack) => ack(rooms.inviteFriend(socket, payload.profileId)));
  socket.on('room:join-invite', (payload, ack) => ack(rooms.joinInvite(socket, payload.inviteId)));
  socket.on('replays:list', (payload, ack) => ack(rooms.replayList(socket, payload.mode, payload.period)));
  socket.on('replay:get', (payload, ack) => ack(rooms.replayGet(socket, payload.replayId)));
  socket.on('leaderboard:list', (payload, ack) => ack(rooms.leaderboard(socket, payload.board, payload.period)));
  socket.on('practice:challenge-start', (payload, ack) => ack(rooms.startPracticeChallenge(socket, payload.challengeId)));
  socket.on('practice:challenge-assist', (payload, ack) => ack(rooms.assistPracticeChallenge(socket, payload.attemptId)));
  socket.on('practice:challenge-submit', (payload, ack) => {
    if (!permitted(socket, 'practice-submit', 30, 60_000, true)) return ack(rateLimited);
    ack(rooms.submitPracticeChallenge(socket, payload.attemptId, payload.shot));
  });
  socket.on('rooms:list', (_payload, ack) => ack(rooms.list()));
  socket.on('room:create', (payload, ack) => {
    if (!permitted(socket, 'room-create', 10, 60_000, true)) return ack(rateLimited);
    ack(rooms.create(socket, payload.settings));
  });
  socket.on('room:join', (payload, ack) => {
    if (!permitted(socket, 'room-join', 30, 60_000, true)) return ack(rateLimited);
    ack(rooms.join(socket, payload.code));
  });
  socket.on('room:join-open', (payload, ack) => {
    if (!permitted(socket, 'room-join', 30, 60_000, true)) return ack(rateLimited);
    ack(rooms.joinOpen(socket, payload.listingId));
  });
  socket.on('room:resume', (payload, ack) => {
    if (!permitted(socket, 'room-resume', 30, 60_000, true)) return ack(rateLimited);
    ack(rooms.resume(socket, payload.code, payload.token));
  });
  socket.on('room:settings', (payload, ack) => ack(rooms.updateSettings(socket, payload.settings)));
  socket.on('room:chat-settings', (payload, ack) => ack(rooms.updateChatSettings(socket, payload.enabled, payload.filterEnabled)));
  socket.on('chat:send', (payload, ack) => ack(rooms.sendChat(socket, payload.clientMessageId, payload.text)));
  socket.on('player:ready', (payload, ack) => ack(rooms.setReady(socket, payload.ready)));
  socket.on('match:start', (_payload, ack) => ack(rooms.start(socket)));
  socket.on('cue:place', (payload, ack) => ack(rooms.placeCue(socket, payload)));
  socket.on('shot:take', (payload, ack) => ack(rooms.takeShot(socket, payload)));
  socket.on('rack:next', (_payload, ack) => ack(rooms.nextRack(socket)));
  socket.on('push-out:return', (_payload, ack) => ack(rooms.returnPushOut(socket)));
  socket.on('room:leave', (_payload, ack) => ack(rooms.leave(socket)));
  socket.on('aim:update', (payload) => {
    if (!permitted(socket, 'aim-update', 45, 1_000)) return;
    const context = rooms.context(socket);
    if (!context || !Number.isFinite(payload.angle) || !Number.isFinite(payload.power) || !Number.isFinite(payload.elevation)) return;
    socket.to(context.room.code).volatile.emit('presence:aim', {
      playerId: context.player.id,
      angle: payload.angle,
      power: payload.power,
      elevation: payload.elevation,
      english: payload.english
    });
  });
  socket.on('disconnect', () => rooms.disconnect(socket));
});

app.get('/health', (_request, response) => {
  const database = progression.healthy();
  const healthy = database && !shuttingDown;
  response.status(healthy ? 200 : 503).json({
    ok: healthy,
    service: 'breakroom-server',
    version: config.appVersion,
    persistence: 'sqlite',
    database,
    activeRooms: rooms.rooms.size,
    connectedClients: io.engine.clientsCount,
    shuttingDown
  });
});

const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { extensions: ['html'], maxAge: '1h' }));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(clientDist, 'index.html')));
}

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`Breakroom server ${config.appVersion} listening on http://0.0.0.0:${config.port}`);
});

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);
  io.emit('connection:notice', { message: 'Server maintenance is starting. Your player profile is safe.', tone: 'warning' });
  const forcedExit = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 10_000);
  setTimeout(() => {
    io.close(() => {
      try {
        progression.checkpoint();
        progression.close();
        clearTimeout(forcedExit);
        process.exit(0);
      } catch (error) {
        console.error('Failed to close persistence cleanly.', error);
        process.exit(1);
      }
    });
  }, 250);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
