import { RouterProvider } from "@tanstack/react-router";
import { LucideProvider } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DatasetProvider } from "./components/dataset-provider.tsx";
import { PromptHost } from "./components/prompt-host.tsx";
import { QuickAddHost } from "./components/quick-add.tsx";
import { Wordmark } from "./components/shell.tsx";
import { Toaster } from "./components/toaster.tsx";
import { useAuth } from "./lib/auth.ts";
import { startBackground } from "./lib/lifecycle.ts";
import { kv } from "./lib/storage.ts";
import { makeRouter } from "./router.tsx";
import { LoginScreen } from "./screens/login.tsx";
import { Onboarding } from "./screens/onboarding.tsx";

const ONBOARDED = "marqum.onboarded";

export function App() {
  const state = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const router = useMemo(makeRouter, []);
  const signedIn = state.status === "signed-in";

  useEffect(() => {
    if (!signedIn) return;
    void kv.get(ONBOARDED).then((v) => setOnboarded(v === "1"));
    return startBackground();
  }, [signedIn]);

  return (
    <LucideProvider size={20} strokeWidth={1.75}>
      <DatasetProvider>
        {state.status === "loading" || (signedIn && onboarded === null) ? (
          <div className="grid min-h-dvh place-items-center" aria-busy>
            <Wordmark />
          </div>
        ) : !signedIn ? (
          <LoginScreen />
        ) : !onboarded ? (
          <Onboarding
            onDone={() => {
              void kv.set(ONBOARDED, "1");
              setOnboarded(true);
            }}
          />
        ) : (
          <RouterProvider router={router} />
        )}
        <QuickAddHost />
        <PromptHost />
        <Toaster />
      </DatasetProvider>
    </LucideProvider>
  );
}
