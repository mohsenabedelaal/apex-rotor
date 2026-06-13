import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/controller';

type InterServerEvents = Record<string, never>;
type SocketData = {
  roomId?: string;
  role?: 'game' | 'remote';
};

const PORT = Number(process.env.PORT ?? 3001);
const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: true,
  },
});

const gameSocketsByRoom = new Map<string, string>();
const remoteSocketsByRoom = new Map<string, Set<string>>();

const emitStatus = (roomId: string): void => {
  const hasRemote = (remoteSocketsByRoom.get(roomId)?.size ?? 0) > 0;
  io.to(roomId).emit('room:status', hasRemote ? 'connected' : 'waiting');
};

io.on('connection', (socket) => {
  socket.on('game:createRoom', (roomId) => {
    socket.data.roomId = roomId;
    socket.data.role = 'game';
    gameSocketsByRoom.set(roomId, socket.id);
    socket.join(roomId);
    emitStatus(roomId);
  });

  socket.on('remote:joinRoom', (roomId) => {
    socket.data.roomId = roomId;
    socket.data.role = 'remote';
    socket.join(roomId);

    const remotes = remoteSocketsByRoom.get(roomId) ?? new Set<string>();
    remotes.add(socket.id);
    remoteSocketsByRoom.set(roomId, remotes);
    emitStatus(roomId);
  });

  socket.on('remote:controlState', ({ roomId, state }) => {
    const gameSocketId = gameSocketsByRoom.get(roomId);
    if (gameSocketId) {
      io.to(gameSocketId).emit('remote:controlState', state);
    }
  });

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (!roomId || !role) {
      return;
    }

    if (role === 'game') {
      gameSocketsByRoom.delete(roomId);
      io.to(roomId).emit('room:status', 'disconnected');
      return;
    }

    const remotes = remoteSocketsByRoom.get(roomId);
    remotes?.delete(socket.id);
    if (remotes?.size === 0) {
      remoteSocketsByRoom.delete(roomId);
      io.to(roomId).emit('room:status', 'disconnected');
      io.to(roomId).emit('room:status', 'waiting');
      return;
    }

    emitStatus(roomId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on http://localhost:${PORT}`);
});
