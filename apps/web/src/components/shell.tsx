import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowLeftRight, CalendarCheck, House, Settings, Target } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useStore } from "../lib/store.ts";
import { availableUpdate } from "../lib/updates.ts";
import { SyncDot } from "./sync-dot.tsx";

const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/activity", label: "Activity", icon: ArrowLeftRight },
  { to: "/plan", label: "Plan", icon: Target },
  { to: "/close", label: "Close", icon: CalendarCheck },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-lg font-medium", className)}>
      <img src="/icon.svg" alt="" className="size-7 rounded-inner" />
      Marqūm
    </span>
  );
}

/** Frame for every signed-in screen: top bar (safe-area aware), content column, tab bar / sidebar. */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-border border-r px-4 py-6 lg:flex">
        <Wordmark className="px-2" />
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex h-10 items-center gap-3 rounded-control px-3 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:text-accent-text"
            >
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-border border-t bg-surface pb-safe lg:hidden"
      >
        <div className="mx-auto grid h-[var(--tabbar-h)] max-w-[var(--content-max)] grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex flex-col items-center justify-center gap-1 text-xs text-fg-muted data-[status=active]:text-accent-text"
            >
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** One screen: top bar + centred column. Root tabs show the wordmark, detail screens a back button. */
export function Screen({
  title,
  back,
  actions,
  children,
  wide,
}: {
  title?: string;
  back?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const router = useRouter();
  const update = useStore(availableUpdate);
  return (
    <>
      <header className="sticky top-0 z-20 bg-bg/95 pt-safe backdrop-blur">
        <div
          className={cn(
            "mx-auto flex h-[var(--topbar-h)] items-center gap-2 px-safe",
            wide ? "max-w-5xl" : "max-w-[var(--content-max)]",
          )}
        >
          {back ? (
            <button
              type="button"
              onClick={() => router.history.back()}
              aria-label="Back"
              className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-surface-2"
            >
              <ArrowLeft aria-hidden />
            </button>
          ) : (
            <Wordmark className="lg:hidden" />
          )}
          {title ? <span className="min-w-0 truncate font-medium">{title}</span> : null}
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <SyncDot />
          </div>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto flex flex-col gap-8 px-safe pt-2 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+var(--spacing)*8)] lg:pb-12",
          wide ? "max-w-5xl" : "max-w-[var(--content-max)]",
        )}
      >
        {update ? (
          <p className="rounded-control bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            Marqūm {update} is available — update in Obtainium
          </p>
        ) : null}
        {children}
      </main>
    </>
  );
}

/** A group of related content: tight inside (8), headline above. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title || aside ? (
        <div className="flex items-baseline justify-between gap-4">
          {title ? <h2 className="font-medium text-balance">{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Headline({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-headline font-medium text-balance">{children}</h1>
      {sub ? <p className="text-fg-muted">{sub}</p> : null}
    </div>
  );
}
