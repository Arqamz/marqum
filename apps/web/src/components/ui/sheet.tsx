import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { X } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { textOf } from "./button.tsx";

const wide = typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)") : null;
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      wide?.addEventListener("change", cb);
      return () => wide?.removeEventListener("change", cb);
    },
    () => wide?.matches ?? false,
  );
}

/** Bottom sheet on phones, centred dialog on wide screens. Title + close sit in the header. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  purpose = "info",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "form" keeps entered data safe: no scrim-tap or swipe dismiss */
  purpose?: "info" | "form";
  className?: string;
}) {
  const isWide = useWide();
  const body = (
    <VStack gap={5}>
      <HStack gap={3} vAlign="start">
        <StackItem size="fill">
          <VStack gap={1}>
            <Heading level={2} textWrap="balance">
              {title}
            </Heading>
            {description ? <Text type="supporting">{description}</Text> : null}
          </VStack>
        </StackItem>
        <IconButton
          label="Close"
          icon={<X aria-hidden />}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>
      {children}
      {footer}
    </VStack>
  );
  const label = textOf(title) || "Sheet";
  if (isWide) {
    return (
      <Dialog
        isOpen={open}
        onOpenChange={onOpenChange}
        width={520}
        maxHeight="88dvh"
        purpose={purpose}
        padding={6}
      >
        {open ? body : null}
      </Dialog>
    );
  }
  return (
    <BottomSheet
      isOpen={open}
      onOpenChange={onOpenChange}
      label={label}
      height="hug"
      purpose={purpose}
      padding={5}
    >
      {open ? body : null}
    </BottomSheet>
  );
}
