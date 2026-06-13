declare module 'node:http' {
  export type Server = {
    listen(port: number, callback?: () => void): void;
  };
  export const createServer: () => Server;
}

declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  execPath: string;
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
};
