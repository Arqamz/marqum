import { createMiddleware } from "hono/factory";
import type { AppEnv, Env } from "../env.ts";
import { randomToken, safeEqual, tokenHash, verifyPasscode } from "./crypto.ts";
import { fail, isoNow, sleep } from "./http.ts";

export const STEP_UP_TTL_MS = 5 * 60_000;
export const FAIL_DELAY_MS = 700;
export const THROTTLE_MAX = 10;
export const THROTTLE_WINDOW_MS = 15 * 60_000;

const bearer = (h: string | undefined) => h?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

/** Bearer-token auth: sets `device`, and `steppedUp` when a valid X-Step-Up header is present. */
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearer(c.req.header("Authorization"));
  if (!token) return fail(401, "unauthorized", "Sign in first.");
  const hash = await tokenHash(token, c.env.TOKEN_PEPPER);
  const device = await c.env.DB.prepare(
    "SELECT id, name, last_seen FROM devices WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(hash)
    .first<{ id: string; name: string; last_seen: string | null }>();
  if (!device) return fail(401, "unauthorized", "This device was signed out. Sign in again.");
  c.set("device", { id: device.id, name: device.name });
  c.set("steppedUp", await hasStepUp(c.env, device.id, c.req.header("X-Step-Up")));
  const now = isoNow();
  if (!device.last_seen || Date.parse(now) - Date.parse(device.last_seen) > 60_000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(now, device.id).run(),
    );
  }
  await next();
});

export async function hasStepUp(env: Env, deviceId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM step_up WHERE token_hash = ? AND device_id = ? AND expires_at > ?",
  )
    .bind(await tokenHash(token, env.TOKEN_PEPPER), deviceId, isoNow())
    .first();
  return row !== null;
}

export async function mintStepUp(
  env: Env,
  deviceId: string,
): Promise<{ step_up_token: string; expires_at: string }> {
  const token = randomToken();
  const expires_at = new Date(Date.now() + STEP_UP_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM step_up WHERE expires_at <= ?").bind(isoNow()),
    env.DB.prepare("INSERT INTO step_up (token_hash, device_id, expires_at) VALUES (?, ?, ?)").bind(
      await tokenHash(token, env.TOKEN_PEPPER),
      deviceId,
      expires_at,
    ),
  ]);
  return { step_up_token: token, expires_at };
}

/** Check a passcode against the stored hash, or the initial PASSCODE secret if none was set yet. */
export async function passcodeMatches(env: Env, passcode: string): Promise<boolean> {
  const stored = await env.DB.prepare("SELECT value FROM meta WHERE key = 'passcode_hash'").first<{
    value: string;
  }>();
  if (stored) return verifyPasscode(passcode, stored.value, env.TOKEN_PEPPER);
  if (!env.PASSCODE || env.PASSCODE.length < 4) return false;
  return safeEqual(passcode, env.PASSCODE);
}

/** Per-IP failed-attempt counter in D1. */
export async function checkThrottle(env: Env, ip: string): Promise<void> {
  const row = await env.DB.prepare("SELECT count, reset_at FROM throttle WHERE key = ?")
    .bind(`pass:${ip}`)
    .first<{ count: number; reset_at: string }>();
  if (row && row.reset_at > isoNow() && row.count >= THROTTLE_MAX)
    fail(429, "throttled", "Too many wrong passcodes. Try again in 15 minutes.");
}

async function recordFailure(env: Env, ip: string): Promise<void> {
  const now = isoNow();
  const reset = new Date(Date.now() + THROTTLE_WINDOW_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO throttle (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN throttle.reset_at <= ? THEN 1 ELSE throttle.count + 1 END,
       reset_at = CASE WHEN throttle.reset_at <= ? THEN excluded.reset_at ELSE throttle.reset_at END`,
  )
    .bind(`pass:${ip}`, reset, now, now)
    .run();
}

/** Throttled, delayed passcode check; throws 401/429 on failure. */
export async function requirePasscode(env: Env, ip: string, passcode: string): Promise<void> {
  await checkThrottle(env, ip);
  if (await passcodeMatches(env, passcode)) {
    await env.DB.prepare("DELETE FROM throttle WHERE key = ?").bind(`pass:${ip}`).run();
    return;
  }
  await recordFailure(env, ip);
  await sleep(FAIL_DELAY_MS);
  fail(401, "invalid_passcode", "That passcode isn't right.");
}

export const clientIp = (h: (name: string) => string | undefined): string =>
  h("CF-Connecting-IP") ?? h("X-Forwarded-For")?.split(",")[0]?.trim() ?? "local";
