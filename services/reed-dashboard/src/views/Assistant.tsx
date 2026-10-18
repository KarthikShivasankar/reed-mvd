import { useEffect, useRef, useState } from "react";
import type { Ctx } from "../App";
import { Panel, useToast } from "../ui";
import { Explainer, TAB_HELP } from "../guide";

interface Msg { role: "user" | "assistant"; content: string; meta?: string }

const SUGGESTIONS = [
  "Which open RFQs are there?",
  "Who can cast a 38 t rotor hub with DNV approval?",
  "Why was Śląsk Odlewnia rejected for R1?",
  "Compare the two qualified suppliers for the penstock (R9).",
];

export function Assistant({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces matter: scrollIntoView returns a Promise in recent browsers, and an effect may only return a cleanup
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function send(q: string) {
    if (!q.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const r = await ctx.api.chat(next.map(({ role, content }) => ({ role, content })));
      const meta = [
        r.source === "llm" ? "Qwen3.8 (local)" : "facts only - the local model was unavailable",
        r.toolsUsed.length ? `looked up: ${[...new Set(r.toolsUsed)].join(", ").replace(/_/g, " ")}` : "",
        r.redactions ? `${r.redactions} personal detail(s) removed` : "",
      ].filter(Boolean).join(" · ");
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, meta }]);
    } catch (e: any) {
      toast("error", `The assistant did not answer: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-head">
        <h1>Assistant</h1>
        <p className="muted">Ask about RFQs, rankings and suppliers. Answers come from the REED scorer and directory; the model runs inside the deployment and only sees organisation and part data.</p>
      </div>
      <Explainer help={TAB_HELP.assistant} />
      <Panel>
        <div className="chat" aria-live="polite">
          {msgs.length === 0 && (
            <div className="chat-empty">
              <p className="muted">Try one of these:</p>
              {SUGGESTIONS.map((s) => <button key={s} className="pick" onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <div className="bubble-text">{bold(m.content)}</div>
              {m.meta && <div className="bubble-meta">{m.meta}</div>}
            </div>
          ))}
          {busy && <div className="bubble assistant"><span className="spinner" aria-hidden /> Looking it up…</div>}
          <div ref={end} />
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} aria-label="Your question"
                 placeholder="Ask about an RFQ, a supplier or a rejection reason" disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>Ask</button>
        </form>
      </Panel>
    </>
  );
}

/** Renders **bold** from the model's markdown; everything else stays plain text (no HTML injection). */
function bold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}
