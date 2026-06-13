export type EventHandler = (...args: any[]) => void;
export interface Socket<ServerToClientEvents = Record<string, EventHandler>, ClientToServerEvents = Record<string, EventHandler>> {
  on<E extends keyof ServerToClientEvents & string>(event: E, handler: Extract<ServerToClientEvents[E], EventHandler>): this;
  on(event: 'connect' | 'disconnect', handler: () => void): this;
  emit<E extends keyof ClientToServerEvents & string>(event: E, ...args: Parameters<Extract<ClientToServerEvents[E], EventHandler>>): this;
}
export declare const io: <ServerToClientEvents = Record<string, EventHandler>, ClientToServerEvents = Record<string, EventHandler>>(url?: string, options?: unknown) => Socket<ServerToClientEvents, ClientToServerEvents>;
