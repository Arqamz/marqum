import { createStore } from "./store.ts";

/** Promise-based secret prompts (passcode for step-up, PDF passwords), rendered by <PromptHost/>. */
export interface SecretPrompt {
  kind: "passcode" | "password";
  title: string;
  detail: string;
  confirm: string;
  error?: string;
  resolve: (value: string | null) => void;
}

export const prompts = createStore<SecretPrompt | null>(null);

export function askSecret(p: Omit<SecretPrompt, "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    prompts.get()?.resolve(null);
    prompts.set({
      ...p,
      resolve: (v) => {
        prompts.set(null);
        resolve(v);
      },
    });
  });
}
