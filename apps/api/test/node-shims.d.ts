// The API typechecks against workers-types only; these are the bits of Node the D1 route tests use.
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
}
declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: Value[]): { changes: number | bigint };
      all(...args: Value[]): unknown[];
      get(...args: Value[]): unknown;
    };
  }
}
interface ImportMeta {
  readonly url: string;
}
