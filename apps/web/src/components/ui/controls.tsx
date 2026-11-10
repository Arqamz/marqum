import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton as ASkeleton } from "@astryxdesign/core/Skeleton";
import { Slider as ASlider } from "@astryxdesign/core/Slider";
import { Switch as ASwitch } from "@astryxdesign/core/Switch";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import type { ReactNode } from "react";
import { opt } from "../../lib/opt.ts";
import { textOf } from "./button.tsx";

/**
 * Astryx Switch. With `text` the label is shown, spread across the row (switch at the end);
 * without it the label is only for screen readers.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  text,
  description,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  text?: string;
  description?: string;
  id?: string;
}) {
  return (
    <ASwitch
      label={text ?? label}
      aria-label={label}
      isLabelHidden={text === undefined}
      value={checked}
      onChange={(v) => onCheckedChange(v)}
      labelPosition="start"
      labelSpacing={text === undefined ? "hug" : "spread"}
      {...opt({ id, description, width: text === undefined ? undefined : "100%" })}
    />
  );
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
  centered,
  format,
}: {
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  /** two-sided (−/+) values: a mark at zero */
  centered?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <ASlider
      label={label}
      isLabelHidden
      value={value}
      onChange={(v: number) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      {...opt({ formatValue: format, marks: centered ? [{ value: 0 }] : undefined })}
      width="100%"
    />
  );
}

/** Single choice; fills the row. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      onChange={(v) => onValueChange(v as T)}
      layout="fill"
      size={size}
    >
      {options.map((o) => (
        <SegmentedControlItem key={o.value} value={o.value} label={o.label} {...opt({ icon: o.icon })} />
      ))}
    </SegmentedControl>
  );
}

/** Filter chip: a small toggle button. */
export function Chip({
  selected,
  onClick,
  children,
  label,
  icon,
  "data-testid": testId,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  label?: string;
  icon?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <ToggleButton
      size="sm"
      label={label ?? textOf(children)}
      isPressed={Boolean(selected)}
      onPressedChange={() => onClick?.()}
      {...opt({ icon, "data-testid": testId })}
    >
      {children}
    </ToggleButton>
  );
}

export function Skeleton({
  width,
  height = 16,
  index,
}: {
  width?: number | string;
  height?: number | string;
  index?: number;
  className?: string;
}) {
  return <ASkeleton height={height} {...opt({ width, index })} />;
}
