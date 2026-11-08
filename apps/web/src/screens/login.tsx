import { useState } from "react";
import { Wordmark } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field, Input } from "../components/ui/input.tsx";
import { auth } from "../lib/auth.ts";
import { defaultDeviceName } from "../lib/platform.ts";

export function LoginScreen() {
  const [passcode, setPasscode] = useState("");
  const [device, setDevice] = useState(defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-safe pt-safe pb-safe">
      <div className="flex flex-col gap-4">
        <Wordmark />
        <h1 className="font-display text-headline font-medium">Sign in to your ledger</h1>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await auth.login(passcode, device.trim() || defaultDeviceName());
          } catch (err) {
            setError(
              err instanceof TypeError
                ? "Can't reach the server. Check your connection and try again."
                : err instanceof Error
                  ? err.message
                  : String(err),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Passcode">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <Field label="This device">
          <Input value={device} onChange={(e) => setDevice(e.target.value)} maxLength={60} />
        </Field>
        {error ? (
          <p className="text-sm text-neg" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={passcode.length < 4}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
