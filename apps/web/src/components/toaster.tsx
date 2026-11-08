import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useStore } from "../lib/store.ts";
import { dismissToast, toasts } from "../lib/toast.ts";

const ICON = { neutral: Info, error: CircleAlert, warn: TriangleAlert, success: CircleCheck } as const;
const TONE = { neutral: "text-fg-muted", error: "text-neg", warn: "text-warn", success: "text-pos" } as const;

/** Inline messages above the tab bar: what happened and what to do. */
export function Toaster() {
  const list = useStore(toasts);
  const reduce = useReducedMotion();
  return (
    <section
      aria-live="polite"
      aria-label="Notifications"
      data-toaster
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+var(--spacing)*3)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      <AnimatePresence initial={false}>
        {list.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card bg-surface p-4 shadow-float"
              role={t.tone === "error" ? "alert" : "status"}
            >
              <Icon className={cn("mt-px shrink-0", TONE[t.tone])} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-medium">{t.title}</p>
                {t.detail ? <p className="text-sm text-fg-muted">{t.detail}</p> : null}
                {t.action ? (
                  <button
                    type="button"
                    className="self-start text-sm font-medium text-accent-text"
                    onClick={() => {
                      t.action?.run();
                      dismissToast(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="-m-2 grid size-10 shrink-0 place-items-center rounded-full text-fg-muted"
                onClick={() => dismissToast(t.id)}
              >
                <X aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}
