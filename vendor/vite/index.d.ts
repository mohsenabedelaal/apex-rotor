export type UserConfig = Record<string, unknown>;
export declare const defineConfig: <T extends UserConfig>(config: T) => T;
