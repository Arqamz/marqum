import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

export const inputClass =
  "h-12 w-full rounded-control border border-border bg-surface px-4 text-base text-fg outline-none transition-colors focus:border-accent";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "h-auto min-h-24 py-3", className)} {...props} />;
}

/** Rs-prefixed amount entry: numeric keypad on phones, tabular figures. */
export function MoneyInput({
  value,
  onChange,
  className,
  autoFocus,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
  label: string;
  id?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-muted">Rs</span>
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: amount is the only thing to type in these sheets
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        className={cn(inputClass, "num pl-11 text-lg")}
        placeholder="0"
      />
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="flex flex-col gap-2">
      <span className="text-sm text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-sm text-fg-muted">{hint}</span> : null}
    </label>
  );
}
