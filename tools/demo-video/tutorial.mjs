// The REED video tutorial: eight numbered parts explaining the concepts (onboarding, the three policy layers, an owner
// changing a policy, contract + exchange, policy types, live factory data, matchmaking, refusals + tests).
// Everything shown runs for real; mix.py speeds up the marked waits and cuts one video per part.
//
//   node tools/demo-video/tutorial.mjs      (stack up + seeded; roster without the newcomer: the video onboards it)
//   ONLY=p2,p3 node ...                     record some parts (debugging; skips onboarding's wipe and re-seed)
// Env: PIPER_PY (python with piper-tts), PIPER_VOICE (.onnx), OUT (default tools/demo-video/out)
import fs from "node:fs";
import path from "node:path";
import { HERE, ROOT, ONLY, init, label, segment, say, when, ff, hold, sleep, click, type, scrollTo, spot, login, go, tab, api, sh,
  slide, part, takeaways, run, page } from "./lib.mjs";   // page is a live binding, set by run()

// ------------------------------------------------------------------------------------------------ narration
// One sentence per entry: each becomes its own caption, shown while it is spoken.
const N = {
  welcome: ["Welcome to this tutorial on REED.", "REED is a data space for European makers of large industrial parts, such as wind turbine hubs, ship parts and rail components.", "Today, drawings and quality data go out by e-mail, and you lose track of where they end up.", "In REED, the owner decides who may see what, and every delivered copy carries the owner's licence.", "Everything you will see runs for real, on a local installation."],
  agenda: ["The tutorial has eight short parts.", "We onboard a new company, name the three kinds of policy, and change a policy to watch it being enforced.", "Then we exchange data under a contract, compare policy types, share live factory data, match a buyer with a supplier, and finish with refusals and automated tests."],
  glossary: ["First, four words you will hear.", "A connector is the software each company runs to offer data, and to fetch it.", "A verifiable credential is a signed digital certificate about a company, such as its role, its country, or an ISO certificate.", "A policy is a rule that the data owner sets.", "And a contract is what two connectors sign before any data moves."],
  arch: ["Here is how the pieces fit together.", "Each company has three things: a connector, an identity hub that holds its credentials like a wallet, and a data store.", "An issuer signs the credentials, after the facts have been checked.", "The REED service in the middle helps companies find each other, but it never stores anyone's data.", "A local AI model helps with text, and only ever sees company and part data."],
  invariant: ["One rule holds everywhere.", "A company may see that data exists, if the owner allows it.", "But the data itself moves only after the two connectors have signed a contract.", "And on every request, the connector checks the other company's credentials."],

  p1: ["Part one. Onboarding a new company.", "We add a company, give it an identity and credentials, and let it fetch data straight away."],
  on1: ["Everything about the members is in one file, the roster.", "We add Kvarken Forgeworks, a made-up forge in Vaasa, Finland.", "It is a supplier, it has ISO 9001 and DNV certificates, and it supplies the German manufacturer Hanse."],
  on2: ["Next, a generator reads the roster and creates everything the new company needs.", "Its own connector, its own identity hub, its own key store, a database, and user accounts."],
  on3: ["Now we start the whole data space from zero, with empty databases.", "This takes a few minutes, so we speed it up."],
  on4: ["Each company now has a DID: a digital identity that anyone can look up.", "The issuer signed three credentials for each member: membership, certificates, and supply relations.", "In real life the operator checks the certificates first. Here, the roster stands in for those checks."],
  on5: ["Each company has now published its offers on its own connector.", "Only descriptions and rules are published. The data itself stays at home."],
  on6: ["Kvarken's engineer has logged in.", "The badge shows what Kvarken's credentials prove: its DID, its role, its country and its verified certificates."],
  on7: ["In the member list, Kvarken now appears with its certificates verified.", "Komatsu is a real company, shown for illustration only."],
  on8: ["Because Kvarken supplies Hanse, it can already find Hanse's bill of material.", "That is an access policy at work: only Hanse's suppliers can even find this offer.", "Let's click Get it."],
  on9: ["Kvarken's connector showed its credentials, and a contract policy checked them before signing.", "Then the data was fetched.", "It arrives with a usage policy: licensed to Kvarken, not to be passed on, and watermarked.", "A new member exchanged data within minutes of joining."],
  t1: ["To sum up part one.", "One roster entry is enough to join.", "The issuer, not the company, vouches for the facts.", "And the new member can sign contracts straight away."],

  p2: ["Part two. The three layers of policy.", "You just saw three kinds of rule at work. Let's name them."],
  pol1: ["The first layer is the access policy.", "It answers: who may even find this offer?", "The choices are every member, only direct supply partners, or only partners in a shared project.", "If a company fails this check, the offer is simply invisible to it."],
  pol2: ["The second layer is the contract policy.", "It answers: who may sign a contract?", "Its conditions refer to credentials: the company's role, its country, its certificates, or its supply relations.", "If a company fails, the negotiation stops, and the error names the condition that failed."],
  pol3: ["The third layer is the usage policy.", "It answers: what may the company do with the data afterwards?", "For example: do not pass it on, every use is logged, delete it when the pilot ends.", "The owner picks these limits together with the contract policy.", "They are stamped onto the data when it is delivered, with a watermark."],
  pol4: ["How are these rules checked?", "Each connector runs small rules, written in a language called CEL, against the credentials the other company shows.", "REED keeps a copy of the same logic, so an owner can preview a change before publishing it.", "But the connectors always have the final say."],
  pol5: ["Here are the ready-made contract policies.", "OEM means a manufacturer that builds the final product, such as a wind turbine.", "oem-only lets only manufacturers sign.", "eu-member-states lets only companies registered in the EU sign.", "no-competing-suppliers keeps other suppliers out.", "dnv-certified needs a verified DNV certificate.", "And offshore-oem-eea needs three things at once."],
  pol6: ["Each kind of data gets sensible defaults.", "A bill of material is confidential, and shared only with direct suppliers.", "Production status is shared only within a project, for a limited time."],
  pol7: ["Now let's look inside Castellum's connector, at what was actually published.", "You don't need to read the code. Here is what it says, in plain words.", "Each offer is guarded by one access policy and one contract policy."],
  pol8: ["The access policy called bilateral says: only companies with a supply link to Castellum may find it.", "The contract policy oem-only says: the signer's role must be OEM.", "Usage limits are not checked here. They are stamped onto the data when it is delivered."],
  pol9: ["And this is the rule the connector actually runs for the role.", "In plain words: take the membership credential the other company showed, and compare its role."],
  t2: ["To sum up part two.", "The access policy decides who finds the data.", "The contract policy decides who may sign.", "And the usage policy decides what happens afterwards."],

  p3: ["Part three. An owner changes a policy, and we watch it being enforced."],
  set1: ["We are logged in as Castellum's data manager, the person allowed to set Castellum's terms.", "This board has one row per company and one column per offer.", "Each cell has two lights. The first: can that company find the offer? The second: would it get a contract?"],
  set2: ["Let's open Castellum's process capability.", "It uses oem-only.", "So the manufacturers Nordvind, Hanse and Komatsu get a contract, and the other companies are refused because of their role."],
  set3: ["Now Castellum changes the contract policy to eu-member-states.", "This is only a preview. Nothing is published yet.", "Nordvind is a Norwegian company. Norway is in the European Economic Area, but not in the EU.", "So Nordvind's second light turns orange: it can still find the offer, but cannot sign.", "The EU companies now get a contract."],
  set4: ["Castellum publishes the change.", "REED sends the new policy to Castellum's own connector.", "Only Castellum's data manager can do this."],
  set5: ["Now we look through the eyes of Nordvind's buyer.", "The offer already warns that Castellum will refuse.", "Let's try anyway. This is a real request between the two connectors."],
  set6: ["Castellum's connector refused.", "The reason names the condition that failed: the country in Nordvind's membership credential."],
  set6b: ["Nordvind's own connector recorded the same refusal."],
  set7: ["Contracts that were already signed keep their old terms.", "Castellum now switches back to oem-only."],
  t3: ["To sum up part three.", "The owner previews, then publishes to its own connector.", "The other side's connector enforces the rule at once.", "And a refusal always says why."],

  p4: ["Part four. A successful contract and data exchange, step by step."],
  ex1: ["We are Castellum again, now as the company asking for data.", "This panel shows what Castellum's credentials prove: a supplier from Spain, with ISO 9001, DNV and PED certificates, and a supply relation with Nordvind."],
  ex1b: ["Below are only the offers Castellum is allowed to find.", "Nordvind's bill of material is here because Castellum supplies Nordvind."],
  ex2: ["Let's click Get it, and watch the steps on the button.", "First it reads Nordvind's list of offers. Then both connectors sign a contract.", "Then it gets a one-time key, and uses it to fetch the data."],
  ex3: ["Done. Nordvind's data store released the data only after REED confirmed the contract.", "The data carries a licence: who it is for, which contract, and what is not allowed.", "It also carries a watermark, so a leak can be traced back."],
  ex3b: ["Here is the data itself, with the licence block inside it."],
  ex4: ["On Nordvind's connector, the signed contract names both companies, and keeps the exact policy that was signed."],
  ex5: ["The audit trail records each delivery: who received the data, and under which contract."],
  t4: ["To sum up part four.", "No contract, no data.", "And every delivery is licensed, watermarked and logged."],

  p5: ["Part five. Different policy types, side by side."],
  st1: ["These eight stories each use a different policy.", "For example: EEA versus EU, keeping competitors out, requiring a DNV certificate, or three conditions at once.", "The data space operator, who runs REED, can ask it to predict who will get a contract."],
  st2: ["Now we run all eight stories for real, against the connectors.", "FINALIZED means a contract was signed. TERMINATED means refused. HIDDEN means the offer could not even be found."],
  st3: ["Every result matches the prediction.", "Norway is refused under EU membership, but accepted under EEA residency.", "A competing supplier is refused because of its role.", "A company without DNV is refused because of its certificate.", "With three conditions, only Hanse qualifies.", "And with supply-partner terms, companies without a relation do not even see the offer."],
  t5: ["To sum up part five.", "Every policy is a check on credentials.", "Conditions can be combined.", "And REED's predictions match what the connectors do."],

  p6: ["Part six. Sharing live factory data under a contract."],
  fa1: ["Castellum has a simulated casting line with three machines.", "The sensors send readings every five seconds, and REED checks the trends every minute."],
  fa2: ["We inject a fault: a vibration spike on the fettling machine.", "Within a minute, the tile turns to Alarm."],
  fa3: ["Nordvind and Castellum share a pilot project.", "That is the shared-project access rule from part two, here with an end date.", "So Nordvind can contract for Castellum's live production status."],
  fa3b: ["The data shows the line right now, including the alarm, and the licence ends with the pilot."],
  fa4: ["Operators' notes may contain personal data, so REED removes it before any AI reads them.", "Here a note includes a phone number.", "The number is removed, and the local model tags the machine, the category and the severity."],
  fa5: ["Maintenance clears the fault."],
  t6: ["To sum up part six.", "Live data follows the same rules: a contract first, with limits that travel with the data."],

  p7: ["Part seven. Finding a supplier, and confirming it with a contract."],
  mm1: ["Nordvind needs twelve rotor hubs for an offshore wind farm.", "REED first filters out suppliers that cannot make the part, then ranks the rest on six criteria.", "Lead time, tolerance, transport, track record, sector experience, and carbon footprint."],
  mm1b: ["Suppliers that were filtered out show the reason, for example a certificate that is only self-declared."],
  mm2: ["Nordvind shortlists Castellum.", "Castellum must agree before any of its confidential data moves. Its engineer accepts."],
  mm3: ["Castellum's real capacity and tolerances are confidential, so they come only under a contract.", "REED fetches them on Nordvind's behalf, checks them against the request, and confirms the match.", "Nothing is stored."],
  t7: ["To sum up part seven.", "A match is confirmed only with data received under a contract."],

  p8: ["Part eight. Refusals, and the automated tests."],
  ng1: ["Vagant Components is not a member, so it holds no credentials.", "It sees nothing, and cannot post requests."],
  ng2: ["Hanse tries to change Castellum's terms. REED answers: not found. Hanse cannot even learn that the offer exists.", "A Nordvind auditor tries too, and is refused: only the data manager may change terms."],
  ng3: ["Finally, the automated end-to-end check.", "It signs a contract, fetches watermarked data, checks two refusals, and checks that nobody can sneak extra commands through REED."],
  ng3b: ["Every line says PASS."],
  t8: ["To sum up part eight.", "Only an owner's data manager can change its terms, and the tests prove that the whole flow works."],

  outro: ["That is REED.", "Companies join with verifiable credentials.", "Each owner decides who may find, who may sign, and what may be done with its data.", "And data moves only under a contract, with a licence, a watermark and an audit record.", "Thank you for watching."],
};

init(N, { name: "reed-tutorial", unit: "Part", total: 8, out: "out" });

// ------------------------------------------------------------------------------------------------ parts
const NEWCOMER = fs.readFileSync(path.join(HERE, "newcomer.json"), "utf8");
const parts = {
  async p0() {
    label("REED · video tutorial");
    segment(0, "introduction", "Introduction", ["full"]);
    await slide(`<div style="margin-top:90px"><div class="kick">Video tutorial</div><h1>REED</h1>
      <div class="sub">A European manufacturing data space with matchmaking<br>for large industrial parts: wind · offshore · rail · hydropower</div></div>`);
    await say("welcome");
    await hold();
    const titles = ["Onboarding a new company", "The three layers of policy", "Changing a policy, watching it enforced", "Contract and data exchange",
      "Policy types side by side", "Live factory data under a contract", "Matchmaking backed by a contract", "Refusals and automated tests"];
    await slide(`<h2>What this tutorial covers</h2><div class="grid" style="grid-template-columns:1fr 1fr">${titles.map((t, i) =>
      `<div class="box" style="font-size:20px"><span class="num">${i + 1}</span>${t}</div>`).join("")}</div>`);
    await say("agenda");
    await hold();
    await slide(`<h2>Four words you will hear</h2><div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="box" id="g1"><b>Connector</b><span>The software each company runs to offer data and to fetch it.</span></div>
      <div class="box" id="g2"><b>Verifiable credential</b><span>A signed digital certificate about a company: its role, its country, an ISO certificate, a supply relation.</span></div>
      <div class="box" id="g3"><b>Policy</b><span>A rule the data owner sets: who may find, who may sign, what may be done afterwards.</span></div>
      <div class="box" id="g4"><b>Contract</b><span>What two connectors sign before any data moves.</span></div></div>
      <div class="sub" style="margin-top:22px;font-size:18px">Other terms are explained when they first appear.</div>`);
    await say("glossary");
    for (const [i, p] of [[1, "A connector"], [2, "A verifiable"], [3, "A policy"], [4, "And a contract"]]) { await when("glossary", p); await spot(page.locator(`#g${i}`)); }
    await hold();
    await slide(`<h2>How the pieces fit together</h2>
      <div class="grid" style="grid-template-columns:1fr 56px 1fr 56px 1fr">
        <div class="box" id="a1"><b>Company A</b><span><span class="tag">Connector</span> offers + fetches data<br><span class="tag">Identity hub</span> its credentials, like a wallet<br><span class="tag">Data store</span> its own data, stays at home</span></div>
        <div class="arrow">⇄<br><span style="font-size:12px">contracts<br>+ data</span></div>
        <div class="box"><b>Company B</b><span><span class="tag">Connector</span><br><span class="tag">Identity hub</span><br><span class="tag">Data store</span></span></div>
        <div class="arrow">⇠<br><span style="font-size:12px">signs</span></div>
        <div class="box" id="a2"><b>Issuer</b><span>Signs credentials:<br>membership (role, country)<br>certificates · supply relations</span></div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:18px">
        <div class="box" id="a4"><b>REED service</b><span>Helps companies find each other, previews policies, keeps the audit trail. <span class="k">Stores no one's data.</span></span></div>
        <div class="box" id="a5"><b>Local AI model</b><span>Helps with text. Sees company and part data only.</span></div>
      </div>`);
    await say("arch");
    for (const [id, p] of [["a1", "Each company"], ["a2", "An issuer"], ["a4", "The REED service"], ["a5", "A local"]]) { await when("arch", p); await spot(page.locator(`#${id}`)); }
    await hold();
    await slide(`<div style="margin-top:110px;text-align:center"><div class="kick">The one rule</div><h2 style="font-size:46px;line-height:1.25">You may see that data exists —<br><span class="k">but you receive it only after a contract.</span></h2>
      <div class="sub">And every connector checks the other company's credentials on every request.</div></div>`);
    await say("invariant");
    await hold();
  },

  async p1() {
    await part(1, "onboarding", "Onboarding a new company", ["How a company joins with one roster entry", "How it gets a DID and signed credentials", "That it can sign a contract minutes later"]);
    const roster = path.join(ROOT, "deployment/roster.json");
    const s = fs.readFileSync(roster, "utf8");
    if (!s.includes("BPN-REED-SUP-0013")) {
      const anchor = '    {\n      "bpn": "BPN-REED-SUP-0006"';
      if (!s.includes(anchor)) throw new Error("roster anchor not found");
      fs.writeFileSync(roster, s.replace(anchor, NEWCOMER + anchor));
    }
    await say("on1");
    await sh("git diff --unified=0 deployment/roster.json | grep '^+' | grep -v '^+++' | sed 's/^+//' | grep -v 'confidentialCapability\\|machines\\|^      }' | head -24",
      { show: "git diff deployment/roster.json", note: "Step 1 · the new company's entry in the roster" });
    await hold(1500);
    await say("on2");
    await sh("python3 tools/gen_topology.py | grep -i 'kvarken\\|topology'", { show: "python3 tools/gen_topology.py", note: "Step 2 · generate the configuration of every service" });
    await hold(1500);
    if (!ONLY) {
      await say("on3");
      await ff("restarting the data space", async () => {
        await sh("docker compose -f deployment/docker-compose.yml down -v 2>&1 | tail -4", { show: "docker compose down -v", note: "Step 3 · wipe everything and start from zero" });
        await sh("docker compose -f deployment/docker-compose.yml up --build -d 2>&1 | grep -i 'kvarken\\|started' | tail -12", { show: "docker compose up -d" });
      });
      await ff("creating DIDs and issuing credentials", () => sh("./seed-identity.sh", { note: "Step 4 · create each company's DID and issue its credentials" }));
      await say("on4");
      await ff("publishing each company's offers", () => sh("./seed-reed.sh 2>&1 | grep -v '^  200' ", { show: "./seed-reed.sh", note: "Step 5 · publish each company's offers and policies on its own connector" }));
      await say("on5");
      await sleep(20_000); // federated catalogue crawl + factory backfill
    }
    await login("kvarken-engineer");
    await say("on6");
    await click(page.locator(".org-btn"));
    await spot(page.locator(".org-pop"), "Kvarken's identity, proven by credentials");
    await hold();
    await click(page.locator(".org-btn"));
    await say("on7");
    await go("participants");
    await spot(page.locator("article.member", { hasText: "Kvarken" }), "The new member");
    await sleep(4500);
    await spot(page.locator("article.member", { hasText: "Komatsu" }), "Illustrative only");
    await hold();
    await say("on8");
    await go("dataspace");
    await tab("What I can get");
    const offer = page.locator("li.offer", { hasText: "Bill of Material - Hanse" });
    await spot(offer, "Only Hanse's suppliers find this");
    await hold(-1500);
    await click(offer.getByRole("button", { name: "Get it" }));
    await ff("contract and transfer running", () => offer.locator(".ok-box").waitFor({ timeout: 120_000 }));
    await say("on9");
    await spot(offer.locator(".ok-box"), "Contract signed · data received");
    await sleep(6000);
    await spot(offer.locator(".wallet.compact"), "Licence + watermark");
    await hold();
    await takeaways(1, ["One roster entry: connector, identity hub, vault folder, accounts", "The issuer — not the company — vouches for role and certificates", "A new member can sign a contract straight away"]);
  },

  async p2() {
    await part(2, "policy-layers", "The three layers of policy", ["Who may find data — the access policy", "Who may sign — the contract policy", "What they may do — the usage policy"]);
    await slide(`<h2>Every offer carries three layers of policy</h2>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="box" id="l1"><b><span class="num">1</span>Access policy</b><span><span class="k">Who may find it?</span><br><br>every member · direct supply partners · shared project<br><br>Checked by the owner's connector on every catalogue request.<br><br><b style="display:inline">If not: the offer is invisible.</b></span></div>
        <div class="box" id="l2"><b><span class="num">2</span>Contract policy</b><span><span class="k">Who may sign?</span><br><br>Conditions on credentials: role · country · certificate · supply relation<br><br>Checked by the owner's connector during the negotiation.<br><br><b style="display:inline">If not: refused, naming the condition.</b></span></div>
        <div class="box" id="l3"><b><span class="num">3</span>Usage policy</b><span><span class="k">What may they do?</span><br><br>no passing on · log every use · delete when the pilot ends<br><br>Enforced when the owner's data service hands the data over.<br><br><b style="display:inline">Licence stamp + watermark + audit.</b></span></div>
      </div>
      <div class="box" id="l4" style="margin-top:16px"><b>How they are checked</b><span>Each connector runs CEL rules over the credentials the other side presents (equals · not equals · is any of · is none of).
        REED mirrors the rules to preview changes — <span class="k">the connectors have the final say</span>.</span></div>`);
    for (const k of ["pol1", "pol2", "pol3", "pol4"]) {
      await say(k);
      await spot(page.locator(`#l${k.slice(-1)}`));
      await hold(-200);
    }
    await hold();
    await login("castellum-engineer", "policies");
    await say("pol5");
    for (const [name, p] of [["oem-only", "oem-only"], ["eu-member-states", "eu-member-states"], ["no-competing-suppliers", "no-competing"], ["dnv-certified", "dnv-certified"], ["offshore-oem-eea", "And offshore"]]) {
      await when("pol5", p);
      await spot(page.locator(".tmpl-card", { has: page.locator("h3", { hasText: new RegExp(`^${name}$`) }) }), name);
    }
    await hold();
    await say("pol6");
    await go("matrix");
    await sleep(2500);
    await spot(page.locator("tr", { hasText: "BillOfMaterial" }), "Bill of material");
    await sleep(4500);
    await spot(page.locator("tr", { hasText: "ProductionStatus" }), "Production status");
    await hold();
    await say("pol7");
    await sh(`mgmt castellum POST /v4/contractdefinitions/request "$QS" | jq -r '.[] | "\\(.["@id"] | sub("reed-contract-";""))\\n    access:   \\(.accessPolicyId)\\n    contract: \\(.contractPolicyId)"'`,
      { show: `mgmt castellum POST /v4/contractdefinitions/request "$QS" | jq '.[] | {id, accessPolicyId, contractPolicyId}'`, note: "Which policies guard each of Castellum's offers?" });
    await hold(2000);
    await say("pol8");
    await sh(`mgmt castellum GET /v4/policydefinitions/reed-access-bilateral | jq -c '.policy.permission[0].constraint[]'`,
      { show: "mgmt castellum GET /v4/policydefinitions/reed-access-bilateral | jq '.policy.permission[0].constraint'", note: "The access policy 'bilateral', as stored on Castellum's connector" });
    await sh(`mgmt castellum GET /v4/policydefinitions/reed-policy-oem-only | jq -c '.policy.permission[0].constraint[]'`,
      { show: "mgmt castellum GET /v4/policydefinitions/reed-policy-oem-only | jq '.policy.permission[0].constraint'", note: "The contract policy 'oem-only'" });
    await hold(2000);
    await say("pol9");
    await sh(`mgmt castellum POST /v5beta/celexpressions/request "$QS" | jq -r '.[] | select(.leftOperand=="MembershipCredential.role") | .expression' | sed 's/\\.filter(/\\n  .filter(/; s/\\.exists(c,/\\n  .exists(c,/; s/ ? /\\n      ? /g; s/ : /\\n      : /g'`,
      { show: `mgmt castellum POST /v5beta/celexpressions/request "$QS" | jq -r '.[] | select(.leftOperand=="MembershipCredential.role") | .expression'`, note: "The CEL rule the connector runs for 'MembershipCredential.role'" });
    await hold(3000);
    await takeaways(2, ["Access policy — who finds it (otherwise invisible)", "Contract policy — who may sign (otherwise refused, with the reason)", "Usage policy — what happens after (licence, watermark, audit)"]);
  },

  async p3() {
    await part(3, "change-a-policy", "Changing a policy, watching it enforced", ["Read the who-gets-what board", "Preview a change before publishing", "See the other company's connector refuse"]);
    await login("castellum-engineer", "dataspace");
    await tab("My data, my terms");
    await say("set1");
    await when("set1", "This board");
    await spot(page.locator("table").first(), "Who gets Castellum's data");
    await when("set1", "Each cell");
    await spot(page.locator(".panel", { hasText: "Who gets Castellum's data" }).locator(".panel-head"), "The legend: finds it · gets a contract");
    await spot(page.locator(".lamps").nth(1), "finds it · gets a contract");
    await hold();
    await say("set2");
    await click(page.locator(".board-asset", { hasText: "Process Capability" }));
    await sleep(1500);
    await spot(page.locator(".panel", { hasText: "Right now" }), "Under oem-only");
    await hold();
    await say("set3");
    await page.locator("#tmpl").scrollIntoViewIfNeeded();
    await click(page.locator("#tmpl"));
    await page.locator("#tmpl").selectOption("eu-member-states");
    const preview = page.locator(".panel", { hasText: "If you publish" });
    await preview.locator("li", { hasText: "Nordvind" }).waitFor();
    await sleep(3500);
    await spot(preview, "Preview — nothing published yet");
    await sleep(3500);
    await spot(preview.locator("li", { hasText: "Nordvind" }), "Norway: EEA, not EU");
    await hold();
    await say("set4");
    await click(page.getByRole("button", { name: "Publish to my connector" }));
    await page.locator(".toast.ok").waitFor({ timeout: 60_000 });
    await spot(page.locator(".toast.ok"), "Sent to Castellum's connector");
    await hold();
    await login("nordvind-buyer", "dataspace");
    await tab("What I can get");
    await say("set5");
    const offer = page.locator("li.offer", { hasText: "Process Capability - Castellum" });
    await spot(offer, "REED predicts a refusal");
    await hold(-2500);
    await click(offer.getByRole("button", { name: "Try anyway" }));
    await offer.locator(".error-box").waitFor({ timeout: 90_000 });
    await say("set6");
    await spot(offer.locator(".error-box"), "Refused by Castellum's connector");
    await hold();
    await say("set6b");
    await sh(`mgmt nordvind POST /v4/contractnegotiations/request "$QS" | jq '[.[] | select(.state=="TERMINATED")] | last | {state, counterPartyId, errorDetail}'`,
      { show: `mgmt nordvind POST /v4/contractnegotiations/request "$QS" | jq '.[] | select(.state=="TERMINATED") | {state, errorDetail}'`, note: "Nordvind's own connector: the refused negotiation" });
    await hold(3000);
    await say("set7");
    await api("castellum-engineer", "PUT", "/reed/assets/process-capability-castellum/policy", { discoverability: "consortium", policyTemplate: "oem-only" });
    await hold();
    await takeaways(3, ["The owner previews, then publishes to its own connector", "The other side's connector enforces the new rule at once", "A refusal always names the condition that failed"]);
  },

  async p4() {
    await part(4, "contract-and-exchange", "Contract and data exchange", ["What the requester proves about itself", "The steps from offer to data", "The licence and watermark on the data"]);
    await login("castellum-engineer", "dataspace");
    await tab("What I can get");
    await say("ex1");
    await spot(page.locator(".wallet").first(), "What Castellum's credentials prove");
    await hold();
    const offer = page.locator("li.offer", { hasText: "Bill of Material - Nordvind" });
    await say("ex1b");
    await spot(offer, "Visible only to Nordvind's suppliers");
    await hold();
    await say("ex2");
    await sleep(2000);
    await click(offer.getByRole("button", { name: "Get it" }));
    await spot(offer.locator("button"), "Watch the steps");
    await offer.locator(".ok-box").waitFor({ timeout: 120_000 });
    await hold();
    await say("ex3");
    await spot(offer.locator(".ok-box"), "Contract signed · data received");
    await sleep(5000);
    await spot(offer.locator(".wallet.compact"), "The licence");
    await hold();
    await say("ex3b");
    await click(offer.locator("summary", { hasText: "Whole payload" }));
    await spot(offer.locator(".payload details"), "The data, with its licence block and watermark", "start");
    await hold(2500);
    await say("ex4");
    await sh(`mgmt nordvind POST /v4/contractagreements/request "$QS" | jq '[.[] | select(.assetId=="bill-of-material-nordvind")] | last | {assetId, consumer: .consumerId, provider: .providerId, signed: (.contractSigningDate | todate), policy: .policy.permission[0].constraint[0]}'`,
      { show: `mgmt nordvind POST /v4/contractagreements/request "$QS" | jq '.[] | {assetId, consumerId, providerId, policy}'`, note: "The signed contract agreement, on Nordvind's connector" });
    await hold(3000);
    await login("reed-admin", "audit");
    await say("ex5");
    await spot(page.locator("tbody tr").first(), "Data handed over: who, under which contract");
    await hold(1000);
    await takeaways(4, ["Catalogue → negotiate → contract → transfer → token → data", "The owner's data service hands data over only under a valid contract", "Every hand-over is licensed, watermarked and audited"]);
  },

  async p5() {
    await part(5, "policy-types", "Policy types side by side", ["EU versus EEA rules", "Role, certificate and multi-condition policies", "Real results that match the predictions"]);
    await login("reed-admin", "dataspace");
    await tab("Cross-border stories");
    await say("st1");
    for (const id of ["X2", "X3", "X5"]) {
      const story = page.locator(".story", { has: page.locator(".story-id", { hasText: id }) });
      await click(story.getByRole("button", { name: "Predict" }));
      await spot(story, `${id} · predicted`);
    }
    await hold();
    await say("st2");
    await sleep(4000);
    await ff("eight stories against the real connectors", () =>
      sh(`echo 'FINALIZED = contract signed · TERMINATED = refused (names the credential) · HIDDEN = offer not found'; for s in X1 X2 X3 X4 X5 X6 X7 X8; do SCENARIO=$s ./run-interop.sh | sed -n '/cross-border/,$p' | grep -v 'cross-border\\|done$\\|pulled' | grep -v '^$'; done`,
        { show: "for s in X1 … X8; do SCENARIO=$s ./run-interop.sh; done", note: "Run all eight stories against the real connectors" }));
    await say("st3");
    await hold(1500);
    await takeaways(5, ["Country, role, certificate, relation: all credential checks", "Conditions can be combined (offshore-oem-eea needs three)", "REED's predictions match what the connectors do"]);
  },

  async p6() {
    await part(6, "live-factory-data", "Live factory data under a contract", ["A simulated factory line", "A fault becoming an alarm", "Live status shared with a time-limited licence"]);
    await login("castellum-engineer", "factory");
    await say("fa1");
    await page.locator(".tile").first().waitFor();
    await spot(page.locator(".machine").first(), "Live sensor readings");
    await hold();
    await say("fa2");
    const controls = page.locator(".line-controls");
    await scrollTo(controls);
    await controls.getByLabel("Machine").selectOption("fettling-1");
    await controls.getByLabel("Sensor").selectOption("spindle-vibration");
    await click(page.getByRole("button", { name: "Inject spike" }));
    const tile = page.locator(".tile", { hasText: "Spindle vibration" });
    await scrollTo(tile);
    await ff("waiting for the next analysis", () => tile.filter({ hasText: "Alarm" }).waitFor({ timeout: 150_000 }));
    await spot(tile, "Alarm");
    await hold(2000);
    await login("nordvind-buyer", "dataspace");
    await tab("What I can get");
    const offer = page.locator("li.offer", { hasText: "Production Status - Castellum" });
    await scrollTo(offer);
    await say("fa3");
    await hold(-1500);
    await click(offer.getByRole("button", { name: "Get it" }));
    await ff("contract and transfer running", () => offer.locator(".ok-box").waitFor({ timeout: 120_000 }));
    await say("fa3b");
    await spot(offer.locator(".ok-box"), "Live line state, licensed until the pilot ends");
    await hold(2000);
    await login("castellum-engineer", "factory");
    await say("fa4");
    await type(page.locator("#obs-text"), "Smoke under furnace 1 after the night shift, call me on +34 612 345 678");
    await click(page.getByRole("button", { name: "Log observation" }));
    const obs = page.locator(".obs", { hasText: "Smoke under furnace" }).first();
    await ff("the local model tags the note", () => obs.waitFor({ timeout: 150_000 }));
    await spot(obs, "Tagged by the local model");
    await hold(2000);
    await say("fa5");
    await scrollTo(page.locator(".line-controls"));
    await page.locator(".line-controls").getByLabel("Machine").selectOption("fettling-1");
    await click(page.getByRole("button", { name: "Maintain Fettling CNC" }));
    await hold(1500);
    await takeaways(6, ["Live data is shared like any other data: only under a contract", "Limits such as an end date travel with the data", "Personal data is removed before the language model sees a note"]);
  },

  async p7() {
    await part(7, "matchmaking", "Matchmaking backed by a contract", ["How suppliers are ranked", "Shortlist and accept", "Confirm the match with a contract"]);
    await login("nordvind-buyer", "matches/R1");
    await say("mm1");
    await page.locator(".rank-row.top").waitFor();
    await spot(page.locator(".rank-row.top"), "Best match, with six criteria");
    await hold();
    await say("mm1b");
    await spot(page.locator(".rejected-row").first(), "Filtered out, with the reason");
    await hold();
    await say("mm2");
    await scrollTo(page.locator(".rank-row.top"));
    await click(page.locator(".rank-row.top").getByRole("button", { name: "Shortlist" }));
    await login("castellum-engineer", "opportunities");
    const opp = page.locator(".rank-row", { hasText: "Rotor hub casting" });
    await spot(opp, "Castellum sees only its own score");
    await sleep(2500);
    await click(opp.getByRole("button", { name: "Accept" }));
    await hold();
    await login("nordvind-buyer", "matches/R1");
    await say("mm3");
    await scrollTo(page.locator(".rank-row.top"));
    await click(page.locator(".rank-row.top").getByRole("button", { name: "Request capability via contract" }));
    await ff("contract, data and confirmation", () => page.locator(".flow-log").filter({ hasText: "Match confirmed" }).waitFor({ timeout: 180_000 }));
    await spot(page.locator(".flow-log"), "Each step, then: match confirmed");
    await hold(2500);
    await takeaways(7, ["Hard filters first, then six weighted criteria", "The supplier accepts before any data moves", "The match is confirmed with data received under a contract"]);
  },

  async p8() {
    await part(8, "refusals-and-tests", "Refusals and automated tests", ["What a non-member sees", "Who may change a policy", "The automated end-to-end check"]);
    await login("vagant-buyer");
    await say("ng1");
    await spot(page.locator(".warn-box").first(), "Not a member: no credentials");
    await hold();
    await say("ng2");
    await sh(`api "$(token hanse-buyer)" PUT /reed/assets/process-capability-castellum/policy '{"discoverability":"consortium","policyTemplate":"consortium-only"}' >/dev/null; echo "hanse-buyer      -> HTTP $(status)  (not found: the offer seems not to exist)"
api "$(token nordvind-quality)" PUT /reed/assets/bill-of-material-nordvind/policy '{"discoverability":"consortium","policyTemplate":"consortium-only"}' >/dev/null; echo "nordvind-quality -> HTTP $(status)  (forbidden: not the data manager)"`,
      { show: "api $(token hanse-buyer) PUT /reed/assets/process-capability-castellum/policy …   # and as nordvind-quality", note: "Try to change policies you do not own" });
    await hold(2000);
    await say("ng3");
    await sleep(3000);
    await ff("run-transfer.sh", () => sh("./run-transfer.sh", { note: "The automated end-to-end check" }));
    await say("ng3b");
    await hold(3000);
    await takeaways(8, ["Non-members see nothing", "Only the owner's data manager changes its policies", "Automated tests prove the whole flow"]);
  },

  async outro() {
    label("REED · video tutorial");
    await hold(900);
    await slide(`<div style="margin-top:40px"><h2 style="font-size:42px">That is REED</h2><div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="box"><b>Join with credentials</b><span>One roster entry → connector, identity hub, DID, three signed credentials</span></div>
      <div class="box"><b>1 · Access policy</b><span>Who may find it — otherwise the offer is invisible</span></div>
      <div class="box"><b>2 · Contract policy</b><span>Who may sign — otherwise refused, naming the condition</span></div>
      <div class="box"><b>3 · Usage policy</b><span>What may be done — licence, watermark and audit at hand-over</span></div></div></div>`);
    await say("outro");
    await hold(3000);
  },
};


await run(parts);
