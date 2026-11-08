import { AccessControl, NativeBiometric } from "@capgo/capacitor-native-biometric";
import { API } from "@marqum/schema";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ApiError, api } from "./api.ts";
import { isNative } from "./platform.ts";
import { askSecret } from "./prompts.ts";
import type { StepUpResponseT as StepUpResponse } from "./wire.ts";

const BIOMETRIC_SERVER = "marqum-step-up";
let current: { token: string; expires: number } | null = null;

/** A step-up token that is still valid for at least 20 seconds, if any. */
export function validStepUp(): string | null {
  if (current && current.expires - Date.now() > 20_000) return current.token;
  return null;
}

function remember(res: StepUpResponse): string {
  const parsed = Date.parse(res.expires_at);
  current = { token: res.step_up_token, expires: Number.isNaN(parsed) ? Date.now() + 4 * 60_000 : parsed };
  return res.step_up_token;
}

/** Proves it's you for a closed-month edit. Resolves to a step-up token, or null if cancelled. */
export async function stepUp(reason: string): Promise<string | null> {
  const valid = validStepUp();
  if (valid) return valid;
  if (isNative()) return nativeStepUp(reason);
  return webStepUp(reason);
}

async function nativeStepUp(reason: string): Promise<string | null> {
  let available = false;
  try {
    available = (await NativeBiometric.isAvailable()).isAvailable;
  } catch {
    available = false;
  }
  if (available) {
    let secret: string | null = null;
    try {
      const saved = await NativeBiometric.isCredentialsSaved({ server: BIOMETRIC_SERVER });
      if (saved.isSaved) {
        const creds = await NativeBiometric.getSecureCredentials({
          server: BIOMETRIC_SERVER,
          title: "Confirm it's you",
          subtitle: reason,
        });
        secret = creds.password;
      }
    } catch {
      return null; // cancelled the fingerprint prompt
    }
    if (secret) {
      try {
        return remember(await api<StepUpResponse>(API.stepUpBiometric, { body: { secret } }));
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 403) throw e;
        await NativeBiometric.deleteCredentials({ server: BIOMETRIC_SERVER }).catch(() => undefined);
      }
    }
  }
  const token = await passcodeStepUp(reason);
  if (token && available)
    await enrolBiometric(token).catch((e) => console.warn("biometric enrolment failed", e));
  return token;
}

/** Stores a server-issued secret behind the fingerprint so the next step-up is one touch. */
export async function enrolBiometric(stepUpToken?: string): Promise<boolean> {
  const token = stepUpToken ?? (await stepUp("Set up fingerprint confirmation"));
  if (!token) return false;
  const { secret } = await api<{ secret: string }>(API.stepUpBiometricEnroll, {
    body: {},
    headers: { "x-step-up": token },
  });
  await NativeBiometric.setCredentials({
    username: "marqum",
    password: secret,
    server: BIOMETRIC_SERVER,
    accessControl: AccessControl.BIOMETRY_CURRENT_SET,
  });
  return true;
}

export async function biometricEnrolled(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await NativeBiometric.isCredentialsSaved({ server: BIOMETRIC_SERVER })).isSaved;
  } catch {
    return false;
  }
}

async function webStepUp(reason: string): Promise<string | null> {
  if (typeof window !== "undefined" && window.PublicKeyCredential) {
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        API.stepUpPasskeyOptions,
        { body: { mode: "authenticate" } },
      );
      const response = await startAuthentication({ optionsJSON });
      return remember(
        await api<StepUpResponse>(API.stepUpPasskeyVerify, { body: { mode: "authenticate", response } }),
      );
    } catch (e) {
      console.warn("passkey step-up unavailable, falling back to passcode", e);
    }
  }
  return passcodeStepUp(reason);
}

export async function registerPasskey(): Promise<boolean> {
  const token = await stepUp("Add a passkey for closed-month edits");
  if (!token) return false;
  const headers = { "x-step-up": token };
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
    API.stepUpPasskeyOptions,
    {
      body: { mode: "register" },
      headers,
    },
  );
  const response = await startRegistration({ optionsJSON });
  await api(API.stepUpPasskeyVerify, { body: { mode: "register", response }, headers });
  return true;
}

async function passcodeStepUp(reason: string): Promise<string | null> {
  let error: string | undefined;
  for (;;) {
    const passcode = await askSecret({
      kind: "passcode",
      title: "Confirm it's you",
      detail: reason,
      confirm: "Confirm",
      ...(error ? { error } : {}),
    });
    if (!passcode) return null;
    try {
      return remember(await api<StepUpResponse>(API.stepUpPasscode, { body: { passcode } }));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        error = "That passcode didn't match.";
        continue;
      }
      throw e;
    }
  }
}
