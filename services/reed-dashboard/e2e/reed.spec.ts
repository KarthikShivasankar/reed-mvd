import { expect, Page, Response, test } from "@playwright/test";

const PASSWORD = "reed-demo";

// The browser may reach only the dashboard's origin: on a remote host just that one port is forwarded
// (public sites such as the font CDN are fine). Any other local port would fail there.
let offOrigin: string[] = [];
test.beforeEach(async ({ context, baseURL }) => {
  offOrigin = [];
  await context.route(/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/, (r) =>
    r.request().url().startsWith(baseURL!) ? r.fallback() : (offOrigin.push(r.request().url()), r.abort()));
});
test.afterEach(() => expect(offOrigin).toEqual([]));

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

test("ids from links cannot steer requests to other endpoints", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/reed/")) calls.push(r.url()); });
  await login(page, "nordvind-buyer", "matches/..%2F..%2Fconnectors%2Fnordvind%2Fv3%2Fassets");
  await expect(page.getByText("to see its ranked suppliers")).toBeVisible(); // falls back to the RFQ picker
  expect(calls.filter((u) => u.includes("/connectors/"))).toHaveLength(0);
});

test("Komatsu is labelled as an illustrative, real company", async ({ page }) => {
  await login(page, "komatsu-buyer", "participants");
  const card = page.locator("article.member", { hasText: "Komatsu Mining Germany GmbH" });
  await expect(card).toContainText("Real company, illustrative only");
  await expect(card.locator(".cert")).toHaveCount(0); // no certifications claimed
});

test("every view loads for every role", async ({ page }) => {
  for (const user of ["nordvind-buyer", "castellum-engineer", "rhein-auditor", "nordvind-quality", "vagant-buyer", "reed-admin"]) {
    const failures: string[] = [];
    const onResponse = (r: Response) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); };
    const onError = (e: Error) => failures.push(`page error: ${e.message}`);
    page.on("response", onResponse);
    page.on("pageerror", onError);
    await login(page, user);
    const views = await page.getByRole("navigation", { name: "Main" }).getByRole("link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const v of views) {
      await page.goto("/" + v);
      await page.waitForLoadState("networkidle");
    }
    page.off("response", onResponse);
    page.off("pageerror", onError);
    expect(failures, user).toEqual([]);
  }
});

test("shop floor: live sensors over MQTT, history, operator observations and the shift briefing", async ({ page }) => {
  await login(page, "castellum-engineer", "factory");
  await expect(page.locator(".machine")).toHaveCount(3);
  await expect(page.locator(".tile")).toHaveCount(6);
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  // the simulated devices publish every 5 s: a tile's reading time moves on without a reload
  const foot = page.locator(".tile .tile-foot").first();
  await expect(foot).toContainText(":");
  const before = await foot.textContent();
  await expect(foot).not.toHaveText(before!, { timeout: 15_000 });

  // 7 days of history, as a chart and as a table
  await page.locator(".tile", { hasText: "Shell temperature" }).click();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.locator(".chart .series")).toBeVisible();
  await expect(page.locator(".chart .limit-label")).toContainText("upper limit 140");
  await page.getByRole("button", { name: "Table" }).click();
  await expect.poll(() => page.locator(".table-scroll tbody tr").count()).toBeGreaterThan(150);

  // a second dashboard of the same company gets the observation live (MQTT/stream path, no reload)
  const other = await page.context().newPage();
  await other.goto("/#/factory");
  await expect(other.getByText("live", { exact: true })).toBeVisible();

  const note = `E2E ${Date.now()}: oil dripping under the moulding line conveyor`;
  await page.locator("#obs-text").fill(note);
  await page.locator("form", { has: page.locator("#obs-text") }).getByLabel("Machine").selectOption("moulding-1");
  await page.getByRole("button", { name: "Log observation" }).click();
  await expect(page.locator(".obs", { hasText: note })).toContainText("Moulding line", { timeout: 150_000 });
  await expect(other.locator(".obs", { hasText: note })).toBeVisible({ timeout: 15_000 });
  await other.close();

  await page.getByRole("button", { name: "Brief me" }).click();
  await expect(page.locator(".briefing-head")).not.toBeEmpty({ timeout: 150_000 });
  await expect(page.locator("ol.briefing li").first()).toBeVisible();
});

test("a company sees only its own shop floor", async ({ page }) => {
  await login(page, "wisla-engineer", "factory");
  await expect(page.locator(".view-head")).toContainText("Gdańsk demo machining cell");
  await expect(page.locator(".tile")).toHaveCount(3);
  await expect(page.getByText("Bilbao")).toHaveCount(0);

  await login(page, "nordvind-buyer");  // an OEM without a line: no Factory view
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Factory" })).toHaveCount(0);
});

/** Puts an asset's terms back through the API (password grant on the demo reed-cli client), whatever the test did. */
async function restoreTerms(page: Page, user: string, assetId: string, discoverability: string, policyTemplate: string) {
  const kc = await page.request.post("/realms/reed/protocol/openid-connect/token", {
    form: { grant_type: "password", client_id: "reed-cli", username: user, password: PASSWORD },
  });
  const { access_token } = await kc.json();
  const res = await page.request.put(`/reed/assets/${assetId}/policy`, {
    headers: { Authorization: `Bearer ${access_token}` }, data: { discoverability, policyTemplate },
  });
  expect(res.status()).toBe(200);
}

test("an owner previews and publishes its terms, and the other side's connector enforces them", async ({ page }) => {
  try {
    await login(page, "castellum-engineer", "dataspace");
    await expect(page.locator(".panel-head", { hasText: "Who gets Castellum's data" })).toBeVisible();
    await page.locator(".board-asset", { hasText: "Process Capability" }).click();
    await page.locator("#tmpl").selectOption("eu-member-states");
    // a what-if preview first: nothing is published yet
    const preview = page.locator(".panel", { hasText: "If you publish" });
    await expect(preview.locator("li", { hasText: "Nordvind" })).toContainText("registered in NO, but the policy needs registered seat in the EU");
    await expect(preview.locator("li", { hasText: "Hanse" })).toContainText("gets a contract");
    await page.getByRole("button", { name: "Publish to my connector" }).click();
    await expect(page.locator(".toast.ok")).toContainText("Published to Castellum's connector: 4 companies' access changed");

    // Nordvind (Norway: EEA, not EU) now sees the refusal coming, and Castellum's connector does refuse it
    await login(page, "nordvind-buyer", "dataspace");
    await page.getByRole("tab", { name: "What I can get" }).click();
    await expect(page.locator(".wallet")).toContainText("OEM");
    const offer = page.locator("li.offer", { hasText: "Process Capability - Castellum" });
    await expect(offer).toContainText("Castellum will refuse: registered in NO");
    await offer.getByRole("button", { name: "Try anyway" }).click();
    await expect(offer.locator(".error-box")).toContainText("Refused by Castellum's connector", { timeout: 90_000 });
    await expect(offer.locator(".error-box")).toContainText("MembershipCredential.country");
  } finally {
    await restoreTerms(page, "castellum-engineer", "process-capability-castellum", "consortium", "oem-only");
  }
});

test("a requester gets a contract and a watermarked payload live from the Data space view", async ({ page }) => {
  await login(page, "castellum-engineer", "dataspace");
  await page.getByRole("tab", { name: "What I can get" }).click();
  // Castellum supplies Nordvind: it finds Nordvind's bilateral bill of material, a company without that relation would not
  const offer = page.locator("li.offer", { hasText: "Bill of Material - Nordvind" });
  await offer.getByRole("button", { name: "Get it" }).click();
  await expect(offer.locator(".ok-box")).toContainText("payload received through Nordvind's data plane", { timeout: 120_000 });
  await expect(offer.locator(".wallet.compact")).toContainText("BPN-REED-SUP-0002");

  await login(page, "hanse-buyer", "dataspace");
  await page.getByRole("tab", { name: "What I can get" }).click();
  await expect(page.locator(".panel", { hasText: "From Nordvind" })).toBeVisible();
  await expect(page.getByText("Bill of Material - Nordvind")).toHaveCount(0);
});

test("the operator looks as any company but cannot change its terms", async ({ page }) => {
  await login(page, "reed-admin", "dataspace");
  await page.getByLabel("Look as").selectOption("wisla");
  await expect(page.locator(".panel-head", { hasText: "Who gets Wisła's data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish to my connector" })).toHaveCount(0);
  await expect(page.getByText("Only Wisła can change these terms")).toBeVisible();
  await page.getByRole("tab", { name: "Cross-border stories" }).click();
  await expect(page.locator(".story")).toHaveCount(8);
  await page.locator(".story", { hasText: "EU-programme results" }).getByRole("button", { name: "Predict" }).click();
  await expect(page.locator(".story", { hasText: "EU-programme results" })).toContainText("REED predicts is refused");
});

test("toy factory: a fault sent from the dashboard raises an alarm in real time, maintenance clears it", async ({ page }) => {
  await login(page, "castellum-engineer", "factory");
  const controls = page.locator(".line-controls");
  await controls.getByLabel("Machine").selectOption("fettling-1");
  await controls.getByLabel("Sensor").selectOption("spindle-vibration");
  await page.getByRole("button", { name: "Inject spike" }).click();
  await expect(page.locator(".toast.ok")).toContainText("spike fault on Fettling CNC");
  await expect(page.locator(".control-log")).toContainText("spike fault on Fettling CNC");
  // the devices react within one reading (5 s); REED's minute-by-minute analysis raises the alarm
  await expect(page.locator(".tile", { hasText: "Spindle vibration" })).toContainText("Alarm", { timeout: 150_000 });
  await page.getByRole("button", { name: "Maintain Fettling CNC" }).click();
  await expect(page.locator(".toast.ok").last()).toContainText("maintenance on Fettling CNC");
  await expect(page.locator(".tile", { hasText: "Spindle vibration" })).not.toContainText("Alarm", { timeout: 180_000 });
});
