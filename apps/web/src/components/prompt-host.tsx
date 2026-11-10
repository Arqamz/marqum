import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useState } from "react";
import { opt } from "../lib/opt.ts";
import { prompts } from "../lib/prompts.ts";
import { useStore } from "../lib/store.ts";
import { Button } from "./ui/button.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Renders askSecret() prompts: step-up passcode and statement passwords. */
export function PromptHost() {
  const p = useStore(prompts);
  const [value, setValue] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the field for each new prompt
  useEffect(() => setValue(""), [p]);
  const passcode = p?.kind === "passcode";
  return (
    <Sheet
      open={p !== null}
      onOpenChange={(open) => {
        if (!open) p?.resolve(null);
      }}
      title={p?.title ?? ""}
      description={p?.detail}
    >
      <VStack
        as="form"
        gap={4}
        onSubmit={(e) => {
          e.preventDefault();
          if (value) p?.resolve(value);
        }}
      >
        <TextInput
          type="password"
          label={passcode ? "Passcode" : "Password"}
          isLabelHidden
          placeholder={passcode ? "Passcode" : "Password"}
          inputMode={passcode ? "numeric" : "text"}
          autoComplete={passcode ? "current-password" : "off"}
          value={value}
          onChange={setValue}
          hasAutoFocus
          size="lg"
          {...opt({ status: p?.error ? { type: "error" as const, message: p.error } : undefined })}
        />
        <Button type="submit" variant="primary" size="lg" disabled={!value}>
          {p?.confirm}
        </Button>
      </VStack>
    </Sheet>
  );
}
