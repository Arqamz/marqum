import { RadioGroup, Slider as RSlider, Switch as RSwitch } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <RSwitch.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative h-7 w-12 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent"
    >
      <RSwitch.Thumb className="block size-5 translate-x-1 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-6" />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  return (
    <RSlider.Root
      value={[value]}
      onValueChange={(v) => onValueChange(v[0] ?? value)}
      min={min}
      max={max}
      step={step}
      className="relative flex h-8 w-full touch-none items-center select-none"
    >
      <RSlider.Track className="relative h-1 grow rounded-full bg-surface-3">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={label}
        className="block size-6 rounded-full border-2 border-accent bg-surface"
      />
    </RSlider.Root>
  );
}

/** Segmented control (single choice). Selection is the accent. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      className={cn("flex gap-1 rounded-control bg-surface-2 p-1", className)}
      orientation="horizontal"
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="h-8 flex-1 rounded-inner px-3 text-sm font-medium text-fg-muted transition-colors data-[state=checked]:bg-surface data-[state=checked]:text-accent-text"
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** Filter chip: toggles; current selection uses the accent. */
export function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap transition-colors",
        selected
          ? "border-accent bg-accent-soft text-accent-text"
          : "border-border bg-surface text-fg-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-inner", className)} aria-hidden />;
}
