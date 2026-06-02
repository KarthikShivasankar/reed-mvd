import React from "react";

export function SectionHead({ idx, title, desc }: { idx: string; title: string; desc?: string }) {
  return (
    <div className="section-head">
      <span className="idx">{idx}</span>
      <h2>{title}</h2>
      {desc && <span className="desc">{desc}</span>}
    </div>
  );
}

export function Panel({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel">
      {title && (
        <div className="panel-head">
          <span>{title}</span>
          {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  );
}

export function SensitivityChip({ value }: { value: string }) {
  return (
    <span className={`chip sev-${value}`}>
      <span className="dot" />
      {value}
    </span>
  );
}

export function DiscoverabilityChip({ value }: { value: string }) {
  return (
    <span className={`chip disc-${value}`}>
      <span className="dot" />
      {value}
    </span>
  );
}

export function TemplateChip({ value }: { value: string }) {
  return <span className="chip tmpl">{value}</span>;
}

export function Led({ online, label }: { online: boolean | null; label: string }) {
  const cls = online === null ? "" : online ? "online" : "offline";
  return (
    <span className={`led ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/**
 * JSON viewer with light syntax coloring. Tokenizes into React nodes (no
 * dangerouslySetInnerHTML) so there is no HTML-injection surface even if the
 * payload were ever untrusted.
 */
export function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts: React.ReactNode[] = [];
  // match "key": (keys) and : "value" (string values)
  const re = /("[^"]*"\s*:)|(:\s*"[^"]*")/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<span key={i++} className="k">{m[1]}</span>);
    else parts.push(<span key={i++} className="s">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <pre className="code">{parts}</pre>;
}
