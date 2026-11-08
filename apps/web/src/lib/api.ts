import { auth } from "./auth.ts";
import { apiBase } from "./platform.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Network failure (offline, DNS, CORS) — distinct from an HTTP error. */
export class OfflineError extends Error {}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = auth.token();
  const headers: Record<string, string> = { ...init.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (e) {
    throw new OfflineError(e instanceof Error ? e.message : "offline");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/step-up")) {
    auth.expire();
    throw new ApiError(401, "This device was signed out. Sign in again with your passcode.");
  }
  if (!res.ok) {
    let message = `The server answered ${res.status}.`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
