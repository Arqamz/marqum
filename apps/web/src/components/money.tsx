import { formatRs } from "@marqum/core";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";

/** An amount with tabular figures. `sign` shows + for inflows. */
export function Money({
  value,
  sign,
  className,
  tone,
}: {
  value: number;
  sign?: boolean;
  className?: string;
  tone?: "pos" | "neg" | "warn" | "muted";
}) {
  return (
    <span
      className={cn(
        "num whitespace-nowrap",
        tone === "pos" && "text-pos",
        tone === "neg" && "text-neg",
        tone === "warn" && "text-warn",
        tone === "muted" && "text-fg-muted",
        className,
      )}
    >
      {formatRs(value, sign ? { sign: true } : {})}
    </span>
  );
}

/** Tweens to a new value (e.g. a balance after an import). 250ms ease-out; instant under reduced motion. */
export function useTween(value: number): number {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.25,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return shown;
}

/** The hero figure: smaller, lighter "Rs" prefix optically aligned to the cap height of the numerals. */
export function HeroAmount({ value, className }: { value: number; className?: string }) {
  const shown = useTween(value);
  const text = formatRs(Math.abs(shown));
  const digits = text.replace(/^Rs\s?/, "");
  return (
    <span className={cn("num inline-flex items-baseline font-display", className)}>
      <span className="sr-only">{formatRs(value)}</span>
      {shown < 0 ? <span aria-hidden>−</span> : null}
      <span aria-hidden className="mr-2 text-[0.45em] font-normal tracking-normal opacity-80">
        Rs
      </span>
      <span aria-hidden>{digits}</span>
    </span>
  );
}

export function TweenMoney(props: {
  value: number;
  className?: string;
  tone?: "pos" | "neg" | "warn" | "muted";
}) {
  const shown = useTween(props.value);
  return <Money {...props} value={shown} />;
}
