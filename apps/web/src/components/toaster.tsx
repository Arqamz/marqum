import { HStack } from "@astryxdesign/core/HStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ToastViewport, useToast } from "@astryxdesign/core/Toast";
import { VStack } from "@astryxdesign/core/VStack";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "../lib/store.ts";
import { dismissToast, type Toast, toasts } from "../lib/toast.ts";
import { Button } from "./ui/button.tsx";

const ICON = { neutral: Info, error: CircleAlert, warn: TriangleAlert, success: CircleCheck } as const;
const TONE = { neutral: undefined, error: "text-neg", warn: "text-warn", success: "text-pos" } as const;

/**
 * Toasts above the tab bar. Astryx's ToastViewport is a `popover="manual"` in the top layer and moves into
 * the open modal Sheet (Dialog/BottomSheet use showModal), so toasts stay above it and tappable instead of inert.
 * The app's toast store owns timing; this mirrors it into the viewport.
 */
export function Toaster() {
  return (
    <ToastViewport position="bottomEnd" inset={{ bottom: 80 }} maxVisible={3}>
      <ToastBridge />
    </ToastViewport>
  );
}

function ToastBridge() {
  const list = useStore(toasts);
  const show = useToast();
  const shown = useRef(new Map<number, () => void>());
  useEffect(() => {
    const live = new Set(list.map((t) => t.id));
    for (const [id, hide] of shown.current)
      if (!live.has(id)) {
        shown.current.delete(id);
        hide();
      }
    for (const t of list) {
      if (shown.current.has(t.id)) continue;
      shown.current.set(
        t.id,
        show({
          body: t.title,
          type: t.tone === "error" ? "error" : "info",
          isAutoHide: false,
          uniqueID: `toast-${t.id}`,
          onHide: () => {
            shown.current.delete(t.id);
            dismissToast(t.id);
          },
          renderContent: ({ dismiss }) => <ToastBody t={t} dismiss={dismiss} />,
        }),
      );
    }
  }, [list, show]);
  return null;
}

function ToastBody({ t, dismiss }: { t: Toast; dismiss: () => void }) {
  const Icon = ICON[t.tone];
  return (
    <HStack gap={3} vAlign="start">
      <Icon className={TONE[t.tone]} aria-hidden />
      <StackItem size="fill">
        <VStack gap={1} hAlign="start">
          <Text weight="medium" color="inherit">
            {t.title}
          </Text>
          {t.detail ? (
            <Text type="supporting" color="inherit">
              {t.detail}
            </Text>
          ) : null}
          {t.action ? (
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                t.action?.run();
                dismiss();
              }}
            >
              {t.action.label}
            </Button>
          ) : null}
        </VStack>
      </StackItem>
      <Button variant="ghost" size="icon" label="Dismiss" onClick={dismiss}>
        <X aria-hidden />
      </Button>
    </HStack>
  );
}
