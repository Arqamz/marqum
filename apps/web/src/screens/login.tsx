import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { type FormEvent, useState } from "react";
import { Wordmark } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { auth } from "../lib/auth.ts";
import { opt } from "../lib/opt.ts";
import { defaultDeviceName } from "../lib/platform.ts";

export function LoginScreen() {
  const [passcode, setPasscode] = useState("");
  const [device, setDevice] = useState(defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <VStack as="main" gap={8} vAlign="center" className="mx-auto min-h-dvh max-w-sm px-safe pt-safe pb-safe">
      <VStack gap={4}>
        <Wordmark />
        <Heading level={1}>Sign in</Heading>
      </VStack>
      <VStack
        as="form"
        gap={4}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await auth.login(passcode, device.trim() || defaultDeviceName());
          } catch (err) {
            setError(
              err instanceof TypeError
                ? "Can't reach the server."
                : err instanceof Error
                  ? err.message
                  : String(err),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput
          label="Passcode"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={passcode}
          onChange={setPasscode}
          hasAutoFocus
          size="lg"
          width="100%"
          {...opt({ status: error ? { type: "error" as const } : undefined })}
        />
        <TextInput
          label="This device"
          value={device}
          onChange={(v) => setDevice(v.slice(0, 60))}
          width="100%"
        />
        {error ? <Banner status="error" title={error} role="alert" /> : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          width="full"
          loading={busy}
          disabled={passcode.length < 4}
        >
          Sign in
        </Button>
      </VStack>
    </VStack>
  );
}
