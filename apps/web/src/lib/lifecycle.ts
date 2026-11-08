import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { MarqumNative } from "../native/marqum-native.ts";
import { loadDataset } from "./dataset.ts";
import { drainShares, ingestShared, scanInbox } from "./intake.ts";
import { isNative } from "./platform.ts";
import { rescheduleReminders } from "./reminders.ts";
import { onSynced, syncNow } from "./sync.ts";
import { checkForUpdate } from "./updates.ts";

let started = false;

/** Wires every background trigger once the user is signed in. */
export function startBackground(): () => void {
  if (started) return () => undefined;
  started = true;
  const cleanups: (() => void)[] = [];

  const onOpen = () => {
    void syncNow();
    void scanInbox();
    void drainShares();
    void checkForUpdate();
    if (isNative()) void MarqumNative.flushIngestQueue().catch(() => undefined);
  };
  onOpen();

  const online = () => void syncNow();
  window.addEventListener("online", online);
  cleanups.push(() => window.removeEventListener("online", online));

  const visible = () => {
    if (document.visibilityState === "visible" && !isNative()) void syncNow();
  };
  document.addEventListener("visibilitychange", visible);
  cleanups.push(() => document.removeEventListener("visibilitychange", visible));

  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, 60_000);
  cleanups.push(() => clearInterval(timer));

  if (isNative()) {
    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) onOpen();
    }).then((h) => cleanups.push(() => void h.remove()));
    void Network.addListener("networkStatusChange", ({ connected }) => {
      if (connected) void syncNow();
    }).then((h) => cleanups.push(() => void h.remove()));
    void MarqumNative.addListener("shareReceived", ({ files }) => void ingestShared(files)).then((h) =>
      cleanups.push(() => void h.remove()),
    );
  }

  cleanups.push(
    onSynced(() => {
      void loadDataset().then(({ dataset }) => rescheduleReminders(dataset));
    }),
  );

  return () => {
    for (const c of cleanups) c();
    started = false;
  };
}
