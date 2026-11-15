import { expect, type Page, test } from "@playwright/test";
import { buildWorld } from "../test/world.ts";

/** Karachi 2026-11-08 12:00 (UTC+5). */
const FIXED = new Date("2026-11-08T07:00:00Z");
const SHOTS = process.env.EDIT_SHOTS;

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

// Fixing mistakes: every edit says what it will do, and every delete asks twice.
test("edits and confirmations", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.clock.setFixedTime(FIXED);
  const world = await mockApi(page);
  const shot = async (name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  const live = () => world.server.dataset().transactions;

  await page.goto("/");
  await page.getByLabel("Passcode").fill(world.server.passcode);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Skip/ }).click();
  await page.getByTestId("glance").click();

  // An unverified row: fix its amount and wallet; the save button names the change
  await page.goto("/#/activity?filter=unverified");
  await page.getByText("Lunch at Kolachi").click();
  const facts = page.getByTestId("fix-facts");
  await facts.getByLabel("Spent").fill("1500");
  await facts.getByRole("radio", { name: "SadaPay" }).click();
  await expect(page.getByRole("button", { name: /^Save · move to SadaPay · Rs 1,500$/ })).toBeVisible();
  await shot("edit-facts");
  await page.getByRole("button", { name: /^Save · move to SadaPay/ }).click();
  await expect.poll(() => live().find((t) => t.reason === "Lunch at Kolachi")?.account_id).toBe("sadapay");
  expect(live().find((t) => t.reason === "Lunch at Kolachi")?.amount).toBe(-150000);

  // Delete needs a second tap that names the row
  await page.getByText("Lunch at Kolachi").click();
  await page.getByRole("button", { name: "Delete this unverified row" }).click();
  const confirm = page.getByRole("button", { name: /^Tap again: delete Rs 1,500/ });
  await expect(confirm).toBeVisible();
  await shot("delete-armed");
  await confirm.click();
  await expect.poll(() => live().some((t) => t.reason === "Lunch at Kolachi")).toBe(false);

  // Balance: a gap is offered as a missing transaction; moving the opening is separate and confirmed
  await page.goto("/#/wallet/nayapay");
  await page.getByRole("button", { name: "Check against the bank app" }).click();
  await page.getByLabel("NayaPay app shows").fill("1");
  await expect(page.getByRole("button", { name: /^Save and add the missing/ })).toBeVisible();
  await shot("balance-gap");
  await page.getByRole("button", { name: /^Save Rs 1/ }).click();
  await page.getByRole("button", { name: "Check against the bank app" }).click();
  await page.getByTestId("typed-balances").getByRole("button", { name: "Remove" }).first().click();
  await page.getByTestId("typed-balances").getByRole("button", { name: "Tap again" }).first().click();
  await expect
    .poll(() => world.server.dataset().balances.filter((b) => b.source === "manual").length)
    .toBe(0);
  await page.getByRole("button", { name: "Close" }).click();

  // Rules: tap to edit, delete asks twice
  await page.goto("/#/settings");
  await page.getByText("Categories and rules").click();
  const before = world.server.dataset().rules.length;
  await page.getByRole("button", { name: "cycle hub Indulgences" }).click();
  await expect(page.getByRole("button", { name: /^Save rule/ })).toBeVisible();
  await shot("rule-edit");
  await page.getByRole("button", { name: "Delete rule" }).click();
  await page.getByRole("button", { name: /^Tap again: delete/ }).click();
  await expect.poll(() => world.server.dataset().rules.length).toBe(before - 1);
});
