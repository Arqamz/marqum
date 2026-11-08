export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS?: Fetcher;
  /** initial passcode, used until one is set via /api/auth/passcode */
  PASSCODE: string;
  /** server-side secret mixed into every stored token hash */
  TOKEN_PEPPER: string;
}

export interface Device {
  id: string;
  name: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { device: Device; steppedUp: boolean };
};
