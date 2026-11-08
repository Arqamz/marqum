import { MarqumNative } from "../native/marqum-native.ts";
import { isNative } from "./platform.ts";
import { createStore } from "./store.ts";

export const availableUpdate = createStore<string | null>(null);
const KEY = "marqum.updateCheck";
const RELEASES = "https://api.github.com/repos/Arqamz/marqum/releases/latest";

/** Semver-ish compare of "v0.2.0" / "0.1.10". */
export function newer(tag: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(tag);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** At most daily on Android: is there a newer GitHub release than the installed APK? */
export async function checkForUpdate(): Promise<void> {
  if (!isNative()) return;
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) ?? "null") as { at: number; tag: string } | null;
    let tag = cached?.tag ?? null;
    if (!cached || Date.now() - cached.at > 24 * 3600_000) {
      const res = await fetch(RELEASES, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      tag = ((await res.json()) as { tag_name?: string }).tag_name ?? null;
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), tag }));
    }
    if (!tag) return;
    const { versionName } = await MarqumNative.getAppInfo();
    if (newer(tag, versionName)) availableUpdate.set(tag.replace(/^v/, ""));
  } catch {
    /* offline or rate-limited — try again tomorrow */
  }
}
