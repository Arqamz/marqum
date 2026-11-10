import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { LocalNotifications } from "@capacitor/local-notifications";
import { karachiNow, parseRs } from "@marqum/core";
import { Bell, FolderOpen, type LucideIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Wordmark } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { MoneyInput } from "../components/ui/input.tsx";
import { enqueue, newId } from "../lib/commands.ts";
import { isNative } from "../lib/platform.ts";
import { MarqumNative } from "../native/marqum-native.ts";

type Step = "files" | "notifications" | "balances";

/** First run: hands-free permissions (Android) and today's balances for both wallets. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const steps: Step[] = isNative() ? ["files", "notifications", "balances"] : ["balances"];
  const [i, setI] = useState(0);
  const step = steps[i] ?? "balances";
  const next = () => (i + 1 < steps.length ? setI(i + 1) : onDone());
  return (
    <VStack as="main" gap={8} className="mx-auto min-h-dvh max-w-sm px-safe pt-safe pb-safe">
      <HStack vAlign="center" justify="between" className="h-[var(--topbar-h)]">
        <Wordmark />
        {steps.length > 1 ? (
          <Text type="supporting" hasTabularNumbers>
            {i + 1} of {steps.length}
          </Text>
        ) : null}
      </HStack>
      <VStack gap={8} justify="center" className="flex-1 pb-8">
        {step === "files" ? (
          <Permission
            icon={FolderOpen}
            title="Auto-import statements"
            body="Watches Downloads for new statements. Android calls this “All files access”."
            cta="Allow file access"
            onAllow={async () => {
              await MarqumNative.requestFileAccess().catch(() => undefined);
              next();
            }}
            onSkip={next}
          />
        ) : null}
        {step === "notifications" ? (
          <Permission
            icon={Bell}
            title="Log payments instantly"
            body="Reads NayaPay and SadaPay alerts only."
            cta="Allow notifications"
            onAllow={async () => {
              await LocalNotifications.requestPermissions().catch(() => undefined);
              await MarqumNative.requestNotificationAccess().catch(() => undefined);
              next();
            }}
            onSkip={next}
          />
        ) : null}
        {step === "balances" ? <Balances onDone={onDone} /> : null}
      </VStack>
    </VStack>
  );
}

function Permission({
  icon,
  title,
  body,
  cta,
  onAllow,
  onSkip,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  onAllow: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <VStack gap={4} hAlign="start">
        <Icon icon={icon} size="lg" color="accent" />
        <Heading level={1}>{title}</Heading>
        <Text color="secondary">{body}</Text>
      </VStack>
      <VStack gap={2}>
        <Button variant="primary" size="lg" width="full" onClick={onAllow}>
          {cta}
        </Button>
        <Button variant="ghost" width="full" onClick={onSkip}>
          Not now
        </Button>
      </VStack>
    </>
  );
}

function Balances({ onDone }: { onDone: () => void }) {
  const [sada, setSada] = useState("");
  const [naya, setNaya] = useState("");
  const s = parseRs(sada);
  const n = parseRs(naya);
  return (
    <VStack
      as="form"
      gap={8}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const at = karachiNow();
        if (s !== null)
          void enqueue("recordBalance", { entry_id: newId(), account_id: "sadapay", balance: s, as_of: at });
        if (n !== null)
          void enqueue("recordBalance", { entry_id: newId(), account_id: "nayapay", balance: n, as_of: at });
        onDone();
      }}
    >
      <Heading level={1}>Today's balances</Heading>
      <VStack gap={4}>
        <MoneyInput label="SadaPay balance" value={sada} onChange={setSada} />
        <MoneyInput label="NayaPay balance" value={naya} onChange={setNaya} />
      </VStack>
      <VStack gap={2}>
        <Button type="submit" variant="primary" size="lg" width="full" disabled={s === null && n === null}>
          Start
        </Button>
        <Button variant="ghost" width="full" onClick={onDone}>
          Skip — import statements first
        </Button>
      </VStack>
    </VStack>
  );
}
