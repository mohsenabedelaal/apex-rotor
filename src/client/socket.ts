import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/controller';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const createSocket = (): AppSocket => io('/', { transports: ['websocket', 'polling'] });
