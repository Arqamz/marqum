import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { monthLabel } from "@marqum/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Button } from "./ui/button.tsx";

/** Month header with chevrons; swipe the content to page months. `months` is oldest → newest. */
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
    <VStack
      gap={4}
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
      <HStack justify="between" vAlign="center">
        <Button
          variant="ghost"
          size="icon"
          label={prev ? `Previous month, ${monthLabel(prev)}` : "No earlier month"}
          disabled={!prev}
          onClick={() => prev && onChange(prev)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Text weight="semibold" data-testid="pager-month">
          {monthLabel(month)}
        </Text>
        <Button
          variant="ghost"
          size="icon"
          label={next ? `Next month, ${monthLabel(next)}` : "No later month"}
          disabled={!next}
          onClick={() => next && onChange(next)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </HStack>
      {children}
    </VStack>
  );
}
