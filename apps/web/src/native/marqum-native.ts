import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";
import type { NotificationIngest } from "@marqum/schema";

/**
 * CONTRACT between the web UI and the Android shell (apps/android, Kotlin plugin "MarqumNative").
 * Implemented natively on Android; on the web every method rejects with "unimplemented"
 * (callers must check `Capacitor.isNativePlatform()` first).
 */

export interface StatementFileInfo {
  /** absolute path on device storage */
  path: string;
  name: string; // e.g. "m-11-2026.pdf", "sadapay_account_statement_01-11-2026_07-11-2026.pdf"
  size: number;
  modified: number; // epoch ms
}

export interface SharedFile {
  name: string;
  mime: string; // "application/pdf" | "text/csv" | "text/comma-separated-values" | ...
  base64: string;
}

export interface MarqumNativePlugin {
  // ── Statement inbox ────────────────────────────────────────────────────────────────
  /** Android 11+: MANAGE_EXTERNAL_STORAGE ("All files access") status. */
  checkFileAccess(): Promise<{ granted: boolean }>;
  /** Opens the system "All files access" screen for this app; resolves when the user returns. */
  requestFileAccess(): Promise<{ granted: boolean }>;
  /**
   * Lists statement files modified after `since` (epoch ms) in:
   *   /storage/emulated/0/Android/media/com.nayapay.app/NayaPay/Other/  (m-MM-YYYY.pdf|csv)
   *   /storage/emulated/0/Download/  (m-MM-YYYY.*, sadapay_account_statement_*.pdf)
   */
  scanStatements(options: { since: number }): Promise<{ files: StatementFileInfo[] }>;
  readFile(options: { path: string }): Promise<{ base64: string }>;

  // ── Share target (ACTION_SEND / ACTION_SEND_MULTIPLE / ACTION_VIEW for pdf & csv) ──
  /** Returns and clears files shared into the app (including the one that launched it). */
  getPendingShares(): Promise<{ files: SharedFile[] }>;
  addListener(
    event: "shareReceived",
    listener: (data: { files: SharedFile[] }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "notificationCaptured",
    listener: (data: NotificationIngest & { sent: boolean }) => void,
  ): Promise<PluginListenerHandle>;

  // ── Notification capture (NotificationListenerService, only com.nayapay.app & com.sadapay.app) ──
  checkNotificationAccess(): Promise<{ granted: boolean }>;
  /** Opens Settings › Notification access for this app. */
  requestNotificationAccess(): Promise<void>;
  /**
   * The native service POSTs every captured bank notification to `${apiBase}/api/ingest/notification`
   * with `Authorization: Bearer ${token}` — even when the app is closed — and queues while offline.
   */
  configureIngest(options: { apiBase: string; token: string }): Promise<void>;
  /** Retry queued notifications now. */
  flushIngestQueue(): Promise<{ sent: number; pending: number }>;
  /** Last captured notifications (local log, newest first) — for the "what the app heard" screen. */
  getCapturedNotifications(options: {
    limit: number;
  }): Promise<{ items: (NotificationIngest & { sent: boolean })[] }>;

  // ── App info ───────────────────────────────────────────────────────────────────────
  getAppInfo(): Promise<{ versionName: string; versionCode: number }>;
}

export const MarqumNative = registerPlugin<MarqumNativePlugin>("MarqumNative");
