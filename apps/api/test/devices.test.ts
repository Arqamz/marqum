import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import { app } from "../src/index.ts";

type Value = string | number | null;

/** Minimal D1 over node:sqlite, enough for the auth routes. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: Value[] = []) => ({
    sql,
    args,
    bind: (...a: Value[]) => stmt(sql, a),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    all: async () => ({ success: true, results: db.prepare(sql).all(...args), meta: {} }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => Promise.all(list.map((s) => s.run())),
  } as unknown as D1Database;
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} };
let env: Env;

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
    ctx as unknown as ExecutionContext,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const login = async (device_name: string) =>
  (await call("POST", "/api/auth/login", undefined, { passcode: "test-passcode", device_name })).json as {
    token: string;
    device_id: string;
  };

beforeEach(() => {
  env = { DB: fakeD1(), PASSCODE: "test-passcode", TOKEN_PEPPER: "pepper" } as unknown as Env;
});

describe("devices", () => {
  it("removing a device drops it from the list and signs it out", async () => {
    const phone = await login("Phone");
    const temp = await login("Setup (Mac, temporary)");
    const list = async () =>
      ((await call("GET", "/api/auth/devices", phone.token)).json as unknown as { id: string }[]).map(
        (d) => d.id,
      );
    expect(await list()).toEqual([phone.device_id, temp.device_id]);

    expect((await call("DELETE", `/api/auth/devices/${temp.device_id}`, phone.token)).status).toBe(200);
    expect(await list()).toEqual([phone.device_id]);
    expect((await call("GET", "/api/auth/me", temp.token)).status).toBe(401);

    // a second click (stale list) is harmless, an unknown id is 404
    expect((await call("DELETE", `/api/auth/devices/${temp.device_id}`, phone.token)).status).toBe(200);
    expect((await call("DELETE", "/api/auth/devices/nope", phone.token)).status).toBe(404);
  });
});
