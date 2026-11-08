import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform.ts";

/** Small key/value store: Capacitor Preferences on Android (survives WebView data clears), localStorage on the web. */
export const kv = {
  async get(key: string): Promise<string | null> {
    if (isNative()) return (await Preferences.get({ key })).value;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (isNative()) return Preferences.set({ key, value });
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode) — the session still works in memory */
    }
  },
  async remove(key: string): Promise<void> {
    if (isNative()) return Preferences.remove({ key });
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
