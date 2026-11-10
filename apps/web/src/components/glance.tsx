import type { WalletPosition } from "@marqum/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { WalletLogo } from "./brand-logo.tsx";
import { HeroAmount, TweenMoney } from "./money.tsx";

/** Shown once per launch, and again when the app comes back after a while in the background. */
let seenThisLaunch = false;
const AWAY_MS = 30_000;

/** Whether Home should open on the glance; flips back on after the app has been away for a while. */
export function useGlance(): [boolean, () => void] {
  const [on, setOn] = useState(() => !seenThisLaunch);
  useEffect(() => {
    seenThisLaunch = true;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) setOn(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return [on, useCallback(() => setOn(false), [])];
}

const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";

/**
 * The first thing Home shows: black, nothing but the net position and the two wallet balances in huge type. Any tap,
 * click, scroll or key and each number glides (shrinking) into its place on Home while the black fades away.
 * Home marks the destinations with `data-glance-target="net" | "<wallet id>"`.
 */
export function Glance({
  net,
  wallets,
  alarm,
  onDone,
}: {
  net: number | null;
  wallets: WalletPosition[];
  alarm: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLSpanElement>(null);
  const [leaving, setLeaving] = useState(false);
  const ready = net !== null;

  const leave = useCallback(() => {
    const el = root.current;
    if (!el || leaving || !ready) return;
    setLeaving(true);
    window.scrollTo(0, 0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 160 : 1000;
    const hidden: HTMLElement[] = [];
    const anims: Animation[] = [];
    if (reduce) {
      anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: "forwards" }));
    } else {
      for (const src of el.querySelectorAll<HTMLElement>("[data-glance]")) {
        const dst = document.querySelector<HTMLElement>(`[data-glance-target="${src.dataset.glance}"]`);
        if (!dst) {
          anims.push(
            src.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration / 2, fill: "forwards" }),
          );
          continue;
        }
        const a = src.getBoundingClientRect();
        const b = dst.getBoundingClientRect();
        const s = b.width / a.width;
        const dx = b.left - a.left;
        const dy = b.top + b.height / 2 - (a.top + (a.height * s) / 2);
        const inner = src.firstElementChild as HTMLElement | null;
        const color = getComputedStyle((dst.firstElementChild as HTMLElement | null) ?? dst).color;
        dst.style.opacity = "0";
        hidden.push(dst);
        anims.push(
          src.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], {
            duration,
            easing: EASE,
            fill: "forwards",
          }),
        );
        if (inner) anims.push(inner.animate([{}, { color }], { duration, easing: EASE, fill: "forwards" }));
      }
      for (const f of el.querySelectorAll<HTMLElement>("[data-glance-fade]"))
        anims.push(
          f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.35, fill: "forwards" }),
        );
      if (backdrop.current)
        anims.push(
          backdrop.current.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration,
            easing: EASE,
            fill: "forwards",
          }),
        );
    }
    void Promise.all(anims.map((x) => x.finished))
      .catch(() => undefined)
      .then(() => {
        for (const d of hidden) d.style.opacity = "";
        onDone();
      });
  }, [leaving, ready, onDone]);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const onKey = () => leave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  return (
    <button
      type="button"
      ref={root}
      aria-label="At a glance. Tap to open Home"
      data-testid="glance"
      onPointerDown={leave}
      onWheel={leave}
      onTouchMove={leave}
      className="fixed inset-0 z-50 block cursor-default touch-none overscroll-none outline-none select-none"
    >
      <span ref={backdrop} className="absolute inset-0 block bg-black" />
      <span className="relative flex h-full flex-col items-center justify-center gap-[6vh] px-6 pt-safe pb-safe text-white">
        {ready ? (
          <>
            <span className="flex flex-col items-center gap-2">
              <span data-glance-fade className="text-sm tracking-[0.2em] text-white/55 uppercase">
                Net position
              </span>
              <span data-glance="net" className="inline-block origin-top-left">
                <HeroAmount
                  value={net}
                  className={cn(
                    "text-[min(19vw,13vh,7.5rem)] leading-none font-semibold",
                    alarm || net < 0 ? "text-neg" : "text-white",
                  )}
                />
              </span>
            </span>
            <span className="flex flex-col items-center gap-[4vh] landscape:flex-row landscape:gap-16">
              {wallets.map((w) => (
                <span key={w.account_id} className="flex flex-col items-center gap-2">
                  <span data-glance-fade className="flex items-center gap-2 text-sm text-white/55">
                    <span
                      className={cn(
                        "grid size-7 place-items-center rounded-full",
                        w.account_id === "sadapay"
                          ? "bg-[var(--brand-sadapay)] text-[var(--brand-sadapay-ink)]"
                          : "bg-[var(--brand-nayapay)] text-[var(--brand-nayapay-ink)]",
                      )}
                    >
                      <WalletLogo id={w.account_id} size={14} />
                    </span>
                    {w.name}
                  </span>
                  <span data-glance={w.account_id} className="inline-block origin-top-left">
                    <TweenMoney
                      value={w.balance}
                      className="text-[min(11vw,8vh,4rem)] leading-none font-semibold text-white"
                    />
                  </span>
                </span>
              ))}
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}
