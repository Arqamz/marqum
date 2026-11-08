import { LoginRequest } from "@marqum/schema";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type Context, Hono } from "hono";
import { ulid } from "ulidx";
import { z } from "zod";
import type { AppEnv } from "../env.ts";
import { clientIp, mintStepUp, requireDevice, requirePasscode } from "../lib/auth.ts";
import {
  fromBase64Url,
  hashPasscode,
  randomToken,
  safeEqual,
  toBase64Url,
  tokenHash,
} from "../lib/crypto.ts";
import { body, fail, isoNow } from "../lib/http.ts";

/** Public: POST /api/auth/login */
export const login = new Hono<AppEnv>().post("/", async (c) => {
  const req = await body(c, LoginRequest);
  await requirePasscode(
    c.env,
    clientIp((n) => c.req.header(n)),
    req.passcode,
  );
  const token = randomToken();
  const device_id = ulid();
  await c.env.DB.prepare(
    "INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(device_id, req.device_name, await tokenHash(token, c.env.TOKEN_PEPPER), isoNow(), isoNow())
    .run();
  return c.json({ token, device_id });
});

const Passcode = z.object({ passcode: z.string().min(4) });
const OptionalPasscode = z.object({ passcode: z.string().min(4).optional() }).optional();

export const auth = new Hono<AppEnv>();
auth.use("*", requireDevice);

auth.get("/me", (c) => {
  const d = c.get("device");
  return c.json({ device_id: d.id, device_name: d.name });
});

auth.get("/devices", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, created_at, last_seen, revoked_at, biometric_secret_hash IS NOT NULL AS biometric FROM devices ORDER BY created_at",
  ).all<{
    id: string;
    name: string;
    created_at: string;
    last_seen: string | null;
    revoked_at: string | null;
    biometric: number;
  }>();
  const me = c.get("device").id;
  return c.json(results.map((d) => ({ ...d, biometric: d.biometric === 1, current: d.id === me })));
});

auth.delete("/devices/:id", async (c) => {
  const res = await c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(isoNow(), c.req.param("id"))
    .run();
  if (!res.meta.changes) fail(404, "not_found", "No such active device.");
  await c.env.DB.prepare("DELETE FROM step_up WHERE device_id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/** Change passcode — needs a step-up token and the current passcode. */
auth.post("/passcode", async (c) => {
  const req = await body(c, z.object({ current: z.string().min(4), next: z.string().min(6).max(128) }));
  if (!c.get("steppedUp")) fail(403, "step_up_required", "Confirm it's you first.");
  await requirePasscode(
    c.env,
    clientIp((n) => c.req.header(n)),
    req.current,
  );
  await c.env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('passcode_hash', ?)")
    .bind(await hashPasscode(req.next, c.env.TOKEN_PEPPER))
    .run();
  return c.json({ ok: true });
});

/**
 * Enrolling a new step-up factor (fingerprint secret, passkey) must itself be authorised: either a valid
 * X-Step-Up header or the passcode in the body. Otherwise a stolen bearer token could mint its own step-up.
 */
async function requireEnrolAuth(c: Context<AppEnv>, passcode: string | undefined) {
  if (c.get("steppedUp")) return;
  if (!passcode) fail(403, "step_up_required", "Enter your passcode to set this up.");
  else
    await requirePasscode(
      c.env,
      clientIp((n) => c.req.header(n)),
      passcode,
    );
}

// ---- step-up: passcode (fallback)
auth.post("/step-up/passcode", async (c) => {
  const req = await body(c, Passcode);
  await requirePasscode(
    c.env,
    clientIp((n) => c.req.header(n)),
    req.passcode,
  );
  return c.json(await mintStepUp(c.env, c.get("device").id));
});

// ---- step-up: biometric (Android keystore holds the secret behind the fingerprint)
auth.post("/step-up/biometric/enroll", async (c) => {
  const req = await optionalBody(c, OptionalPasscode);
  await requireEnrolAuth(c, req?.passcode);
  const secret = randomToken();
  await c.env.DB.prepare("UPDATE devices SET biometric_secret_hash = ? WHERE id = ?")
    .bind(await tokenHash(secret, c.env.TOKEN_PEPPER), c.get("device").id)
    .run();
  return c.json({ secret });
});

auth.post("/step-up/biometric", async (c) => {
  const req = await body(c, z.object({ secret: z.string().min(16) }));
  const row = await c.env.DB.prepare("SELECT biometric_secret_hash AS h FROM devices WHERE id = ?")
    .bind(c.get("device").id)
    .first<{ h: string | null }>();
  if (!row?.h) fail(400, "not_enrolled", "Fingerprint isn't set up on this device.");
  if (!(await safeEqual(await tokenHash(req.secret, c.env.TOKEN_PEPPER), row?.h ?? "")))
    fail(401, "invalid_secret", "Fingerprint check failed.");
  return c.json(await mintStepUp(c.env, c.get("device").id));
});

// ---- step-up: passkey (web)
const CHALLENGE_TTL_MS = 5 * 60_000;
const challengeKey = (deviceId: string) => `webauthn:${deviceId}`;
const rp = (url: string) => {
  const u = new URL(url);
  return { rpID: u.hostname, origin: u.origin };
};

auth.post("/step-up/passkey/options", async (c) => {
  const req = await body(
    c,
    z.object({ mode: z.enum(["register", "authenticate"]), passcode: z.string().min(4).optional() }),
  );
  const { rpID } = rp(c.req.url);
  const { results: keys } = await c.env.DB.prepare("SELECT id, transports FROM passkeys").all<{
    id: string;
    transports: string | null;
  }>();
  const creds = keys.map((k) => ({
    id: k.id,
    transports: k.transports ? (JSON.parse(k.transports) as string[]) : [],
  }));
  let options: { challenge: string };
  if (req.mode === "register") {
    await requireEnrolAuth(c, req.passcode);
    options = await generateRegistrationOptions({
      rpName: "Marqūm",
      rpID,
      userName: "owner",
      userDisplayName: "Marqūm",
      userID: Uint8Array.from(new TextEncoder().encode("marqum-owner")),
      attestationType: "none",
      excludeCredentials: creds,
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
  } else {
    if (creds.length === 0) fail(400, "not_enrolled", "No passkey is registered yet.");
    options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds,
      userVerification: "required",
    });
  }
  await c.env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .bind(
      challengeKey(c.get("device").id),
      JSON.stringify({
        challenge: options.challenge,
        mode: req.mode,
        expires: Date.now() + CHALLENGE_TTL_MS,
      }),
    )
    .run();
  return c.json(options);
});

auth.post("/step-up/passkey/verify", async (c) => {
  const req = await body(
    c,
    z.object({ mode: z.enum(["register", "authenticate"]), response: z.record(z.string(), z.unknown()) }),
  );
  const deviceId = c.get("device").id;
  const stored = await c.env.DB.prepare("SELECT value FROM meta WHERE key = ?")
    .bind(challengeKey(deviceId))
    .first<{ value: string }>();
  await c.env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(challengeKey(deviceId)).run();
  const ch = stored
    ? (JSON.parse(stored.value) as { challenge: string; mode: string; expires: number })
    : null;
  if (!ch || ch.mode !== req.mode || ch.expires < Date.now())
    return fail(400, "invalid", "Passkey request expired. Try again.");
  const { rpID, origin } = rp(c.req.url);
  const expectedOrigin = origin;

  if (req.mode === "register") {
    const v = await verifyRegistrationResponse({
      response: req.response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
    }).catch((e: unknown) => fail(400, "invalid", `Passkey not accepted: ${(e as Error).message}`));
    if (!v.verified) return fail(401, "invalid", "Passkey not accepted.");
    const cred = v.registrationInfo.credential;
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO passkeys (id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        cred.id,
        toBase64Url(cred.publicKey),
        cred.counter,
        JSON.stringify(cred.transports ?? []),
        isoNow(),
      )
      .run();
    return c.json(await mintStepUp(c.env, deviceId));
  }

  const response = req.response as unknown as AuthenticationResponseJSON;
  const key = await c.env.DB.prepare("SELECT id, public_key, counter, transports FROM passkeys WHERE id = ?")
    .bind(response.id)
    .first<{ id: string; public_key: string; counter: number; transports: string | null }>();
  if (!key) return fail(401, "invalid", "Unknown passkey.");
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: key.id,
      publicKey: fromBase64Url(key.public_key),
      counter: key.counter,
      transports: key.transports ? (JSON.parse(key.transports) as string[]) : [],
    },
    requireUserVerification: true,
  }).catch((e: unknown) => fail(400, "invalid", `Passkey not accepted: ${(e as Error).message}`));
  if (!v.verified) return fail(401, "invalid", "Passkey not accepted.");
  await c.env.DB.prepare("UPDATE passkeys SET counter = ? WHERE id = ?")
    .bind(v.authenticationInfo.newCounter, key.id)
    .run();
  return c.json(await mintStepUp(c.env, deviceId));
});

/** Body is optional (empty POST allowed). */
async function optionalBody<S extends z.ZodType>(
  c: { req: { text(): Promise<string> } },
  schema: S,
): Promise<z.infer<S> | undefined> {
  const text = await c.req.text();
  if (!text.trim()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, "invalid", "Body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid body.");
  return parsed.data;
}
