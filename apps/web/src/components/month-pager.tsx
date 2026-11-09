import { monthLabel } from "@marqum/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef } from "react";

/**
 * Month header with chevrons; swiping the content left/right moves to the next/previous month
 * (like Screen Time's week pager). `months` is oldest → newest.
 */
export function MonthPager({
  months,
  month,
  onChange,
  children,
}: {
  months: string[];
  month: string;
  onChange: (m: string) => void;
  children: ReactNode;
}) {
  const i = months.indexOf(month);
  const prev = i > 0 ? months[i - 1] : undefined;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : undefined;
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="flex flex-col gap-4"
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        const t = e.changedTouches[0];
        start.current = null;
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(t.clientY - s.y) * 1.5) return;
        if (dx < 0 && next) onChange(next);
        if (dx > 0 && prev) onChange(prev);
      }}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={prev ? `Previous month, ${monthLabel(prev)}` : "No earlier month"}
          disabled={!prev}
          onClick={() => prev && onChange(prev)}
          className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        >
          <ChevronLeft aria-hidden />
        </button>
        <span className="font-medium" data-testid="pager-month">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          aria-label={next ? `Next month, ${monthLabel(next)}` : "No later month"}
          disabled={!next}
          onClick={() => next && onChange(next)}
          className="-mr-2 grid size-10 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        >
          <ChevronRight aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}
