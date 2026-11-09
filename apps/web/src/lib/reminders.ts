import { LocalNotifications } from "@capacitor/local-notifications";
import {
  addMonths,
  type Dataset,
  isClosed,
  karachiNow,
  monthOf,
  monthsToClose,
  numericSetting,
} from "@marqum/core";
import { missingStatements, monthName, untaggedIn } from "./months.ts";
import { isNative } from "./platform.ts";
import { isTracked } from "./tracking.ts";

const BASE_ID = 7100;
const MAX = 20;

/** Which month the close reminders are about right now, if any (from the reminder day through the 7th). */
export function reminderMonth(ds: Dataset, now: string): string | null {
  const day = Number(now.slice(8, 10));
  const from = numericSetting(ds, "close_reminder_day") || 25;
  const month = monthOf(now);
  if (day >= from && isTracked(ds, month) && !isClosed(ds, month)) return month;
  // Past months: only ended, unclosed, tracked ones (core's monthsToClose).
  const prev = addMonths(month, -1);
  if (day <= 7 && monthsToClose(ds, now).includes(prev)) return prev;
  return null;
}

/** "Close November: 2 statements missing, 4 to tag" */
export function reminderText(ds: Dataset, month: string): string {
  const parts: string[] = [];
  const missing = missingStatements(ds, month).length;
  const untagged = untaggedIn(ds, month).length;
  if (missing > 0) parts.push(`${missing} statement${missing === 1 ? "" : "s"} missing`);
  if (untagged > 0) parts.push(`${untagged} to tag`);
  return parts.length > 0
    ? `Close ${monthName(month)}: ${parts.join(", ")}`
    : `Close ${monthName(month)}: ready to seal`;
}

/** Daily 21:00 reminders from the reminder day through the 7th, while the month is still open. */
export async function rescheduleReminders(ds: Dataset, now = karachiNow()): Promise<void> {
  if (!isNative()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return;
    await LocalNotifications.cancel({
      notifications: Array.from({ length: MAX }, (_, i) => ({ id: BASE_ID + i })),
    });
    const month = reminderMonth(ds, now);
    if (!month) return;
    const body = reminderText(ds, month);
    const nextMonth = addMonths(month, 1);
    const last = new Date(Number(nextMonth.slice(0, 4)), Number(nextMonth.slice(5, 7)) - 1, 7, 21, 0);
    const at = new Date();
    at.setHours(21, 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    const notifications = [];
    for (let i = 0; i < MAX && at <= last; i++) {
      notifications.push({ id: BASE_ID + i, title: "Marqūm", body, schedule: { at: new Date(at) } });
      at.setDate(at.getDate() + 1);
    }
    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.warn("reminder scheduling failed", e);
  }
}
