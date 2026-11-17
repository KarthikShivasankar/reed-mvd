// The REED hands-on walkthrough: done in the dashboard, as different companies. How the data space works (the
// overview's flow diagram), onboarding and logging in, attaching policies to an offer, policy types in action,
// contract + data exchange step by step, usage terms + audit + catalogue. One take gives two versions (mix.py):
// full (every chapter) and short (chapters 2, 3, 5 with their own intro and outro).
//
//   node tools/demo-video/walkthrough.mjs   (stack up + freshly seeded, Kvarken already onboarded, R1 still open)
//   ONLY=c3,c5 node ...                     record some chapters (debugging)
// Env: PIPER_PY, PIPER_VOICE, OUT (default tools/demo-video/out-walkthrough)
import { UI, init, label, segment, caption, signIn, say, when, ff, hold, sleep, click, type, scrollTo, spot, login, go, tab, api,
  slide, part, takeaways, run, unspot, page } from "./lib.mjs";   // page is a live binding, set by run()

const N = {
  welcome: ["Welcome to this hands-on walkthrough of REED.", "You will do everything in the dashboard, the way a company would use it.", "We set policies on data, log in as different suppliers, and exchange data under contracts.", "Along the way, we show what the Eclipse Dataspace Connector does underneath."],
  cast: ["These are the companies you will meet.", "Nordvind is a Norwegian wind turbine maker: an OEM, a manufacturer of the final product.", "Hanse is a German OEM. Castellum is a Spanish foundry, and Wisła a Polish machine shop.", "Maasvlakte is a Dutch heavy-lift company. Kvarken is a Finnish forge that has just joined.", "Each person has their own login, and the login says which company they work for."],
  rule: ["Keep one rule in mind.", "You may see that data exists, but you receive it only after the two connectors sign a contract.", "Every offer carries three policies: who may find it, who may sign, and what may be done afterwards.", "Policies are checked against credentials: signed digital certificates about a company, like an ID card.", "The operator's issuer signs them, and each company's connector shows them on every request."],
  shortIntro: ["Welcome to this short walkthrough of REED, done entirely in the dashboard.", "Nordvind and Hanse are OEMs: they make the final product. Castellum, Wisła and Kvarken are suppliers.", "Each company runs a connector: its own software to offer data, and to fetch it.", "A credential is a signed digital certificate about a company, like an ID card.", "Every offer carries three policies: who may find it, who may sign, and what may be done afterwards.", "And the data moves only after the two connectors have signed a contract."],

  p1: ["Chapter one. How the data space works.", "Before clicking anything, let's see what happens between two companies."],
  c1a: ["On the overview page, a diagram shows how data moves between two members.", "Nordvind, on the left, wants data. Castellum, on the right, owns it.", "Each runs a connector, with a control plane for agreements, and a data plane for the data itself."],
  c1s1: ["Step one, publish. Castellum's connector lists its offers: descriptions and policies, never the data."],
  c1s2: ["Step two, discover. Nordvind's connector asks for Castellum's catalogue, its list of offers.", "It proves who it is with credentials. It is shown only the offers whose access policy it meets."],
  c1s3: ["Step three, negotiate. Nordvind picks an offer, and asks Castellum for a contract on it.", "Castellum's connector checks the contract policy against Nordvind's credentials. If it holds, both sign."],
  c1s4: ["Step four, transfer. Nordvind asks to start a transfer under that agreement."],
  c1s5: ["Step five, access key. The diagram calls it an EDR: an address plus a one-time key, for this one transfer."],
  c1s6: ["Step six, pull. Nordvind fetches the data with that key.", "Castellum's data store checks the contract once more, then stamps the licence and a watermark."],
  c1b: ["Under the diagram, a table lists every connection and protocol. It is for your IT team; you can skip it."],
  t1: ["To sum up chapter one.", "Catalogue, contract, transfer, key, data: always in this order, connector to connector."],

  p2: ["Chapter two. Onboarding, and logging in as different companies."],
  c2a: ["A company joins in three steps, done once by the data space operator.", "First, it gets an entry in the member list.", "Second, it gets its own connector, and its own identity hub, which works like a wallet.", "Third, the issuer signs three credentials for it: membership, certificates, and supply relations.", "This happens outside the dashboard. The company then gets logins for its people.", "Kvarken Forgeworks has just joined this way. Let's log in as its engineer."],
  c2b: ["This is the login page. Type your username, here kvarken-engineer, and your password."],
  c2c: ["The overview greets Kvarken, with the certificates the issuer verified: DNV and ISO 9001."],
  c2d: ["Open the company badge, at the top right.", "It shows Kvarken's DID, its digital identity that anyone can look up, and the connector it runs."],
  c2e: ["Now open Data space, and the tab What I can get.", "This panel shows what Kvarken's connector proves on every request: a supplier from Finland, supplying Hanse."],
  c2f: ["Below are the offers Kvarken may find. Hanse's bill of material is here, because Kvarken supplies Hanse."],
  c2g: ["Now we log in as Maasvlakte, a Dutch service company, and open the same tab."],
  c2h: ["Maasvlakte's credentials are different: a service company, in a project with Nordvind.", "So it finds Nordvind's production status, which Kvarken cannot see. And it does not see Hanse's bill of material."],
  c2i: ["Last, a company that has not been onboarded: Vagant Components."],
  c2j: ["It holds no credentials. So it sees nothing, and the page tells it to ask the operator for onboarding."],
  t2: ["To sum up chapter two.", "Each company logs in with its own accounts, and its credentials decide what it can find."],

  p3: ["Chapter three. Attaching policies to your data."],
  c3a: ["We log in as Castellum's data manager, the person who sets Castellum's terms.", "Open Data space, then My data, my terms."],
  c3b: ["The help box at the top explains what this view is for."],
  c3c: ["The board has one row per company, and one column per offer.", "Each cell has two lights: can the company find the offer, and would it get a contract?"],
  c3d: ["Click an offer: Castellum's process capability.", "On the left are its terms. On the right, who gets it right now, and why."],
  c3e: ["First: who can find it. This is the access policy.", "Click bilateral: only direct supply partners may find it."],
  c3f: ["The list on the right updates at once: most companies could no longer even find the offer.", "Nothing is published yet. This is only a preview."],
  c3g: ["Project limits it to partners in a shared project. Click consortium to let every member find it again."],
  c3h: ["Second: the contract terms. This is the contract policy.", "It is now oem-only: only manufacturers may sign.", "Each contract choice also sets the usage terms, written under it: here, no passing on."],
  c3i: ["Choose eu-member-states. Nordvind, registered in Norway, would now be refused. The EU suppliers would sign."],
  c3j: ["Choose dnv-certified: only companies with a verified DNV certificate."],
  c3k: ["And offshore-oem-eea: a manufacturer, with DNV, registered in Europe. All three must hold."],
  c3l: ["The two lines under the form say exactly what a company needs to find the offer, and to sign."],
  c3m: ["Let's publish one. Choose eu-member-states, then click Publish to my connector."],
  c3n: ["REED sends the new policies to Castellum's own connector. From now on, that connector enforces them."],
  c3o: ["Where do these policies come from? Open Policies.", "Each template is written in ODRL, the standard language for data policies.", "The permission says who may sign. The prohibition and obligation are the usage terms."],
  c3p: ["And Matrix shows the default policies for each kind of data. An owner can change them per offer."],
  t3: ["To sum up chapter three.", "Pick who may find it, pick who may sign, check the preview, then publish to your own connector."],

  p4: ["Chapter four. Policy types in action, seen by different suppliers."],
  c4a: ["We log in as Nordvind's buyer, and open What I can get.", "Castellum's process capability now warns: Castellum will refuse, because Nordvind is registered in Norway."],
  c4b: ["Click Try anyway. This is a real request, from Nordvind's connector to Castellum's."],
  c4c: ["Castellum's connector refused. It names the failing condition: the country in Nordvind's membership credential.", "In plain words: the company must be registered in one of the 27 EU countries."],
  c4d: ["Back as Castellum's data manager, we switch the contract terms back to oem-only, and publish."],
  c4e: ["Now the cross-border stories. Each one is a policy type, played out between these companies."],
  c4f: ["We log in as Wisła's data manager. The story Competing suppliers kept out protects Wisła's capability.", "Click Apply these terms. It is a shortcut: it sets the same terms as My data, my terms."],
  c4g: ["Now we log in as Castellum, another supplier, and try that story for real."],
  c4g2: ["On the story card, click Try it now. Castellum's connector asks Wisła's connector for a contract."],
  c4h: ["Refused. In plain words: the policy keeps suppliers out, and Castellum's credential says supplier."],
  c4i: ["Now Maasvlakte, a service company, tries the same story."],
  c4i2: ["Again, on the story card, click Try it now."],
  c4j: ["Maasvlakte is not a supplier, so it signs a contract and receives the data.", "Afterwards, Wisła switches back to its usual terms."],
  t4: ["To sum up chapter four.", "The same offer, two companies, two answers, decided by each company's credentials."],

  p5: ["Chapter five. A contract and data exchange, step by step."],
  c5a: ["We log in as Castellum, and open What I can get.", "This time Castellum asks, and Nordvind owns the data.", "Castellum supplies Nordvind, so it can find Nordvind's bill of material."],
  c5b: ["Click Get it, and watch the button.", "It shows each step as it happens: catalogue, negotiation, contract, transfer, access key, and data."],
  c5c: ["Done: a contract was signed, and the data arrived through Nordvind's data plane.", "Notice the licence: licensed to Castellum, no passing on, and a watermark."],
  c5d: ["Open Whole payload to see the data itself, with the licence block inside it."],
  c5e: ["Now open Contracts. It lists everything Castellum's own connector did.", "Each negotiation shows the other company and its state. Finalized means a signed agreement."],
  c5f: ["A terminated one shows why it was refused, in the same words as before."],
  c5g: ["Below are the transfers: each one a pull of data under an agreement."],
  c5h: ["REED also matches a buyer's request to suppliers, and contracts back that too.", "Nordvind's buyer needs twelve rotor hubs: request R1. Castellum is the best match. Click Shortlist."],
  c5i: ["Castellum's engineer sees the request under Opportunities, and accepts it."],
  c5j: ["Back as Nordvind, click Request capability via contract.", "Watch the diagram: each step lights up as the two connectors talk."],
  c5k: ["The match is confirmed, with Castellum's confidential capability received under a contract."],
  t5: ["To sum up chapter five.", "Get it runs the whole protocol for you, and Contracts shows what your connector did."],

  p6: ["Chapter six. Usage terms, the audit trail, and the catalogue."],
  c6a: ["As Nordvind, we get Castellum's production status.", "This offer uses the project policy: only partners in a shared pilot project can find it."],
  c6b: ["This licence has an end date: access ends with the pilot. And the data may not be passed on."],
  c6c: ["We log in as the operator, who runs the data space, and open Audit.", "Every delivery is recorded: who received what, under which contract.", "BPN numbers are company IDs: SUP-0002 is Castellum, OEM-0001 is Nordvind."],
  c6d: ["Filter by Terms changed, to see every policy change: who changed which offer, and when."],
  c6e: ["Last, EDC catalog: what the operator's catalogue collected from every connector.", "Only descriptions and policies. Never the data itself."],
  t6: ["To sum up chapter six.", "Usage terms travel with the data, and every change and every delivery leaves an audit record."],

  end: ["Here is where to click for each task.", "To set policies: Data space, My data, my terms.", "To see what you can get: Data space, What I can get.", "To follow your contracts: Contracts. And to check who did what: Audit.", "Thank you for watching."],
  shortEnd: ["That was the short walkthrough.", "To set policies, use My data, my terms. To get data, use What I can get, and follow it in Contracts.", "The full walkthrough also shows the protocol diagram, more policy types, usage terms and the audit trail.", "Thank you for watching."],
};

init(N, { name: "reed-walkthrough", unit: "Chapter", learn: "You will do", out: "out-walkthrough" });

const offer = (title) => page.locator("li.offer", { hasText: title });
const board = () => page.locator(".board-asset", { hasText: "Process Capability" });

const chapters = {
  async intro() {
    label("REED · hands-on walkthrough");
    segment(0, "introduction", "Introduction", ["full"]);
    await slide(`<div style="margin-top:90px"><div class="kick">Hands-on walkthrough</div><h1>Using REED</h1>
      <div class="sub">Policies, contracts and data exchange — done in the dashboard,<br>as different companies</div></div>`);
    await say("welcome");
    await hold();
    const row = (flag, co, what, role, user) => `<div class="box" style="display:grid;grid-template-columns:44px 1fr 1.4fr 1.3fr;gap:10px;align-items:center;padding:9px 16px">
      <b style="margin:0">${flag}</b><b style="margin:0">${co}</b><span>${what}</span><span style="font-family:monospace;color:#ffc04d">${user}</span></div>`;
    await slide(`<h2>Who is who</h2><div class="grid" style="gap:8px">
      ${row("NO", "Nordvind", "wind turbine maker · OEM", "", "nordvind-buyer")}
      ${row("DE", "Hanse", "ship and offshore maker · OEM", "", "hanse-buyer")}
      ${row("ES", "Castellum", "foundry · supplier · sets its own terms", "", "castellum-engineer")}
      ${row("PL", "Wisła", "machine shop · supplier", "", "wisla-engineer")}
      ${row("NL", "Maasvlakte", "heavy lift · service company", "", "maasvlakte-engineer")}
      ${row("FI", "Kvarken", "forge · supplier · just joined", "", "kvarken-engineer")}
      ${row("—", "Operator", "runs the data space", "", "reed-admin")}</div>
      <div class="sub" style="margin-top:14px;font-size:17px">OEM = manufacturer of the final product. Fictional companies.</div>`);
    await say("cast");
    await hold();
    await slide(`<div style="margin-top:50px;text-align:center"><div class="kick">The one rule</div><h2 style="font-size:40px;line-height:1.25">You may see that data exists —<br><span class="k">but you receive it only after a contract.</span></h2></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-top:34px">
        <div class="box"><b><span class="num">1</span>Access policy</b><span>Who may <span class="k">find</span> the offer</span></div>
        <div class="box"><b><span class="num">2</span>Contract policy</b><span>Who may <span class="k">sign</span> a contract</span></div>
        <div class="box"><b><span class="num">3</span>Usage policy</b><span>What may be <span class="k">done</span> afterwards</span></div></div>`);
    await say("rule");
    await hold();
  },

  async shortIntro() {
    label("REED · short walkthrough");
    segment(0, "introduction-short", "Introduction", ["short"]);
    await slide(`<div style="margin-top:60px"><div class="kick">Short walkthrough</div><h1>Using REED</h1>
      <div class="sub">Log in as different companies · attach policies · exchange data under a contract</div></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-top:6px">
        <div class="box" id="si1"><b>OEMs</b><span>make the final product: Nordvind (NO), Hanse (DE)</span></div>
        <div class="box" id="si2"><b>Suppliers</b><span>Castellum (ES), Wisła (PL), Kvarken (FI) · service: Maasvlakte (NL)</span></div>
        <div class="box" id="si3"><b>Connector · credential</b><span>each company's software to offer and fetch data · a signed certificate, like an ID card</span></div>
        <div class="box"><b><span class="num">1</span>Access policy</b><span>Who may <span class="k">find</span> the offer</span></div>
        <div class="box"><b><span class="num">2</span>Contract policy</b><span>Who may <span class="k">sign</span> a contract</span></div>
        <div class="box"><b><span class="num">3</span>Usage policy</b><span>What may be <span class="k">done</span> afterwards</span></div></div>`);
    await say("shortIntro");
    await hold(1500);
  },

  async c1() {
    await part(1, "how-it-works", "How the data space works", ["See the six steps between two connectors", "Control plane versus data plane", "Where credentials and policies are checked"]);
    await login("nordvind-buyer", "overview");
    const panel = page.locator(".panel", { hasText: "How data moves between two members" });
    await say("c1a");
    await spot(panel.locator("svg.topo-svg"), "Nordvind wants data · Castellum owns it");
    await hold();
    for (const [i, id] of ["c1s1", "c1s2", "c1s3", "c1s4", "c1s5", "c1s6"].entries()) {
      await click(page.locator('button[title="next step"]'));
      await say(id);
      await spot(panel.locator("svg.topo-svg"), `Step ${i + 1} on the diagram`, "start");   // the arrows that light up
      await sleep(800);
      await spot(panel.locator(".topo-desc"), `Step ${i + 1}: what travels on the wire`);
      await hold(-300);
    }
    await hold();
    await say("c1b");
    await click(page.locator("details.netref summary"));
    await spot(page.locator("details.netref"), "Every connection and protocol", "start");
    await hold();
    await click(page.locator("details.netref summary"));
    await takeaways(1, ["① publish → ② discover (catalogue) → ③ negotiate (contract)", "④ transfer → ⑤ one-time key → ⑥ pull the data", "Credentials are checked on every step; the data plane only after a contract"]);
  },

  async c2() {
    await part(2, "onboarding-and-login", "Onboarding and logging in", ["How a company joins the data space", "Log in as a new supplier and see its identity", "Compare what different suppliers can find"], ["full", "short"]);
    await slide(`<h2>How a company joins</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="box" id="j1"><b><span class="num">1</span>Member list</b><span>The operator adds the company: name, country, role, certificates, supply relations.</span></div>
      <div class="box" id="j2"><b><span class="num">2</span>Own connector + identity hub</b><span>Its own software to offer and fetch data, and a wallet for its credentials, with a DID.</span></div>
      <div class="box" id="j3"><b><span class="num">3</span>Three signed credentials</b><span>Membership (role, country) · certificates · supply relations — signed by the issuer.</span></div></div>`);
    await say("c2a");
    for (const [id, p] of [["j1", "First"], ["j2", "Second"], ["j3", "Third"]]) { await when("c2a", p); await spot(page.locator(`#${id}`)); }
    await hold();
    await unspot();
    await page.context().clearCookies();
    await page.goto(`${UI}/?v=${Date.now()}#/overview`);
    await say("c2b");
    await spot(page.locator("form").first(), "Each person logs in with their own account");
    await unspot();
    await signIn("kvarken-engineer");
    await say("c2c");
    await spot(page.locator(".hero"), "Verified by the REED issuer");
    await hold();
    await say("c2d");
    await click(page.locator(".org-btn"));
    await spot(page.locator(".org-pop"), "Kvarken's identity");
    await hold();
    await click(page.locator(".org-btn"));
    await go("dataspace");
    await tab("What I can get");
    await say("c2e");
    await spot(page.locator(".wallet").first(), "What Kvarken's credentials prove");
    await hold();
    await say("c2f");
    await spot(offer("Bill of Material - Hanse"), "Only Hanse's suppliers find this");
    await hold();
    await say("c2g");
    await hold();
    await login("maasvlakte-engineer", "dataspace");
    await tab("What I can get");
    await say("c2h");
    await spot(page.locator(".wallet").first(), "Maasvlakte's credentials: service, project with Nordvind");
    await when("c2h", "So it finds");
    await spot(offer("Production Status - Nordvind"), "Only partners in Nordvind's project find this");
    await hold();
    await say("c2i");
    await hold();
    await login("vagant-buyer", "overview");
    await say("c2j");
    await spot(page.locator(".warn-box").first(), "Not onboarded: no credentials");
    await hold();
    await takeaways(2, ["Joining: member list → own connector + identity hub → three signed credentials", "Every person logs in with their own account, tied to their company", "A company's credentials decide which offers it can even find"]);
  },

  async c3() {
    await part(3, "attaching-policies", "Attaching policies to your data", ["Choose who may find an offer", "Choose who may sign, and preview the effect", "Publish to your own connector"], ["full", "short"]);
    await login("castellum-engineer", "dataspace");
    await tab("My data, my terms");
    await say("c3a");
    await hold();
    await say("c3b");
    await click(page.locator("details.explainer summary").first());
    await spot(page.locator("details.explainer").first(), "What this view is for");
    await hold();
    await click(page.locator("details.explainer summary").first());
    await say("c3c");
    await when("c3c", "The board");
    await spot(page.locator(".panel", { hasText: "Who gets Castellum's data" }).first(), "Who gets Castellum's data");
    await when("c3c", "Each cell");
    await spot(page.locator(".lamp-legend").first(), "finds it · gets a contract");
    await hold();
    await say("c3d");
    await click(board());
    await spot(page.locator(".terms-grid"), "Terms on the left · effect on the right", "start");
    await hold();
    const seg = (d) => page.locator(".terms-form .seg button", { hasText: d });
    const preview = page.locator(".panel", { hasText: /If you publish|Right now/ }).filter({ has: page.locator("ul.why-list") });
    await say("c3e");
    await when("c3e", "Click bilateral");
    await click(seg("bilateral"));
    await spot(page.locator(".terms-form .seg"), "Who can find it = access policy");
    await say("c3f");
    await spot(preview, "Preview: hidden for most companies");
    await hold();
    await say("c3g");
    await click(seg("project"));
    await sleep(1500);
    await click(seg("consortium"));
    await hold();
    await say("c3h");
    await spot(page.locator("#tmpl"), "Contract terms = contract policy");
    await when("c3h", "Each contract");
    await spot(page.locator(".terms-form p.note").nth(1), "Usage terms come with it");
    await hold();
    for (const [tmpl, id, lbl] of [["eu-member-states", "c3i", "Norway: EEA, not EU"], ["dnv-certified", "c3j", "Needs a verified DNV certificate"], ["offshore-oem-eea", "c3k", "Three conditions at once"]]) {
      await click(page.locator("#tmpl"));
      await page.locator("#tmpl").selectOption(tmpl);
      await sleep(900);
      await say(id);
      await spot(preview, lbl);
      await hold();
    }
    await say("c3l");
    await spot(page.locator(".terms-need"), "What a company needs");
    await hold();
    await say("c3m");
    await click(page.locator("#tmpl"));
    await page.locator("#tmpl").selectOption("eu-member-states");
    await sleep(800);
    await click(page.getByRole("button", { name: "Publish to my connector" }));
    await page.locator(".toast.ok").waitFor({ timeout: 60_000 });
    await say("c3n");
    await spot(page.locator(".toast.ok"), "Published to Castellum's connector");
    await hold();
    await go("policies");
    await say("c3o");
    const card = page.locator(".tmpl-card", { has: page.locator("h3", { hasText: /^oem-only$/ }) });
    await when("c3o", "Each template");
    await spot(card, "oem-only, in ODRL");
    await hold();
    await go("matrix");
    await say("c3p");
    await spot(page.locator("table").first(), "Defaults per kind of data");
    await hold();
    await takeaways(3, ["Who can find it: consortium · bilateral · project (access policy)", "Contract terms: oem-only, eu-member-states, dnv-certified … (contract policy)", "Preview first, then publish to your own connector"]);
  },

  async c4() {
    await part(4, "policy-types-in-action", "Policy types in action", ["See a refusal on the country credential", "Apply a 'no competing suppliers' policy", "Compare a supplier and a service company"]);
    await login("nordvind-buyer", "dataspace");
    await tab("What I can get");
    const pc = offer("Process Capability - Castellum");
    await say("c4a");
    await spot(pc, "REED predicts a refusal");
    await hold();
    await say("c4b");
    await click(pc.getByRole("button", { name: "Try anyway" }));
    await ff("the two connectors negotiate", () => pc.locator(".error-box").waitFor({ timeout: 90_000 }));
    await say("c4c");
    await spot(pc.locator(".error-box"), "Refused by Castellum's connector");
    await hold();
    await login("castellum-engineer", "dataspace");
    await tab("My data, my terms");
    await say("c4d");
    await click(board());
    await click(page.locator("#tmpl"));
    await page.locator("#tmpl").selectOption("oem-only");
    await sleep(700);
    await click(page.getByRole("button", { name: "Publish to my connector" }));
    await page.locator(".toast.ok").waitFor({ timeout: 60_000 });
    await hold();
    const story = (id) => page.locator(".story", { has: page.locator(".story-id", { hasText: id }) });
    await say("c4e");
    await hold();
    await login("wisla-engineer", "dataspace");
    await tab("Cross-border stories");
    await say("c4f");
    await spot(story("X3"), "Competing suppliers kept out");
    await hold(-1500);
    await click(story("X3").getByRole("button", { name: "Apply these terms" }));
    await page.locator(".toast.ok").waitFor({ timeout: 60_000 });
    await hold(1000);
    await say("c4g");
    await hold();
    await login("castellum-engineer", "dataspace");
    await tab("Cross-border stories");
    await scrollTo(story("X3"));
    await say("c4g2");
    await spot(story("X3").getByRole("button", { name: "Try it now" }), "Try it now");
    await hold(-800);
    await click(story("X3").getByRole("button", { name: "Try it now" }));
    await ff("the two connectors negotiate", () => story("X3").locator("li", { hasText: "Castellum" }).locator(".faint").last().waitFor({ timeout: 90_000 }));
    await say("c4h");
    await spot(story("X3").locator("li", { hasText: "Castellum" }), "Refused: role SUPPLIER");
    await hold();
    await say("c4i");
    await hold();
    await login("maasvlakte-engineer", "dataspace");
    await tab("Cross-border stories");
    await scrollTo(story("X3"));
    await say("c4i2");
    await spot(story("X3").getByRole("button", { name: "Try it now" }), "Try it now");
    await hold(-500);
    await click(story("X3").getByRole("button", { name: "Try it now" }));
    await ff("contract and transfer", () => story("X3").locator("li", { hasText: "Maasvlakte" }).getByText(/signed, payload received|refused/).waitFor({ timeout: 120_000 }));
    await say("c4j");
    await spot(story("X3").locator("li", { hasText: "Maasvlakte" }), "Contract signed · data received");
    await api("wisla-engineer", "PUT", "/reed/assets/process-capability-wisla/policy", { discoverability: "consortium", policyTemplate: "oem-only" });
    await hold();
    await takeaways(4, ["Country, role, certificate: each policy is a check on credentials", "The other company's connector decides, and names the reason", "Same offer, different companies, different answers"]);
  },

  async c5() {
    await part(5, "contract-and-exchange", "Contract and data exchange", ["Get data in one click, and follow the steps", "Read the licence on the data", "Follow it all in Contracts, and in matchmaking"], ["full", "short"]);
    await login("castellum-engineer", "dataspace");
    await tab("What I can get");
    const bom = offer("Bill of Material - Nordvind");
    await say("c5a");
    await spot(bom, "Visible to Nordvind's suppliers");
    await hold();
    await say("c5b");
    await hold(-2500);
    await click(bom.getByRole("button", { name: "Get it" }));
    await caption("▶ Watch the button: catalogue → negotiating → contract → transfer → access key → data");
    await spot(bom.locator("button"), "Watch the steps");
    await bom.locator(".ok-box").waitFor({ timeout: 120_000 });
    await hold();
    await say("c5c");
    await spot(bom.locator(".ok-box"), "Contract signed · data received");
    await when("c5c", "Notice");
    await spot(bom.locator(".wallet.compact"), "The licence");
    await hold();
    await say("c5d");
    await click(bom.locator("summary", { hasText: "Whole payload" }));
    await spot(bom.locator(".payload details"), "The data, with its licence block", "start");
    await hold();
    await go("transfers");
    await say("c5e");
    await spot(page.locator(".panel", { hasText: "Contract negotiations" }).first(), "Castellum's connector: negotiations", "start");
    await hold();
    const terminated = page.locator(".panel", { hasText: "Contract negotiations" }).locator("tr", { hasText: /terminated/i }).first();
    if (await terminated.count()) { await say("c5f"); await spot(terminated, "Refused, with the reason"); await hold(); }
    await say("c5g");
    await spot(page.locator(".panel", { hasText: "Transfers" }).last(), "Transfers: HttpData-PULL", "start");
    await hold();
    await takeaways(5, ["Get it = catalogue → contract → transfer → one-time key → data", "Every delivery carries a licence and a watermark", "Contracts shows what your own connector did, and why"]);
    // Matchmaking is a different feature: in the full version only, after the chapter's summary.
    segment(5, "matchmaking", "Matchmaking backed by a contract", ["full"]);
    label("Chapter 5 · Matchmaking backed by a contract");
    await login("nordvind-buyer", "matches/R1");
    await page.locator(".rank-row.top").waitFor();
    await say("c5h");
    await spot(page.locator(".rank-row.top"), "Best match");
    await hold(-1200);
    await click(page.locator(".rank-row.top").getByRole("button", { name: "Shortlist" }));
    await hold();
    await login("castellum-engineer", "opportunities");
    const opp = page.locator(".rank-row", { hasText: "Rotor hub casting" });
    await say("c5i");
    await spot(opp, "Castellum sees only its own score");
    await hold(-1000);
    await click(opp.getByRole("button", { name: "Accept" }));
    await hold(1000);
    await login("nordvind-buyer", "matches/R1");
    await say("c5j");
    await hold(-3000);
    await click(page.locator(".rank-row.top").getByRole("button", { name: "Request capability via contract" }));
    await hold();
    await caption("▶ Watch the diagram: each step lights up as the two connectors talk");
    await spot(page.locator("svg.topo-svg").last(), "Live: the connectors at work", "start");
    await page.locator(".flow-log").filter({ hasText: "Match confirmed" }).waitFor({ timeout: 180_000 });
    await hold();
    await say("c5k");
    await spot(page.locator(".flow-log"), "Each step, then: match confirmed");
    await hold();
  },

  async c6() {
    await part(6, "usage-audit-catalogue", "Usage terms, audit and the catalogue", ["See a licence with an end date", "Find every delivery and policy change in the audit trail", "See what the shared catalogue holds"]);
    await login("nordvind-buyer", "dataspace");
    await tab("What I can get");
    const ps = offer("Production Status - Castellum");
    await say("c6a");
    await scrollTo(ps);
    await hold(-1500);
    await click(ps.getByRole("button", { name: "Get it" }));
    await ff("contract and transfer", () => ps.locator(".ok-box").waitFor({ timeout: 120_000 }));
    await say("c6b");
    await spot(ps.locator(".wallet.compact"), "Valid until the pilot ends · not to be passed on");
    await hold();
    await login("reed-admin", "audit");
    await say("c6c");
    await spot(page.locator("tbody tr", { hasText: /Payload pulled/ }).first(), "A delivery: who, under which contract");
    await hold();
    await say("c6d");
    await page.getByLabel("Filter by event type").selectOption("POLICY");
    await sleep(800);
    await spot(page.locator("tbody tr").first(), "Terms changed: by whom, on which offer");
    await hold();
    await go("edc");
    await say("c6e");
    await spot(page.locator(".fc-member").first(), "Metadata only");
    await hold();
    await takeaways(6, ["Usage terms (end date, no passing on) are stamped on every delivery", "The audit trail records every policy change and every delivery", "The shared catalogue holds descriptions only, never data"]);
  },

  async outro() {
    label("REED · hands-on walkthrough");
    segment(7, "where-to-click", "Where to click", ["full"]);
    await slide(`<h2>Where to click</h2><div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="box"><b>Set who may find and who may sign</b><span>Data space → <span class="k">My data, my terms</span> → pick an offer → preview → Publish</span></div>
      <div class="box"><b>See and get what you are allowed</b><span>Data space → <span class="k">What I can get</span> → Get it</span></div>
      <div class="box"><b>Follow your contracts</b><span><span class="k">Contracts</span>: negotiations and transfers on your connector</span></div>
      <div class="box"><b>Check who did what</b><span><span class="k">Audit</span>: deliveries and policy changes</span></div></div>`);
    await say("end");
    await hold(2500);
  },

  async shortOutro() {
    label("REED · short walkthrough");
    segment(8, "summary-short", "Summary", ["short"]);
    await slide(`<h2>Where to click</h2><div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="box"><b>Set policies</b><span>Data space → <span class="k">My data, my terms</span></span></div>
      <div class="box"><b>Get data</b><span>Data space → <span class="k">What I can get</span> → Get it</span></div>
      <div class="box"><b>Follow contracts</b><span><span class="k">Contracts</span></span></div>
      <div class="box"><b>More</b><span>The full walkthrough: protocol diagram, more policy types, usage terms, audit</span></div></div>`);
    await say("shortEnd");
    await hold(2500);
  },
};

await run(chapters);
