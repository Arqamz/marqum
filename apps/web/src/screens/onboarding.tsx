import { LocalNotifications } from "@capacitor/local-notifications";
import { karachiNow, parseRs } from "@marqum/core";
import { Bell, FolderOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Wordmark } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field, MoneyInput } from "../components/ui/input.tsx";
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-8 px-safe pt-safe pb-safe">
      <div className="flex h-[var(--topbar-h)] items-center justify-between">
        <Wordmark />
        {steps.length > 1 ? (
          <span className="num text-sm text-fg-muted">
            {i + 1} of {steps.length}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-8 pb-8">
        {step === "files" ? (
          <Permission
            icon={<FolderOpen aria-hidden />}
            title="Let statements import themselves"
            body="Marqūm watches Downloads and NayaPay's statement folder for new statements and imports them after checking every total. Android calls this “All files access”."
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
            icon={<Bell aria-hidden />}
            title="Log payments the moment they happen"
            body="With notification access, NayaPay and SadaPay payment alerts become unverified entries within seconds. Only those two apps are read. Month-end reminders need notifications too."
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
      </div>
    </main>
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
  icon: ReactNode;
  title: string;
  body: string;
  cta: string;
  onAllow: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-surface-2">{icon}</span>
        <h1 className="font-display text-headline font-medium">{title}</h1>
        <p className="text-fg-muted">{body}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" size="lg" onClick={onAllow}>
          {cta}
        </Button>
        <Button variant="ghost" onClick={onSkip}>
          Not now
        </Button>
      </div>
    </>
  );
}

function Balances({ onDone }: { onDone: () => void }) {
  const [sada, setSada] = useState("");
  const [naya, setNaya] = useState("");
  const s = parseRs(sada);
  const n = parseRs(naya);
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const at = karachiNow();
        if (s !== null)
          void enqueue("recordBalance", { entry_id: newId(), account_id: "sadapay", balance: s, as_of: at });
        if (n !== null)
          void enqueue("recordBalance", { entry_id: newId(), account_id: "nayapay", balance: n, as_of: at });
        onDone();
      }}
    >
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-headline font-medium">What's in your wallets right now?</h1>
        <p className="text-fg-muted">
          Open each app and type the balance it shows. Statements take over from here; any gap shows up as
          unaccounted.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <Field label="SadaPay">
          <MoneyInput label="SadaPay balance" value={sada} onChange={setSada} />
        </Field>
        <Field label="NayaPay">
          <MoneyInput label="NayaPay balance" value={naya} onChange={setNaya} />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={s === null && n === null}>
          Start
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Skip — I'll import statements first
        </Button>
      </div>
    </form>
  );
}
