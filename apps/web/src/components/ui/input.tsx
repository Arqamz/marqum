import { InputGroup, InputGroupText } from "@astryxdesign/core/InputGroup";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { opt } from "../../lib/opt.ts";

export { TextInput };

/**
 * Native input for the types Astryx's TextInput doesn't take (date, month). Styled like an Astryx control.
 * For text, use TextInput.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-control border border-border bg-surface px-3 text-base text-fg outline-none focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

/** Rs-prefixed amount entry: numeric keypad on phones, tabular figures. */
export function MoneyInput({
  value,
  onChange,
  autoFocus,
  label,
  hideLabel,
  description,
  size = "lg",
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  label: string;
  hideLabel?: boolean;
  description?: string;
  size?: "md" | "lg";
  className?: string;
  id?: string;
}) {
  // The group is named "Rs" (hidden) so the field's own name stays exactly `label` for screen readers and tests;
  // the visible label is plain text above it.
  return (
    <VStack gap={1.5}>
      {hideLabel ? null : (
        <Text type="label" aria-hidden>
          {label}
        </Text>
      )}
      {description ? <Text type="supporting">{description}</Text> : null}
      <InputGroup label="Rs" isLabelHidden size={size}>
        <InputGroupText>Rs</InputGroupText>
        <TextInput
          label={label}
          isLabelHidden
          inputMode="decimal"
          autoComplete="off"
          {...opt({ hasAutoFocus: autoFocus })}
          value={value}
          onChange={(v) => onChange(v.replace(/[^\d.,]/g, ""))}
          placeholder="0"
          controlClassName="num"
          width="100%"
        />
      </InputGroup>
    </VStack>
  );
}

/** Label + any control (for controls that don't carry their own label, like a native select). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <VStack as="label" gap={1.5}>
      <Text type="label">{label}</Text>
      {children}
      {hint ? <Text type="supporting">{hint}</Text> : null}
    </VStack>
  );
}
