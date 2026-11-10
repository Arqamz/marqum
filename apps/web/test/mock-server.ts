/**
 * In-memory stand-in for the Worker's sync API, built on the same @marqum/core handlers the Worker runs.
 * Used by the Vitest sync tests and by the Playwright smoke (via route interception). Synthetic data only.
 */
import {
  type Command,
  closeChecklist,
  type Dataset,
  emptyDataset,
  execute,
  seedMutations,
} from "@marqum/core";
import { TABLE_NAMES } from "@marqum/schema";

type Row = Record<string, unknown> & { id: string; version: number };

export interface MockResponse {
  status: number;
  body: unknown;
}

export class MockServer {
  version = 0;
  rows = new Map<string, Map<string, Row>>(TABLE_NAMES.map((t) => [t, new Map()]));
  log: Command[] = [];
  seen = new Map<string, unknown>();
  passcode = "2468";
  token = "test-token";
  epoch = "epoch-1";
  private n = 0;

  constructor(public now: string) {
    this.apply(seedMutations(now));
  }

  dataset(): Dataset {
    const ds = emptyDataset() as unknown as Record<string, unknown[]>;
    for (const t of TABLE_NAMES)
      ds[t] = [...(this.rows.get(t)?.values() ?? [])].filter((r) => r.deleted !== true);
    return ds as unknown as Dataset;
  }

  private apply(mutations: { table: string; row: Record<string, unknown> & { id: string } }[]): void {
    this.version++;
    for (const m of mutations) {
      this.rows.get(m.table)?.set(m.row.id, { deleted: false, ...m.row, version: this.version } as Row);
    }
  }

  newId = (): string => `srv${String(++this.n).padStart(8, "0")}`;

  run(command: Command, steppedUp = false) {
    if (this.seen.has(command.id))
      return this.seen.get(command.id) as ReturnType<typeof execute> & { id: string };
    const outcome = execute(this.dataset(), command, { now: this.now, steppedUp, newId: this.newId });
    if (outcome.ok) {
      this.apply(outcome.mutations);
      this.log.push(command);
      if (command.name === "resetLedger") this.epoch = `epoch-${this.version}`;
    }
    const result = {
      id: command.id,
      ok: outcome.ok,
      error: outcome.error,
      message: outcome.message,
      result: outcome.result,
    };
    if (outcome.ok) this.seen.set(command.id, result);
    return result;
  }

  /** Simulate a reset done from another device: new epoch, ledger rows gone. */
  resetElsewhere(): void {
    this.epoch = `epoch-other-${this.version}`;
    for (const t of ["transactions", "statements", "balances", "months", "notifications", "goal_moves"])
      this.rows.get(t)?.clear();
    this.version++;
  }

  /** Route a request like the Worker would. */
  handle(method: string, url: string, headers: Record<string, string>, body: unknown): MockResponse {
    const u = new URL(url, "http://local");
    const path = u.pathname;
    if (path === "/api/auth/login" && method === "POST") {
      const b = body as { passcode?: string };
      if (b.passcode !== this.passcode) return { status: 401, body: { error: "bad_passcode" } };
      return { status: 200, body: { token: this.token, device_id: "dev-test" } };
    }
    if (path === "/api/health") return { status: 200, body: { ok: true, version: "test" } };
    if (headers.authorization !== `Bearer ${this.token}`)
      return { status: 401, body: { error: "unauthorized" } };
    const steppedUp = Boolean(headers["x-step-up"]);
    if (path === "/api/sync/push" && method === "POST") {
      const cmds = (body as { commands: Command[] }).commands;
      const results = cmds.map((c) => this.run(c, steppedUp));
      return { status: 200, body: { results, version: this.version } };
    }
    if (path === "/api/sync/pull") {
      const since = Number(u.searchParams.get("since") ?? 0);
      const changes: Record<string, Row[]> = {};
      for (const t of TABLE_NAMES) {
        const rows = [...(this.rows.get(t)?.values() ?? [])].filter((r) => r.version > since);
        if (rows.length) changes[t] = rows;
      }
      let rows = 0;
      let version_sum = 0;
      for (const m of this.rows.values())
        for (const r of m.values())
          if (r.deleted !== true) {
            rows++;
            version_sum += r.version;
          }
      return {
        status: 200,
        body: {
          version: this.version,
          changes,
          more: false,
          epoch: this.epoch,
          digest: { rows, version_sum },
        },
      };
    }
    const check = path.match(/^\/api\/months\/(\d{4}-\d{2})\/check$/);
    if (check?.[1]) return { status: 200, body: closeChecklist(this.dataset(), check[1], this.now) };
    if (path === "/api/auth/devices") {
      return {
        status: 200,
        body: [{ id: "dev-test", name: "Test phone", last_seen_at: this.now, current: true }],
      };
    }
    if (path === "/api/auth/step-up/passcode") {
      const b = body as { passcode?: string };
      if (b.passcode !== this.passcode) return { status: 401, body: { error: "bad_passcode" } };
      return { status: 200, body: { step_up_token: "step-up-ok", expires_at: "2099-01-01T00:00:00Z" } };
    }
    if (path.startsWith("/api/auth/step-up/passkey")) return { status: 400, body: { error: "no_passkey" } };
    return { status: 404, body: { error: "not_found" } };
  }

  /** A fetch implementation backed by this server (for Vitest). */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>))
      headers[k.toLowerCase()] = v;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const res = this.handle(init?.method ?? "GET", url, headers, body);
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  };
}
