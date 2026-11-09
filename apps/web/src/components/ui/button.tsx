import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const button = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,opacity,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90",
        secondary: "bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "text-fg hover:bg-surface-2",
        text: "text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg",
        danger: "text-fg-muted hover:bg-surface-2 hover:text-fg",
      },
      size: {
        lg: "h-12 rounded-control px-5 text-base",
        md: "h-10 rounded-control px-4 text-sm",
        sm: "h-8 rounded-inner px-3 text-sm",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size }), variant === "text" && "h-auto px-0", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
