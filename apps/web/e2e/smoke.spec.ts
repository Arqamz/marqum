import { expect, type Page, test } from "@playwright/test";
import { buildWorld, novemberCsv } from "../test/world.ts";

/** Karachi 2026-11-08 12:00 (UTC+5). */
const FIXED = new Date("2026-11-08T07:00:00Z");
const SHOTS = "e2e/screenshots";

async function mockApi(page: Page) {
  const world = buildWorld();
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const body = req.postData() ? JSON.parse(req.postData() ?? "null") : undefined;
    const res = world.server.handle(req.method(), req.url(), await req.allHeaders(), body);
    await route.fulfill({
      status: res.status,
      contentType: "application/json",
      body: JSON.stringify(res.body),
    });
  });
  return world;
}

test.describe.configure({ mode: "serial" });

for (const scheme of ["light", "dark"] as const) {
  test(`smoke (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.clock.setFixedTime(FIXED);
    const world = await mockApi(page);
    const shot = async (name: string) => {
      // transient toasts would cover the content
      for (const b of await page.getByRole("button", { name: "Dismiss" }).all())
        await b.click().catch(() => undefined);
      await page
        .getByRole("button", { name: "Dismiss" })
        .first()
        .waitFor({ state: "detached" })
        .catch(() => undefined);
      await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png`, fullPage: false });
    };

    // Login → first run
    await page.goto("/");
    await page.getByLabel("Passcode").fill(world.server.passcode);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: /Skip/ }).click();

    // Home: net position hero in debt mode with the loan line
    const hero = page.getByTestId("hero");
    await expect(hero).toContainText("In debt");
    await expect(hero).toContainText(/Owe Mom Rs 60,000 · clear by \w{3} 2027 at Rs 15,000\/month/);
    await expect(page.getByTestId("unverified-banner")).toContainText("2 unverified");
    await expect(page.getByTestId("category-card").first()).toBeVisible();
    await expect(page.getByTestId("sync-dot")).toHaveAttribute("data-status", "synced");
    await shot("home");

    // Activity: tag a warm row
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
    const lunch = page.getByTestId("txn-row").filter({ hasText: "Lunch at Kolachi" });
    await expect(lunch).toHaveAttribute("data-status", "provisional");
    await shot("activity");
    await lunch.click();
    await page.getByRole("option", { name: "Food" }).click();
    await page.getByRole("button", { name: "Friends" }).click();
    await shot("tag-sheet");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(lunch).toContainText("Food › Friends");
    await expect
      .poll(() => world.server.log.some((c) => c.name === "tagTransaction" && c.args.txn_id === "warm-1"))
      .toBe(true);

    // Category detail
    await page.goto("/#/category/food");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("on food in November");
    await expect(page.getByTestId("monthly-bars")).toBeVisible();
    await shot("category");

    // Import a synthetic statement: warm rows become verified
    await page.goto("/#/import");
    await page.getByTestId("file-input").setInputFiles({
      name: "m-11-2026.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(novemberCsv(world.nayaClosing)),
    });
    await expect(page.getByText("Imported NayaPay 6–7 Nov · 3 new")).toBeVisible();
    await expect
      .poll(() => world.server.dataset().transactions.filter((t) => t.status === "provisional").length)
      .toBe(0);
    await page.goto("/#/");
    await expect(page.getByTestId("unverified-banner")).toHaveCount(0);

    // What-if
    const whatIf = page.getByTestId("what-if-card");
    await whatIf.getByLabel("Price").fill("150000");
    await expect(page.getByTestId("what-if-verdict")).toBeVisible();
    await whatIf.getByRole("button").filter({ hasText: /Rs/ }).click();
    await expect(page.getByTestId("what-if-sheet")).toBeVisible();
    await expect(page.getByTestId("waterfall")).toBeVisible();
    await shot("what-if");
    await page.keyboard.press("Escape");

    // Close month (October)
    await page.goto("/#/close");
    await expect(page.getByTestId("checklist")).toBeVisible();
    await shot("close");

    // Plan + settings render
    await page.goto("/#/plan");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("a month");
    await shot("plan");
  });
}
