import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowLeftRight, House, Settings, Target } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useStore } from "../lib/store.ts";
import { availableUpdate } from "../lib/updates.ts";
import { SyncDot } from "./sync-dot.tsx";
import { Button } from "./ui/button.tsx";

const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/activity", label: "Activity", icon: ArrowLeftRight },
  { to: "/plan", label: "Plan", icon: Target },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-lg font-medium", className)}>
      <svg viewBox="0 0 24 24" className="size-7 rounded-inner bg-accent text-accent-fg" aria-hidden>
        <title>Marqūm</title>
        <g transform="translate(12 12) scale(0.62) translate(-12 -12)">
          <path
            fill="currentColor"
            fillRule="evenodd"
            transform="translate(0.5 1)"
            d="M10 6h9v15H4v-9h3v6h9v-3h-6zM13 9v3h3V9zM10 1h3v3h-3zM16 1h3v3h-3z"
          />
        </g>
      </svg>
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
              className="flex h-10 items-center gap-3 rounded-control px-3 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:font-semibold data-[status=active]:text-accent-text"
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
        <div className="mx-auto grid h-[var(--tabbar-h)] max-w-[var(--content-max)] grid-cols-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="group flex flex-col items-center justify-center gap-1 text-xs text-fg-subtle data-[status=active]:font-semibold data-[status=active]:text-accent-text"
            >
              <span className="grid h-7 w-14 place-items-center rounded-full transition-colors group-data-[status=active]:bg-accent-soft">
                <Icon aria-hidden />
              </span>
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
            <Button size="icon" variant="ghost" label="Back" onClick={() => router.history.back()}>
              <ArrowLeft aria-hidden />
            </Button>
          ) : (
            <Wordmark className="lg:hidden" />
          )}
          {title ? (
            <Text type="large" weight="semibold" maxLines={1}>
              {title}
            </Text>
          ) : null}
          <HStack gap={1} vAlign="center" className="ml-auto">
            {actions}
            <SyncDot />
          </HStack>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto flex flex-col gap-8 px-safe pt-2 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2rem)] lg:pb-12",
          wide ? "max-w-5xl" : "max-w-[var(--content-max)]",
        )}
      >
        {update ? (
          <Banner status="info" title={`Marqūm ${update} is out`} description="Update in Obtainium" />
        ) : null}
        {children}
      </main>
    </>
  );
}

/** A group of related content: heading (and an action) above, tight inside. */
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
    <VStack as="section" gap={3} {...(className ? { className } : {})}>
      {title || aside ? (
        <HStack justify="between" vAlign="center" gap={4}>
          {title ? (
            <Heading level={2} textWrap="balance">
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {aside}
        </HStack>
      ) : null}
      {children}
    </VStack>
  );
}

export function Headline({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <VStack gap={1}>
      <Heading level={1} textWrap="balance">
        {children}
      </Heading>
      {sub ? <Text color="secondary">{sub}</Text> : null}
    </VStack>
  );
}
