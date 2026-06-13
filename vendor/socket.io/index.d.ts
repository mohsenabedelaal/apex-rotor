export type EventHandler = (...args: any[]) => void;
export type SocketData = Record<string, any>;
export declare class Server<
  ClientToServerEvents = Record<string, EventHandler>,
  ServerToClientEvents = Record<string, EventHandler>,
  InterServerEvents = Record<string, EventHandler>,
  Data extends SocketData = SocketData,
> {
  constructor(httpServer?: unknown, options?: unknown);
  on(event: 'connection', handler: (socket: ServerSocket<ClientToServerEvents, Data>) => void): this;
  to(roomOrSocketId: string): { emit<E extends keyof ServerToClientEvents & string>(event: E, ...args: Parameters<Extract<ServerToClientEvents[E], EventHandler>>): void };
  emit<E extends keyof ServerToClientEvents & string>(event: E, ...args: Parameters<Extract<ServerToClientEvents[E], EventHandler>>): void;
}
export interface ServerSocket<ClientToServerEvents, Data extends SocketData> {
  id: string;
  data: Data;
  join(roomId: string): void;
  on<E extends keyof ClientToServerEvents & string>(event: E, handler: Extract<ClientToServerEvents[E], EventHandler>): void;
  on(event: 'disconnect', handler: () => void): void;
}
