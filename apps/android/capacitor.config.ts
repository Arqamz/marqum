import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.marqum",
  appName: "Marqūm",
  webDir: "../web/dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" },
  plugins: {
    // Edge-to-edge: bar icons follow the system theme; safe-area insets are exposed to CSS
    // (env(safe-area-inset-*) and --safe-area-inset-*). The web app may call SystemBars.setStyle on theme change.
    SystemBars: { style: "DEFAULT", insetsHandling: "css" },
  },
};

export default config;
