import { Button as AButton } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Children, isValidElement, type MouseEvent, type ReactNode } from "react";
import { opt } from "../../lib/opt.ts";

type Variant = "primary" | "secondary" | "ghost" | "text" | "danger";
type Size = "lg" | "md" | "sm" | "icon";

export interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent) => void;
  /** Accessible name. Defaults to the text of `children`. */
  label?: string;
  icon?: ReactNode;
  /** stretch to the row ("full") */
  width?: "full";
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}

const VARIANT = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  text: "ghost",
  danger: "destructive",
} as const;

/** Plain text of a node tree, for the accessible label Astryx requires. */
export function textOf(node: ReactNode): string {
  let out = "";
  Children.forEach(node, (c) => {
    if (typeof c === "string" || typeof c === "number") out += String(c);
    else if (isValidElement<{ children?: ReactNode }>(c)) out += textOf(c.props.children);
  });
  return out.replace(/\s+/g, " ").trim();
}

/** Astryx Button with the app's variant names. `size="icon"` is an IconButton (pass the icon as children). */
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  disabled,
  type = "button",
  onClick,
  label,
  icon,
  width,
  className,
  children,
  ...rest
}: ButtonProps) {
  const name = label ?? rest["aria-label"] ?? textOf(children);
  if (size === "icon") {
    return (
      <IconButton
        label={name}
        icon={icon ?? children}
        variant={VARIANT[variant]}
        type={type}
        {...opt({
          isLoading: loading,
          isDisabled: disabled,
          onClick,
          className,
          "data-testid": rest["data-testid"],
        })}
      />
    );
  }
  return (
    <AButton
      label={name}
      variant={VARIANT[variant]}
      size={size}
      type={type}
      {...opt({
        icon,
        isLoading: loading,
        isDisabled: disabled,
        onClick,
        width: width === "full" ? "100%" : undefined,
        className,
        "data-testid": rest["data-testid"],
      })}
    >
      {children}
    </AButton>
  );
}
