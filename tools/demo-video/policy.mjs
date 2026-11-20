// The REED policy walkthrough, done in the dashboard: onboarding, a capability with a compound policy, a service RFQ,
// matching on capability AND policy, selection -> contract with its effective policy, ODRL -> Rego, and Open Policy Agent
// allowing or denying a request at the provider's connector. Six steps, one take.
//
//   node tools/demo-video/policy.mjs && python3 tools/demo-video/mix.py tools/demo-video/out-policy
//   ONLY=s3,s4 node ...                 record some steps (debugging; s5 and s6 need s3 in the same take)
// Stack up and seeded. Re-takes are safe: a company or capability made by an earlier take is not made twice.
// Env: PIPER_PY, PIPER_VOICE, OUT (default tools/demo-video/out-policy)
import fs from "node:fs";
import path from "node:path";
import { UI, ROOT, init, label, segment, say, when, ff, hold, sleep, click, type, scrollTo, spot, login, go, tab, slide, part, run, unspot,
  page } from "./lib.mjs";   // page is a live binding, set by run()

const COMPANY = "Skagerrak Drivetrain AB";            // fictional, onboarded in step 1
const CAPABILITY = "Robot welding of steel frames";  // registered in step 2
const RFQ = "Pilot batch: precision housings";

const N = {
  welcome: ["Welcome. This video shows how REED controls who may use a manufacturing service and its data.",
    "A provider sets the rules. REED matches buyers against them. And the provider's own connector enforces them.",
    "We follow six steps, all done in the dashboard."],
  cast: ["Three companies take part. Nordic Manufacturing Provider offers CNC machining.",
    "Hanse, a German OEM, is the first buyer. An OEM is a maker of final products.",
    "Nordvind, a Norwegian OEM, is the second buyer. It runs its own machine shop, so providers class it as a competitor.",
    "The REED operator runs the data space. All companies here are fictional."],

  p1: ["Step one. REED onboards consortium organizations."],
  s1a: ["We log in as the REED operator, and open the Operator view.",
    "The Members tab lists every company, with the attributes that policies are checked against.",
    "Organisation type, country, industry, competitor classes, and membership status."],
  s1b: ["To onboard a company, click Onboard a company, and fill in its details."],
  s1c: ["The company is now registered as pending. REED knows it, but it is not a member yet."],
  s1d: ["Click Approve, and it becomes an active member."],
  s1e: ["The Connectors tab shows each company's connector, and its own policy decision point.",
    "That is an Open Policy Agent, OPA for short. Later, it will allow or deny each request."],

  p2: ["Step two. A provider publishes a capability with several policy conditions."],
  s2a: ["We log in as Nordic Manufacturing Provider, and open Capabilities.",
    "Its offer, Precision CNC Manufacturing, gives access to a real-time machine availability service."],
  s2b: ["The policy has five components: an OEM, an active member, located in the EU or EEA, not a competitor, and a pilot project.",
    "Below them is the combined policy: all five, joined with AND."],
  s2c: ["To offer something new, click Register a capability, and give it a name."],
  s2d: ["Then add the conditions one by one. Each click adds one.",
    "REED shows the combined policy straight away, exactly as it will be stored."],
  s2e: ["Register it, then publish it. From now on, buyers can be matched to it."],

  p3: ["Step three. A buyer creates a request for quotation."],
  s3a: ["We log in as Hanse, and open Service RFQs. Click Request a capability."],
  s3b: ["Hanse asks for CNC machining: five-axis, in titanium.",
    "The period and the purpose matter. They will become part of the contract."],
  s3c: ["Click Post and match."],

  p4: ["Step four. Matching looks at the capability, and at the policy."],
  s4a: ["Each provider is judged twice, separately.",
    "Column one: does the capability fit? Capability, technical requirements, capacity and region."],
  s4b: ["Column two: does the buyer satisfy the provider's policy?",
    "There is one line per condition, and the answer comes from Open Policy Agent."],
  s4c: ["Column three is the final answer. Hanse is eligible, and can select this provider."],
  s4d: ["Now the same request, from Nordvind."],
  s4e: ["The capability fits. But one policy condition fails: Nordvind is classed as a competitor.",
    "So Nordvind is not eligible, and there is no button to select this provider."],

  p5: ["Step five. Selecting a provider creates a contract, with a compound policy."],
  s5a: ["Back as Hanse, we open the request, and click Select this provider."],
  s5b: ["A draft contract appears. Its policy now has nine conditions.",
    "The provider's five, and four more: this buyer, the start, the end, and this purpose."],
  s5c: ["Click Accept the terms and conclude the contract.",
    "The two connectors negotiate, and REED checks their agreement."],
  s5d: ["The contract is active. The lifecycle shows each step so far.",
    "From the provider's definition, to the policy deployed at its connector."],

  p6: ["Step six. The policy becomes code, and decides every request."],
  s6a: ["The contract's policy is written in ODRL, a standard language for usage rules."],
  s6b: ["REED translates it into Rego, the language of Open Policy Agent. There is one rule per condition."],
  s6c: ["Now Hanse requests the data, but declares another purpose: production."],
  s6d: ["Denied. Nordic's connector asked its own Open Policy Agent, and the purpose condition failed."],
  s6e: ["With the agreed purpose, pilot evaluation, the request is allowed.",
    "The machine availability data arrives, through the two connectors."],
  s6f: ["Every decision under this contract is listed, with its conditions."],
  s6g: ["The operator sees all decisions in one log: who asked, the answer, and why."],

  end: ["To sum up.", "The provider defines the policy. REED matches on capability and on policy. The contract fixes the terms.",
    "And the provider's own connector allows or denies every request.", "Thank you for watching."],
};

init(N, { name: "reed-policy", unit: "Step", total: 6, learn: "You will see", out: "out-policy" });

// ---- state behind the camera: what an earlier take already made, and a clean slate for the contract
const PASSWORD = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment/roster.json"), "utf8")).dataspace.demoPassword;
async function rest(user, method, p, body) {
  const kc = await fetch(`${UI}/realms/reed/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "reed-cli", username: user, password: PASSWORD }) });
  const r = await fetch(`${UI}${p}`, { method, headers: { Authorization: `Bearer ${(await kc.json()).access_token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status}`);
  return r.json();
}
const company = (await rest("reed-admin", "GET", "/reed/participants")).find((p) => p.name === COMPANY);
if (company) await rest("reed-admin", "POST", `/reed/onboarding/${company.bpn}/status`, { status: "PENDING" });
const capability = (await rest("nordic-engineer", "GET", "/reed/offerings")).find((o) => o.name === CAPABILITY);
const closeContracts = async () => {
  for (const c of await rest("hanse-buyer", "GET", "/reed/contracts")) {
    if (!["TERMINATED", "EXPIRED"].includes(c.status)) await rest("hanse-buyer", "POST", `/reed/contracts/${c.id}/terminate`);
  }
};
await closeContracts();

let rfqPage, contractPage;   // a step's title card replaces the page: where to come back to
const here = () => page.url().split("#/")[1];
const btn = (name, exact = true) => page.getByRole("button", { name, exact });
const nordic = () => page.locator('.match3[data-offering="precision-cnc-nordic"]');
async function postRfq() {
  await click(btn("Request a capability"));
  await type(page.getByLabel("Title"), RFQ);
  await type(page.getByLabel("Technical requirements (keywords)"), "5-axis, titanium");
}

const steps = {
  async intro() {
    label("REED · policy-aware manufacturing services");
    segment(0, "introduction", "Introduction");
    await slide(`<div style="margin-top:80px"><div class="kick">Walkthrough</div><h1>Policies that are enforced</h1>
      <div class="sub">From a provider's rules to an allow or deny decision at its connector —<br>in six steps, in the REED dashboard</div></div>`);
    await say("welcome");
    await hold();
    const row = (flag, co, what, user) => `<div class="box" style="display:grid;grid-template-columns:44px 1.2fr 1.8fr 1fr;gap:10px;align-items:center;padding:11px 16px">
      <b style="margin:0">${flag}</b><b style="margin:0">${co}</b><span>${what}</span><span style="font-family:monospace;color:#ffc04d">${user}</span></div>`;
    await slide(`<h2>Who is who</h2><div class="grid" style="gap:10px">
      ${row("NO", "Nordic Manufacturing Provider", "provider · precision CNC machining", "nordic-engineer")}
      ${row("DE", "Hanse", "buyer A · OEM", "hanse-buyer")}
      ${row("NO", "Nordvind", "buyer B · OEM · classed as a competitor", "nordvind-buyer")}
      ${row("—", "Operator", "runs the data space", "reed-admin")}</div>
      <div class="sub" style="margin-top:18px;font-size:17px">OEM = maker of final products. Fictional companies.</div>`);
    await say("cast");
    await hold();
    const step = (n, t, d) => `<div class="box"><b><span class="num">${n}</span>${t}</b><span>${d}</span></div>`;
    await slide(`<h2>Six steps</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)">
      ${step(1, "Onboard", "REED onboards consortium organizations")}
      ${step(2, "Publish", "A capability with several policy conditions")}
      ${step(3, "Request", "A buyer creates an RFQ")}
      ${step(4, "Match", "Capability <span class='k'>and</span> policy")}
      ${step(5, "Contract", "Selection creates a contract and a compound policy")}
      ${step(6, "Enforce", "ODRL → Rego → OPA: allow or deny, before any data moves")}</div>`);
    await sleep(6000);
  },

  async s1() {
    await part(1, "onboarding", "REED onboards organizations", ["The attributes policies are checked against", "Register a company, then approve it", "Each company's connector and policy decision point"]);
    await login("reed-admin", "operator");
    await say("s1a");
    await when("s1a", "The Members tab");
    await spot(page.locator(".panel", { hasText: "Consortium members" }).locator("thead"), "The attributes policies use");
    await hold();
    await say("s1b");
    await click(btn("Onboard a company"));
    await type(page.getByLabel("Company name"), COMPANY);
    await type(page.getByLabel("Short name"), "Skagerrak");
    await type(page.getByLabel("Country (two letters)"), "SE");
    await type(page.getByLabel("City"), "Gothenburg");
    await type(page.getByLabel("Industry"), "drivetrains");
    await hold();
    await click(company ? btn("Cancel") : btn("Register"));   // a re-take does not register it twice
    const row = page.locator("tr", { hasText: COMPANY });
    await say("s1c");
    await spot(row, "Registered · PENDING");
    await hold();
    await say("s1d");
    await click(row.getByRole("button", { name: "Approve" }));
    await page.locator(".toast.ok").last().waitFor({ timeout: 30_000 });
    await spot(row, "ACTIVE member");
    await hold();
    await tab("Connectors");
    await say("s1e");
    await spot(page.locator("tr", { hasText: "nordic" }).first(), "Connector · its own Open Policy Agent");
    await hold();
  },

  async s2() {
    await part(2, "capability-and-policy", "A capability with a compound policy", ["The components of a provider's policy", "The combined policy: all conditions with AND", "Register and publish a capability"]);
    await login("nordic-engineer", "capabilities");
    const cnc = page.locator(".offering", { hasText: "Precision CNC Manufacturing" });
    await say("s2a");
    await spot(cnc.locator("header"), "Capability · resource: machine availability");
    await hold();
    await say("s2b");
    await spot(cnc.locator(".policy-parts"), "Five policy components");
    await when("s2b", "Below them");
    await spot(cnc.locator(".effective"), "Effective combined policy");
    await hold();
    await say("s2c");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await click(btn("Register a capability"));
    await type(page.getByLabel("Name", { exact: true }), CAPABILITY);
    const cap = page.getByLabel("Capability", { exact: true });
    await click(cap);
    await cap.fill("");
    await cap.pressSequentially("robot-welding", { delay: 30 });
    await hold();
    await say("s2d");
    const builder = page.locator(".form .builder");
    for (const c of ["OEMs only", "EU/EEA organisations only", "Non-competing organisations only"]) {
      await click(builder.getByRole("button", { name: `+ ${c}` }));
      await sleep(700);
    }
    await builder.getByLabel("Purpose of use").selectOption("production");
    await click(builder.getByRole("button", { name: "+ Purpose of use" }));
    await spot(builder.locator(".effective"), "The combined policy, live");
    await hold();
    await say("s2e");
    if (capability) {
      await click(btn("Cancel"));   // made by an earlier take
    } else {
      await click(btn("Register"));
      await page.locator(".toast.ok").last().waitFor({ timeout: 30_000 });
      const card = page.locator(".offering", { hasText: CAPABILITY });
      await scrollTo(card);
      await click(card.getByRole("button", { name: "Publish" }));
      await page.locator(".toast.ok").last().waitFor({ timeout: 60_000 });
    }
    await spot(page.locator(".offering", { hasText: CAPABILITY }).locator("header"), "Published");
    await hold();
  },

  async s3() {
    await part(3, "request-for-quotation", "A buyer creates an RFQ", ["Ask for a capability", "Requirements, period and purpose"]);
    await login("hanse-buyer", "service");
    await say("s3a");
    await postRfq();
    await say("s3b");
    await spot(page.locator(".form"), "Capability · requirements · period · purpose");
    await hold();
    await say("s3c");
    await click(btn("Post and match"));
    await nordic().waitFor({ timeout: 60_000 });
    rfqPage = here();
    await hold();
  },

  async s4() {
    await part(4, "capability-and-policy-match", "Matching: capability and policy", ["Capability match and policy eligibility, apart", "An eligible buyer", "A buyer that fails one condition"]);
    await go(rfqPage);
    await say("s4a");
    await when("s4a", "Column one");
    await spot(nordic().locator("section").nth(0), "1 · Capability match");
    await hold();
    await say("s4b");
    await spot(nordic().locator("section").nth(1), "2 · Policy eligibility (Open Policy Agent)");
    await hold();
    await say("s4c");
    await spot(nordic().locator(".match3-final"), "3 · Final: eligible");
    await hold();
    await say("s4d");
    await login("nordvind-buyer", "service");
    await ff("Nordvind posts the same request", async () => {
      await postRfq();
      await click(btn("Post and match"));
      await nordic().waitFor({ timeout: 60_000 });
    });
    await say("s4e");
    await spot(nordic().locator("section").nth(0), "Capability match: TRUE");
    await when("s4e", "The capability fits. But");
    await spot(nordic().locator("section").nth(1).locator("li.fail"), "The condition that failed");
    await when("s4e", "So Nordvind");
    await spot(nordic().locator(".match3-final"), "Not eligible · no select button");
    await hold();
  },

  async s5() {
    await part(5, "contract", "Selection creates a contract", ["Select an eligible provider", "The effective policy of the contract", "Accept the terms: the connectors negotiate"]);
    await login("hanse-buyer", "service");
    await say("s5a");
    await click(page.locator("tr.clickable", { hasText: RFQ }).first());
    await nordic().waitFor({ timeout: 60_000 });
    await click(nordic().getByRole("button", { name: "Select this provider" }));
    await page.locator(".view-head h1", { hasText: "DRAFT" }).waitFor({ timeout: 60_000 });
    await say("s5b");
    await spot(page.locator(".terms-grid .policy-parts"), "Nine conditions");
    await when("s5b", "The provider's five");
    await spot(page.locator(".terms-grid .effective"), "Provider's policy AND buyer AND period AND purpose");
    await hold();
    await say("s5c");
    await click(btn("Accept the terms and conclude the contract"));
    await ff("the two connectors negotiate", () => page.locator(".view-head h1", { hasText: "ACTIVE" }).waitFor({ timeout: 180_000 }));
    await say("s5d");
    await spot(page.locator(".rail"), "Policy lifecycle: defined → deployed to the connector");
    contractPage = here();
    await hold();
  },

  async s6() {
    await part(6, "odrl-rego-opa", "ODRL → Rego → OPA decides", ["The policy as ODRL, and as generated Rego", "A request that is denied, and why", "A request that is allowed", "The decision log"]);
    await go(contractPage);
    await page.locator(".terms-grid .policy-code").first().waitFor({ timeout: 30_000 });
    // by position: the Rego text itself mentions "ODRL policy"
    const code = (t) => page.locator(".terms-grid .policy-code").nth(t === "ODRL policy" ? 0 : 1);
    await say("s6a");
    await click(code("ODRL policy").locator("summary"));
    await spot(code("ODRL policy").locator("pre"), "ODRL: one constraint per condition, joined by and");
    await hold();
    await click(code("ODRL policy").locator("summary"));
    await say("s6b");
    await click(code("Generated Rego").locator("summary"));
    await spot(code("Generated Rego").locator("pre"), "Rego: one rule per condition");
    await code("Generated Rego").locator("pre").evaluate((e) => e.scrollTo({ top: 520, behavior: "smooth" }));
    await hold(1500);
    await click(code("Generated Rego").locator("summary"));
    const next = page.locator(".panel", { hasText: "Next step" });
    await scrollTo(next);
    await say("s6c");
    await page.getByLabel("Declared purpose").selectOption("production");
    await spot(next.locator(".row").first(), "Declared purpose: production");
    await hold();
    await click(btn("Request the data"));
    await ff("request through both connectors", () => page.getByTestId("request-result").waitFor({ timeout: 180_000 }));
    await say("s6d");
    await spot(page.getByTestId("request-result"), "DENY · the purpose condition failed");
    await hold();
    await say("s6e");
    await page.getByLabel("Declared purpose").selectOption("pilot-evaluation");
    await click(btn("Request the data"));
    await ff("request through both connectors", () => page.getByTestId("request-result").filter({ hasText: "ALLOW" }).waitFor({ timeout: 180_000 }));
    await spot(page.getByTestId("request-result"), "ALLOW · data released by Nordic's connector");
    await hold();
    await say("s6f");
    await spot(page.locator(".decisions"), "Decisions under this contract");
    await hold();
    await login("reed-admin", "operator");
    await tab("Policy decisions");
    await say("s6g");
    await spot(page.locator("tbody tr").first(), "Who asked · the answer · why");
    await click(page.locator("tbody tr", { hasText: "DENY" }).first());
    await hold(1500);
  },

  async outro() {
    label("REED · policy-aware manufacturing services");
    segment(7, "summary", "Summary");
    await slide(`<h2>What happened</h2><div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="box"><b>Design time</b><span>The provider defines a <span class="k">compound policy</span> and attaches it to a capability</span></div>
      <div class="box"><b>Matchmaking time</b><span>REED checks the <span class="k">capability</span> and the <span class="k">policy</span>, separately</span></div>
      <div class="box"><b>Contract time</b><span>The contract fixes the <span class="k">effective policy</span>: provider's rules, buyer, period, purpose</span></div>
      <div class="box"><b>Runtime</b><span>ODRL → Rego → the provider's own <span class="k">Open Policy Agent</span> allows or denies each request</span></div></div>`);
    await say("end");
    await hold(2500);
    await closeContracts();
  },
};

await run(steps);
