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
      await page.mouse.move(1, 1); // no hover tooltips in screenshots
      await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png`, fullPage: false });
    };

    // Login → first run
    await page.goto("/");
    await page.getByLabel("Passcode").fill(world.server.passcode);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: /Skip/ }).click();

    // Home: net position hero in debt mode with the loan line
    const hero = page.getByTestId("hero");
    await expect(page.getByTestId("debt-line")).toContainText(
      /In debt · owe Mom Rs 60,000 · clear by \w{3} 2027 at Rs 15,000\/month/,
    );
    await expect(hero.locator(".text-neg")).toHaveCount(1); // positive net stays ink; only the debt line is red
    await expect(page.getByTestId("unverified-banner")).toContainText("2 unverified");
    await expect(page.getByTestId("category-card").first()).toBeVisible();
    await expect(page.getByTestId("sync-state")).toHaveAttribute("data-status", "synced");
    await expect(page.getByTestId("sync-state").getByRole("button")).toHaveCount(0); // nothing shown when healthy
    await shot("home");

    // Wallet detail: the month as an account, b/f → in → out → closing
    await page.getByTestId("wallet-nayapay").click();
    await expect(page.getByTestId("wallet-ledger")).toContainText("Brought forward from Oct 2026");
    await expect(page.getByTestId("balance-line")).toBeVisible();
    await expect(page.getByTestId("ledger-row").first()).toContainText("Balance brought forward");
    await shot("wallet");
    await page.getByTestId("ledger-row").first().scrollIntoViewIfNeeded();
    await shot("wallet-ledger");
    await page.getByRole("button", { name: /Previous month/ }).click();
    await expect(page.getByTestId("pager-month")).toHaveText("Oct 2026");
    await page.getByRole("button", { name: "Back" }).click();

    // Activity: tag a warm row
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
    const lunch = page.getByTestId("txn-row").filter({ hasText: "Lunch at Kolachi" });
    await expect(lunch).toHaveAttribute("data-status", "provisional");
    await expect(page.getByTestId("ledger-row").filter({ hasText: "Balance brought forward" })).toHaveCount(
      2,
    );
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

    // Category detail (Screen Time style): month total, days, year, parts, rows
    await page.goto("/#/category/car?month=2026-10");
    await expect(page.getByTestId("pager-month")).toHaveText("Oct 2026");
    await expect(page.getByTestId("category-total")).toContainText("avg Rs");
    await expect(page.getByTestId("daily-bars")).toBeVisible();
    await expect(page.getByTestId("monthly-bars")).toBeVisible();
    await expect(page.getByTestId("parts")).toContainText("Petrol");
    await shot("category");
    await page.getByRole("button", { name: /Next month/ }).click();
    await expect(page.getByTestId("pager-month")).toHaveText("Nov 2026");

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

    // What-if v2
    const whatIf = page.getByTestId("what-if-card");
    await whatIf.getByLabel("Price").fill("150000");
    await expect(page.getByTestId("what-if-verdict")).toBeVisible();
    await whatIf
      .getByRole("button")
      .filter({ hasText: /Ready|Rs|month/ })
      .click();
    const sheet = page.getByTestId("what-if-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("projection-chart")).toBeVisible();
    await shot("what-if");
    await sheet.getByRole("radio", { name: "A loan" }).click();
    await expect(page.getByTestId("what-if-outcome")).toBeVisible();
    await page.getByTestId("what-if-outcome").scrollIntoViewIfNeeded();
    await shot("what-if-loan");
    await sheet.getByRole("button", { name: /Assumptions/ }).click();
    await sheet.getByRole("button", { name: "Add a one-off" }).click();
    await sheet.getByLabel("What").fill("Eid");
    await expect(sheet.getByRole("button", { name: "Save as my defaults" })).toBeVisible();
    await shot("what-if-assumptions");
    await sheet.getByRole("button", { name: "Save as my defaults" }).click();
    await expect
      .poll(() => world.server.log.some((c) => c.name === "setSetting" && c.args.key === "forecast"))
      .toBe(true);
    await page.keyboard.press("Escape");

    // Close month (October)
    await page.goto("/#/close");
    await expect(page.getByTestId("checklist")).toBeVisible();
    await shot("close");

    // Plan: money split, fixed charges, budgets, goals, loans
    await page.goto("/#/plan");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("a month");
    await expect(page.getByTestId("allocation")).toContainText("SadaPay");
    await shot("plan");
    await page.getByRole("button", { name: "Add fixed charge" }).click();
    await page.getByLabel("Name").fill("Internet");
    await page.getByRole("dialog").getByLabel("Amount").fill("3500");
    await page.getByRole("dialog").getByRole("button", { name: "Add fixed charge" }).click();
    await expect(page.getByTestId("fixed-charges")).toContainText("Internet");
    await page.getByTestId("budgets").scrollIntoViewIfNeeded();
    await shot("plan-budgets");

    // Settings: opening balances, test-run line, reset
    await page.goto("/#/settings");
    await expect(page.getByText("Test run until 31 Dec 2026 — v1.0 starts 1 Jan 2027")).toBeVisible();
    await expect(page.getByText(/Opening balance, 1 May 2026/).first()).toBeVisible();
    await shot("settings");
  });
}
