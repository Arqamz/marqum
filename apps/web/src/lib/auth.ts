import { API } from "@marqum/schema";
import { useSyncExternalStore } from "react";
import { MarqumNative } from "../native/marqum-native.ts";
import { apiBase, isNative } from "./platform.ts";
import { kv } from "./storage.ts";
import type { LoginResponseT } from "./wire.ts";

const TOKEN_KEY = "marqum.token";
const DEVICE_KEY = "marqum.device";

export interface Session {
  token: string;
  device_id: string;
}

type AuthState = { status: "loading" } | { status: "anonymous" } | { status: "signed-in"; session: Session };

let state: AuthState = { status: "loading" };
const listeners = new Set<() => void>();
const set = (next: AuthState) => {
  state = next;
  for (const l of listeners) l();
};

export const auth = {
  get: () => state,
  token: () => (state.status === "signed-in" ? state.session.token : null),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async restore(): Promise<void> {
    const token = await kv.get(TOKEN_KEY);
    const device_id = (await kv.get(DEVICE_KEY)) ?? "";
    set(token ? { status: "signed-in", session: { token, device_id } } : { status: "anonymous" });
    if (token) void configureNativeIngest(token);
  },
  async login(passcode: string, device_name: string): Promise<void> {
    const res = await fetch(`${apiBase()}${API.login}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode, device_name }),
    });
    if (res.status === 401 || res.status === 403) throw new Error("That passcode didn't match. Try again.");
    if (!res.ok) throw new Error(`The server answered ${res.status}. Check your connection and try again.`);
    const body = (await res.json()) as LoginResponseT;
    await kv.set(TOKEN_KEY, body.token);
    await kv.set(DEVICE_KEY, body.device_id);
    set({ status: "signed-in", session: { token: body.token, device_id: body.device_id } });
    await configureNativeIngest(body.token);
  },
  async logout(): Promise<void> {
    await kv.remove(TOKEN_KEY);
    await kv.remove(DEVICE_KEY);
    set({ status: "anonymous" });
  },
  /** Server rejected the token (revoked device). */
  expire(): void {
    void kv.remove(TOKEN_KEY);
    set({ status: "anonymous" });
  },
};

async function configureNativeIngest(token: string): Promise<void> {
  if (!isNative()) return;
  try {
    await MarqumNative.configureIngest({ apiBase: apiBase(), token });
  } catch (e) {
    console.warn("configureIngest failed", e);
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.get, auth.get);
}
