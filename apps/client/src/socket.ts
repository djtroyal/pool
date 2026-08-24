import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@breakroom/game-core';

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl || undefined, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 700,
  reconnectionDelayMax: 4_000
});
