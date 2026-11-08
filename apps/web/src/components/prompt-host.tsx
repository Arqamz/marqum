import { useEffect, useState } from "react";
import { prompts } from "../lib/prompts.ts";
import { useStore } from "../lib/store.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Renders askSecret() prompts: step-up passcode and statement passwords. */
export function PromptHost() {
  const p = useStore(prompts);
  const [value, setValue] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the field for each new prompt
  useEffect(() => setValue(""), [p]);
  return (
    <Sheet
      open={p !== null}
      onOpenChange={(open) => {
        if (!open) p?.resolve(null);
      }}
      title={p?.title ?? ""}
      description={p?.detail}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) p?.resolve(value);
        }}
      >
        <Input
          type="password"
          inputMode={p?.kind === "passcode" ? "numeric" : "text"}
          autoComplete={p?.kind === "passcode" ? "current-password" : "off"}
          aria-label={p?.kind === "passcode" ? "Passcode" : "Password"}
          placeholder={p?.kind === "passcode" ? "Passcode" : "Password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          aria-invalid={p?.error ? true : undefined}
        />
        {p?.error ? <p className="text-sm text-neg">{p.error}</p> : null}
        <Button type="submit" variant="primary" size="lg" disabled={!value}>
          {p?.confirm}
        </Button>
      </form>
    </Sheet>
  );
}
