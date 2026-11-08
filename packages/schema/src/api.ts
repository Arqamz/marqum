import { z } from "zod";
import { Command } from "./commands.ts";
import { LocalDateTime, TABLE_NAMES, type TableName } from "./entities.ts";

/**
 * HTTP API (Cloudflare Worker), all under /api. JSON in/out.
 * Auth: `Authorization: Bearer <device token>` (both web and Android). Web also accepts the same token
 * from localStorage — no cookies, so the APK (capacitor://localhost / https://localhost origin) and web behave the same.
 * Step-up: `X-Step-Up: <token>` header, minted by /auth/step-up/* and valid for 5 minutes.
 */
export const API = {
  login: "/api/auth/login", // POST LoginRequest → LoginResponse (public)
  me: "/api/auth/me", // GET → { device_id, device_name }
  devices: "/api/auth/devices", // GET → Device[]; DELETE /api/auth/devices/:id revokes
  passcode: "/api/auth/passcode", // POST { current, next } (needs step-up)
  stepUpBiometricEnroll: "/api/auth/step-up/biometric/enroll", // POST → { secret } (store behind fingerprint)
  stepUpBiometric: "/api/auth/step-up/biometric", // POST { secret } → StepUpResponse
  stepUpPasskeyOptions: "/api/auth/step-up/passkey/options", // POST { mode: "register"|"authenticate" } → WebAuthn options
  stepUpPasskeyVerify: "/api/auth/step-up/passkey/verify", // POST { mode, response } → StepUpResponse
  stepUpPasscode: "/api/auth/step-up/passcode", // POST { passcode } → StepUpResponse (fallback)
  push: "/api/sync/push", // POST PushRequest → PushResponse
  pull: "/api/sync/pull", // GET ?since=<version> → PullResponse
  ingestNotification: "/api/ingest/notification", // POST NotificationIngest → { id, status, transaction_id }
  closeCheck: "/api/months/:month/check", // GET → CloseChecklist (server's authoritative checklist)
  snapshot: "/api/months/:month/snapshot", // GET → the sealed snapshot JSON (from R2)
  exportAll: "/api/export", // GET → full JSON dump of all tables
  health: "/api/health", // GET (public) → { ok, version }
} as const;

export const LoginRequest = z.object({ passcode: z.string().min(4), device_name: z.string().min(1).max(60) });
export const LoginResponse = z.object({ token: z.string(), device_id: z.string() });
export const StepUpResponse = z.object({ step_up_token: z.string(), expires_at: z.string() });

export const PushRequest = z.object({ commands: z.array(Command).max(200) });
export const CommandResult = z.object({
  id: z.string(),
  ok: z.boolean(),
  /** machine-readable: "closed_month" | "step_up_required" | "invalid" | "not_found" | "conflict" | ... */
  error: z.string().optional(),
  message: z.string().optional(),
  /** command-specific summary, e.g. importStatement → { added, updated, unchanged, removed, matched, disputed } */
  result: z.record(z.string(), z.unknown()).optional(),
});
export const PushResponse = z.object({ results: z.array(CommandResult), version: z.number().int() });

export const PullResponse = z.object({
  version: z.number().int(),
  /** rows changed since `since`, per table, including tombstones (`deleted: true`) */
  changes: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** true if more pages remain; client should pull again with `since=version` */
  more: z.boolean(),
});

/** Raw notification posted by the Android NotificationListenerService (only NayaPay/SadaPay packages). */
export const NotificationIngest = z.object({
  /** stable id from the device: sha256(package|postTime|title|text) */
  id: z.string(),
  package: z.string(),
  title: z.string(),
  text: z.string(),
  posted_at: LocalDateTime,
});
export type NotificationIngest = z.infer<typeof NotificationIngest>;

export const BANK_PACKAGES = { "com.nayapay.app": "nayapay", "com.sadapay.app": "sadapay" } as const;

export type PullChanges = Partial<Record<TableName, unknown[]>>;
export { TABLE_NAMES };
