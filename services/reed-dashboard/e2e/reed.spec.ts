import { expect, Page, test } from "@playwright/test";

const PASSWORD = "reed-demo";

async function login(page: Page, user: string, hash = "") {
  await page.context().clearCookies(); // drop the previous Keycloak session
  await page.goto(`/?e2e=${Date.now()}#/${hash}`);
  await page.locator("#username").fill(user);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#kc-login").click();
  await expect(page.locator(".org-btn")).toBeVisible();
}

test("buyer posts an RFQ, supplier accepts, EDC contract confirms the match", async ({ page }) => {
  const title = `E2E hub casting ${Date.now()}`;

  // 1. Nordvind's buyer posts an RFQ through the form (no LLM needed).
  await login(page, "nordvind-buyer", "marketplace");
  await page.getByRole("button", { name: "Post an RFQ" }).click();
  const form = page.locator("form.form");
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Material").fill("EN-GJS-400-18-LT");
  await form.getByLabel("Length in metres").fill("4.2");
  await form.getByLabel("Width in metres").fill("4.0");
  await form.getByLabel("Height in metres").fill("3.6");
  await form.getByLabel("Mass per part (t)").fill("38");
  await form.getByLabel("Tolerance (± mm, optional)").fill("2");
  await form.getByLabel("Quantity").fill("4");
  await form.getByLabel("Needed by").fill(new Date(Date.now() + 40 * 7 * 864e5).toISOString().slice(0, 10));
  await form.locator("fieldset.chip-picker").nth(0).getByRole("button", { name: "sand-casting", exact: true }).click();
  await form.locator("fieldset.chip-picker").nth(0).getByRole("button", { name: "heat-treatment", exact: true }).click();
  await form.locator("fieldset.chip-picker").nth(1).getByRole("button", { name: "DNV", exact: true }).click();
  await form.getByRole("button", { name: "Post RFQ and rank suppliers" }).click();

  // 2. Ranking: Castellum first; Śląsk filtered out for size, mass and an unverified DNV claim.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const top = page.locator(".rank-row.top");
  await expect(top).toContainText("Castellum Fundición");
  const slask = page.locator(".rejected-row", { hasText: "Śląsk Odlewnia" });
  await expect(slask).toContainText("Part too heavy");
  await expect(slask).toContainText("only self-declared");
  const rfqId = page.url().split("/").pop()!;
  await top.getByRole("button", { name: "Shortlist" }).click();
  await expect(top).toContainText("Waiting for");

  // 3. Castellum's engineer accepts under Opportunities (sees only its own score).
  await login(page, "castellum-engineer", "opportunities");
  const opp = page.locator(".rank-row", { hasText: title });
  await opp.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Accepted - the buyer can now contract")).toBeVisible();

  // 4. Buyer contracts for the confidential capability over EDC (DCP credentials) and REED confirms.
  await login(page, "nordvind-buyer", `matches/${rfqId}`);
  await page.locator(".rank-row.top").getByRole("button", { name: "Request capability via contract" }).click();
  await expect(page.locator(".flow-log")).toContainText("Contract agreed", { timeout: 90_000 });
  await expect(page.locator(".flow-log")).toContainText("Confidential payload received", { timeout: 90_000 });
  await expect(page.locator(".flow-log")).toContainText("Match confirmed", { timeout: 60_000 });
  await expect(page.locator(".rank-row.top .state")).toHaveText("Confirmed");
});

test("a non-member sees nothing it is not entitled to", async ({ page }) => {
  await login(page, "vagant-buyer");
  await expect(page.locator(".warn-box").first()).toContainText("not a member of the REED consortium");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Marketplace" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Catalogue" })).toHaveCount(0);
});

test("a supplier cannot see competitors' scores", async ({ page }) => {
  await login(page, "wisla-engineer", "matches/R1");
  await expect(page.locator(".notice")).toContainText("Only Nordvind Energy Systems AS sees the full ranking");
  await expect(page.locator(".rank-row")).toHaveCount(0);
});
