import * as React from "react";

/**
 * Tiny, safe markdown renderer for model output: paragraphs, bullet and
 * numbered lists, **bold** and `code`. Text is rendered as React text nodes,
 * never as HTML.
 */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={`${keyPrefix}-${i++}`} className="font-semibold text-text">{token.slice(2, -2)}</strong>);
    else out.push(<code key={`${keyPrefix}-${i++}`} className="rounded bg-surface-2 px-1 text-[0.92em]">{token.slice(1, -1)}</code>);
    last = m.index! + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const content = para.join(" ").replace(/^#{1,6}\s+/, "");
      blocks.push(<p key={`p${blocks.length}`}>{inline(content, `p${blocks.length}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`l${blocks.length}`} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
          {list.items.map((it, i) => (
            <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2.5 leading-relaxed">{blocks}</div>;
}
