import { Capacitor } from "@capacitor/core";

export const DEFAULT_NATIVE_API = "https://marqum.arqam-mzia.workers.dev";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** "" (same origin) on the web; the Worker's URL inside the APK. */
export function apiBase(): string {
  if (!isNative()) return "";
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? DEFAULT_NATIVE_API;
}

export function defaultDeviceName(): string {
  if (isNative()) return "Android phone";
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
