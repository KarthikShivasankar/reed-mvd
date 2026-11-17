// Shared recording kit for the REED videos (tutorial.mjs, walkthrough.mjs): local TTS narration split into
// one-sentence captions, a spotlight + cursor overlay, sped-up waits, Keycloak logins, slides and a terminal page.
// A script calls init(narration, options), defines its parts, then run(parts). mix.py and review.py read timeline.json.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.resolve(HERE, "../..");
const require = createRequire(path.join(ROOT, "services/reed-dashboard/package.json"));
const { chromium } = require("@playwright/test");

export const UI = process.env.REED_UI ?? "http://127.0.0.1:8088";
export const ONLY = process.env.ONLY?.split(",");
const PASSWORD = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment/roster.json"), "utf8")).dataspace.demoPassword;
let OUT, N, AUDIO, OPTS;

const piperPy = process.env.PIPER_PY ?? path.join(process.env.HOME, ".cache/reed-tts/bin/python");
const voice = process.env.PIPER_VOICE ?? path.join(process.env.HOME, ".cache/reed-tts/voices/en_US-lessac-high.onnx");
/** Splits a long sentence at the clause break nearest its middle, so no caption runs past two lines. */
function chunks(text, max = 95) {
  if (text.length <= max) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (const m of text.matchAll(/[.,:;—] /g)) if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index;
  if (best < 15 || best > text.length - 15) return [text];
  return [...chunks(text.slice(0, best + 1), max), ...chunks(text.slice(best + 2), max)];
}

/** Generates (or reuses) the narration audio. opts: name (output file stem), unit ("Part"/"Chapter"), total, out dir. */
export function init(narration, opts) {
  OPTS = opts;
  OUT = process.env.OUT ?? path.join(HERE, opts.out);
  fs.mkdirSync(OUT, { recursive: true });
  N = narration;
  for (const id of Object.keys(N)) N[id] = N[id].flatMap((t) => chunks(t));
  const lines = Object.entries(N).flatMap(([id, ss]) => ss.map((text, i) => ({ id: `${id}-${i}`, text })));
  AUDIO = JSON.parse(execFileSync(piperPy, [path.join(HERE, "tts.py"), voice, path.join(OUT, "voice")],
    { input: JSON.stringify(lines), maxBuffer: 1 << 24 }).toString());
}
/** Sets the label shown above the captions (slides outside numbered parts). */
export function label(text) { partLabel = text; }

// ------------------------------------------------------------------------------------------------ timeline
const timeline = { says: [], ff: [], parts: [] };
let t0 = 0, busyUntil = 0, partLabel = "", cur = "";
const now = () => Date.now() - t0;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hold = async (extra = 0) => { const d = busyUntil + extra - now(); if (d > 0) await sleep(d); };
const GAP = 900, SENTENCE_GAP = 300;

export let page;
export async function caption(text = cur, badge = "") {
  cur = text;
  await page.evaluate(([t, c, b]) => window.__reedCap?.(t, c, b), [text, partLabel, badge]).catch(() => {});
}
/** Speaks a block sentence by sentence (one caption each); actions continue while it plays. */
const starts = {};
export async function say(id) {
  await hold(GAP);
  let at = now();
  starts[id] = [];
  N[id].forEach((text, i) => {
    const a = AUDIO[`${id}-${i}`];
    timeline.says.push({ id: `${id}-${i}`, text, file: a.file, at, seconds: a.seconds });
    starts[id].push({ text, at });
    setTimeout(() => caption(text), Math.max(0, at - now()));
    at += a.seconds * 1000 + SENTENCE_GAP;
  });
  busyUntil = at;
  await sleep(50);
}
/** Waits until the sentence of block `id` that starts with `prefix` is being spoken (to point at what it names). */
export async function when(id, prefix) {
  const s = starts[id]?.find((x) => x.text.startsWith(prefix));
  if (!s) throw new Error(`no sentence "${prefix}" in ${id}`);
  if (s.at > now()) await sleep(s.at - now());
}
/** A wait that mix.py speeds up; no narration plays during it. */
export async function ff(label, fn) {
  await hold(400);
  await caption("", `⏩ sped up · ${label}`);
  const start = now();
  try { return await fn(); } finally { timeline.ff.push({ start, end: now(), label }); await caption("", ""); }
}

// ------------------------------------------------------------------------------------------------ overlay
// Caption box (part label + one sentence), a spotlight that dims everything else, and a visible cursor with click ripples.
const OVERLAY = `(() => {
  if (window.__reedCap) return;
  const css = \`#__cap{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:max-content;max-width:1000px;z-index:2147483647;
     background:rgba(8,12,20,.92);color:#fff;font:500 21px/1.38 Inter,system-ui,sans-serif;padding:8px 18px 11px;border-radius:12px;
     box-shadow:0 8px 28px rgba(0,0,0,.45);pointer-events:none;text-align:center}
   #__cap.empty{display:none} #__capl{display:block;font:700 12px/1.6 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#ffc04d}
   #__badge{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;
     background:#c3412b;color:#fff;font:700 15px Inter,system-ui,sans-serif;padding:6px 14px;border-radius:8px} #__badge:empty{display:none}
   #__spot{position:fixed;display:none;border:3px solid #ffb000;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.5);
     z-index:2147483645;pointer-events:none;transition:left .35s,top .35s,width .35s,height .35s}
   #__spotl{position:absolute;left:-3px;top:-34px;background:#ffb000;color:#111;font:700 15px Inter,system-ui,sans-serif;padding:4px 10px;border-radius:7px;white-space:nowrap}
   #__spotl:empty{display:none}
   #__cur{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;z-index:2147483647;pointer-events:none;
     background:rgba(255,196,0,.45);border:2px solid rgba(255,160,0,.95);transition:transform .12s}
   #__cur.down{transform:scale(.6)} .__rip{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
     border:3px solid rgba(255,160,0,.9);z-index:2147483647;pointer-events:none;animation:__rip .5s ease-out forwards}
   @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}\`;
  const g = (i) => document.getElementById(i);
  const store = (o) => { try { sessionStorage.setItem('__reedCap', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('__reedCap') || '{}'), ...o })); } catch {} };
  const mk = () => {
    if (g('__cap') || !document.body) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    document.body.insertAdjacentHTML('beforeend', '<div id="__spot"><div id="__spotl"></div></div><div id="__cap" class="empty"><span id="__capl"></span><span id="__capt"></span></div><div id="__badge"></div><div id="__cur"></div>');
    let st = {}; try { st = JSON.parse(sessionStorage.getItem('__reedCap') || '{}'); } catch {}
    window.__reedCap(st.t || '', st.c || '', st.b || '');
    if (st.x != null) { g('__cur').style.left = st.x + 'px'; g('__cur').style.top = st.y + 'px'; }
  };
  window.__reedCap = (t, c, b) => {
    mk(); if (!g('__cap')) return;
    g('__capt').textContent = t; g('__capl').textContent = c; g('__cap').classList.toggle('empty', !t); g('__badge').textContent = b;
    store({ t, c, b });
  };
  window.__reedSpot = (r, label) => {
    mk(); const s = g('__spot'); if (!s) return;
    if (!r) { s.style.display = 'none'; return; }
    Object.assign(s.style, { display: 'block', left: (r.x - 8) + 'px', top: (r.y - 8) + 'px', width: (r.width + 16) + 'px', height: (r.height + 16) + 'px' });
    g('__spotl').textContent = label || '';
  };
  addEventListener('mousemove', (e) => { const c = g('__cur'); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } store({ x: e.clientX, y: e.clientY }); }, true);
  addEventListener('mousedown', (e) => { g('__cur')?.classList.add('down');
    const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  addEventListener('mouseup', () => g('__cur')?.classList.remove('down'), true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mk); else mk();
})()`;

// ------------------------------------------------------------------------------------------------ helpers
export const unspot = () => page.evaluate(() => window.__reedSpot?.(null)).catch(() => {});
export async function moveTo(loc) {
  const b = await loc.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
}
export async function click(loc) {
  await unspot();
  await loc.scrollIntoViewIfNeeded();
  await moveTo(loc);
  await sleep(250);
  await loc.click();
  await sleep(450);
}
export async function type(loc, text) { await click(loc); await loc.pressSequentially(text, { delay: 30 }); }
export async function scrollTo(loc, block = "center") { await loc.evaluate((e, b) => e.scrollIntoView({ behavior: "smooth", block: b }), block); await sleep(800); }
/** Dims everything but this element and labels it; a missing element only skips the gesture (decoration, not a check). */
export async function spot(loc, label = "", block = "center") {
  try {
    loc = loc.first();
    await loc.waitFor({ timeout: 8000 });
    await scrollTo(loc, block);
    const b = await loc.boundingBox();
    if (!b) return;
    await page.evaluate(([r, l]) => window.__reedSpot(r, l), [{ x: b.x, y: b.y, width: b.width, height: b.height }, label]);
    await page.mouse.move(b.x + Math.min(b.width - 12, 40), b.y + b.height - 10, { steps: 20 });
    await sleep(2000); // long enough to read, whatever the narration does
  } catch { /* not on screen */ }
}

const WHO = { "kvarken-engineer": "Kvarken's engineer", "castellum-engineer": "Castellum's engineer (its data manager)", "nordvind-buyer": "Nordvind's buyer",
  "reed-admin": "the REED operator", "vagant-buyer": "a non-member", "wisla-engineer": "Wisła's engineer (its data manager)",
  "maasvlakte-engineer": "Maasvlakte's engineer", "hanse-buyer": "Hanse's buyer", "rhein-auditor": "Rhein NDT's auditor", "nordvind-quality": "Nordvind's auditor" };
/** Logs in through Keycloak; shown as a short sped-up moment that says whose screen comes next. */
export async function login(user, hash = "") {
  await ff(`logging in as ${WHO[user] ?? user}`, () => doLogin(user, hash));
  await caption();
}
async function doLogin(user, hash) {
  await unspot();
  await page.context().clearCookies();
  await page.goto(`${UI}/?v=${Date.now()}#/${hash}`);
  await caption();
  await type(page.locator("#username"), user);
  await page.locator("#password").fill(PASSWORD);
  await click(page.locator("#kc-login"));
  await page.locator(".org-btn").waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await caption();
}
/** Signs in on the login page already on screen, typing visibly (to show how it is done). */
export async function signIn(user) {
  await type(page.locator("#username"), user);
  await page.locator("#password").pressSequentially(PASSWORD, { delay: 40 });
  await click(page.locator("#kc-login"));
  await page.locator(".org-btn").waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await caption();
}
export async function go(hash) {
  await unspot();
  await page.goto(`${UI}/#/${hash}`);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await caption();
  await sleep(500);
}
export async function tab(name) { await click(page.getByRole("tab", { name })); await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {}); }

/** REED API as a demo user (password grant on the reed-cli client), for restoring state off-screen. */
export async function api(user, method, p, body) {
  const kc = await fetch(`${UI}/realms/reed/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "reed-cli", username: user, password: PASSWORD }) });
  const { access_token } = await kc.json();
  const r = await fetch(`${UI}${p}`, { method, headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status}`);
}

const TERM = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0b1020;color:#e6e9ef;font-family:Inter,system-ui,sans-serif}
  .term{position:absolute;inset:26px 30px 104px;background:#0f1117;border:1px solid #2a3142;border-radius:12px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5)}
  .bar{height:30px;background:#1b2030;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8b93a7;font-size:13px}
  .bar i{width:11px;height:11px;border-radius:50%;display:inline-block} .bar span{margin-left:10px}
  pre{margin:0;padding:12px 16px;height:calc(100% - 54px);overflow:hidden;font:15px/1.5 "JetBrains Mono","DejaVu Sans Mono",monospace;white-space:pre-wrap;word-break:break-word}
  .p{color:#7ee787} .c{color:#fff;font-weight:700} .n{color:#e3b341;font-style:italic} .ok{color:#3fb950;font-weight:700} .bad{color:#f85149;font-weight:700} .h{color:#79c0ff}
</style></head><body><div class="term"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i><span>terminal · ~/mvd-main</span></div><pre id="o"></pre></div>
<script>
  const o = document.getElementById('o'); const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  const trim = () => { while (o.childNodes.length > 1200) o.removeChild(o.firstChild); o.scrollTop = o.scrollHeight; };
  window.__add = (lines) => { for (const l of lines) { const h = esc(l).replace(/^PASS\\b/, '<span class="ok">PASS</span>').replace(/^FAIL\\b/, '<span class="bad">FAIL</span>')
      .replace(/^\\[([a-z-]+)\\]/, '<span class="h">[$1]</span>'); o.insertAdjacentHTML('beforeend', h + '\\n'); } trim(); };
  window.__cmd = async (note, c) => {
    if (note) o.insertAdjacentHTML('beforeend', '\\n<span class="n"># ' + esc(note) + '</span>\\n');
    o.insertAdjacentHTML('beforeend', '<span class="p">$ </span>'); const s = document.createElement('span'); s.className = 'c'; o.appendChild(s);
    for (const ch of c) { s.textContent += ch; o.scrollTop = o.scrollHeight; await new Promise((r) => setTimeout(r, 18)); } o.insertAdjacentHTML('beforeend', '\\n'); trim(); };
</script></body></html>`;
export async function terminal() {
  if (await page.evaluate(() => typeof window.__cmd === "function").catch(() => false)) return;
  await unspot();
  await page.goto("about:blank");
  await page.setContent(TERM);
  await page.evaluate(OVERLAY);
  await caption();
}
/** Runs a real shell command in the repo and streams its output into the on-screen terminal, under a plain-words note. */
export async function sh(cmd, { show = cmd, note = "" } = {}) {
  await terminal();
  await page.evaluate(([n, c]) => window.__cmd(n, c), [note, show]);
  const p = spawn("bash", ["-c", `source tools/reed-lib.sh >/dev/null; ${cmd}`], { cwd: ROOT, env: { ...process.env, NO_COLOR: "1" } });
  let buf = "", out = "", pending = [];
  const onData = (d) => {
    buf += d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n");
    const ls = buf.split("\n"); buf = ls.pop(); pending.push(...ls); out += ls.join("\n") + "\n";
  };
  p.stdout.on("data", onData); p.stderr.on("data", onData);
  const flush = async () => { if (pending.length) { const l = pending; pending = []; await page.evaluate((x) => window.__add(x), l); } };
  const timer = setInterval(flush, 150);
  const code = await new Promise((r) => p.on("close", r));
  clearInterval(timer);
  if (buf) pending.push(buf);
  await flush();
  if (code !== 0) throw new Error(`exit ${code}: ${cmd}\n${out.slice(-2000)}`);
  return out;
}

const SLIDE_CSS = `html,body{margin:0;height:100%;background:radial-gradient(1100px 650px at 25% 15%,#1a2a52,#0b1020);color:#eef1f7;font-family:Inter,system-ui,sans-serif}
  .s{position:absolute;inset:40px 56px 112px} h1{font-size:60px;margin:0 0 6px;letter-spacing:-.02em} h2{font-size:34px;margin:0 0 22px;letter-spacing:-.01em}
  .kick{font:700 15px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#ffc04d;margin-bottom:10px}
  .sub{font-size:22px;color:#b4bfd6;margin-bottom:28px;line-height:1.4} .grid{display:grid;gap:14px}
  .box{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:14px 18px}
  .box b{display:block;font-size:19px;margin-bottom:6px} .box span{color:#c3cce0;font-size:16px;line-height:1.45}
  .k{color:#ffc04d} .tag{display:inline-block;background:#2b59c3;border-radius:6px;padding:1px 8px;font-size:13px;margin:0 6px 4px 0;color:#fff}
  .arrow{font-size:26px;color:#7f95d0;text-align:center;align-self:center;line-height:1.2}
  ol.learn,ul.take{font-size:26px;line-height:1.6;margin:8px 0 0;padding-left:34px} ol.learn li::marker{color:#ffc04d;font-weight:700} ul.take li::marker{color:#3fb950}
  .num{display:inline-flex;width:30px;height:30px;border-radius:50%;background:#ffc04d;color:#111;font-weight:800;align-items:center;justify-content:center;margin-right:10px;font-size:16px}`;
export async function slide(html) {
  await unspot();
  await page.goto("about:blank");
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${SLIDE_CSS}</style></head><body><div class="s">${html}</div></body></html>`);
  await page.evaluate(OVERLAY);
  await caption();
}

/** Title card of a part: what you will learn/do. Marks the cut for the per-part videos; sets = which versions include it. */
export async function part(n, slug, title, learn, sets = ["full"]) {
  const of = OPTS.total ? ` of ${OPTS.total}` : "";
  partLabel = `${OPTS.unit} ${n}${of} · ${title}`;
  await hold(GAP);
  timeline.parts.push({ n, slug, title, sets, start: now() });
  await slide(`<div style="margin-top:70px"><div class="kick">${OPTS.unit} ${n}${of}</div><h1>${title}</h1>
    <div class="sub" style="margin-top:26px">${OPTS.learn ?? "You will learn"}:</div><ol class="learn">${learn.map((l) => `<li>${l}</li>`).join("")}</ol></div>`);
  await say(`p${n}`);
  await hold(1200);
}
/** A cut point without a title card (intro, outro, short-version-only segments). */
export function segment(n, slug, title, sets = ["full"]) { timeline.parts.push({ n, slug, title, sets, plain: true, start: now() }); }
export async function takeaways(n, items, sayId = `t${n}`) {
  await hold(GAP);
  await slide(`<div style="margin-top:80px"><div class="kick">${OPTS.unit} ${n} · key takeaways</div><h2 style="font-size:42px">What to remember</h2>
    <ul class="take">${items.map((l) => `<li>${l}</li>`).join("")}</ul></div>`);
  await say(sayId);
  await hold(1500);
}

// ------------------------------------------------------------------------------------------------ run
export async function run(parts) {
  const browser = await chromium.launch();
  // A 1280×720 page keeps text large; mix.py upscales the recording to 1920×1080 (Playwright records at CSS size).
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  await context.addInitScript(OVERLAY);
  page = await context.newPage();
  t0 = Date.now();
  let failed;
  try {
    for (const [name, fn] of Object.entries(parts)) {
      if (ONLY && !ONLY.includes(name)) continue;
      console.log(`[${(now() / 1000).toFixed(0)}s] ${name}`);
      await fn();
    }
  } catch (e) {
    failed = e;
    console.error(e);
    await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  } finally {
    await hold(800);
    timeline.end = now();
    timeline.name = OPTS.name;
    timeline.unit = OPTS.unit;
    const video = page.video();
    await context.close();
    await browser.close();
    timeline.video = await video.path();
    fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 1));
    console.log(`video ${timeline.video}, ${timeline.says.length} captions, ${timeline.ff.length} sped-up waits, ${timeline.parts.length} parts`);
  }
  process.exit(failed ? 1 : 0);
}
