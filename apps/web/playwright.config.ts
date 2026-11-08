import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;
const channel = process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "chrome");

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${PORT}`,
    // Locally use the installed Chrome (no browser download needed); CI installs Playwright's Chromium.
    ...(channel ? { channel } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
