import { useEffect, useState } from "react";
import { Button } from "./button.tsx";

/**
 * An action that asks once more before it runs. The first tap swaps the label for `confirm`, which says exactly
 * what will happen ("Delete Spotify — it stops being tracked"); a second tap within 4 s runs it, otherwise it
 * resets. Use it for anything that deletes, merges, or changes figures you can't see change.
 */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  variant = "ghost",
  size,
  width = "full",
  disabled,
  "data-testid": testId,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  /** look before the first tap; armed it is always "danger" */
  variant?: "primary" | "secondary" | "ghost";
  size?: "lg" | "md" | "sm";
  width?: "full" | null;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);
  return (
    <Button
      variant={armed ? "danger" : variant}
      {...(size ? { size } : {})}
      {...(width ? { width } : {})}
      {...(disabled ? { disabled } : {})}
      {...(testId ? { "data-testid": testId } : {})}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : label}
    </Button>
  );
}
