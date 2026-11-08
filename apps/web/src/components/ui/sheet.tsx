import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * Bottom sheet on phones, centred dialog on wide screens. Floats, so it's the one place with a shadow.
 * Radius: sheet 28 with 24 padding → inner elements use 4 (chips) — controls inside use radius-control (12) only
 * when they sit in their own group with padding of 16.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          className={cn(
            "sheet-content fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-sheet bg-surface shadow-float outline-none",
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-sheet",
            className,
          )}
          // Tapping a toast (e.g. "Imported …") must not dismiss the sheet underneath.
          onPointerDownOutside={(e) => {
            if ((e.target as Element | null)?.closest?.("[data-toaster]")) e.preventDefault();
          }}
        >
          <div
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden"
            aria-hidden
          />
          <div className="flex items-start justify-between gap-4 px-6 pt-4 pb-2">
            <div className="flex min-w-0 flex-col gap-1">
              <Dialog.Title className="font-display text-xl font-medium text-balance">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-fg-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mt-1 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2"
              aria-label="Close"
            >
              <X aria-hidden />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">{children}</div>
          {footer ? <div className="border-border border-t px-6 pt-4 pb-safe-plus">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
