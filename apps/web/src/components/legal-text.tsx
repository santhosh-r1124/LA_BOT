import { Fragment, type ReactNode } from 'react';

/**
 * Renders model output (a small Markdown subset) as React elements — never
 * `dangerouslySetInnerHTML`, so model text can't inject markup.
 *
 * Supported: paragraphs, `-`/`*` bullets, `1.` numbered lists, `#`–`###`
 * headings, `**bold**`, and `[n]` citation markers, which become links to the
 * numbered source list when `sourceCount` covers them.
 */
export function LegalText({
  text,
  sourceIdPrefix,
  sourceCount = 0,
}: {
  text: string;
  sourceIdPrefix?: string;
  sourceCount?: number;
}) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const inline = (value: string, key: string) => (
    <Inline key={key} text={value} sourceIdPrefix={sourceIdPrefix} sourceCount={sourceCount} />
  );

  const flushParagraph = () => {
    if (paragraph.length) {
      const k = `p${blocks.length}`;
      blocks.push(<p key={k}>{inline(paragraph.join(' '), k)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((item, i) => <li key={i}>{inline(item, `${k}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
      list = null;
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,3}\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const k = `h${blocks.length}`;
      blocks.push(<h3 key={k}>{inline(heading[1] ?? '', k)}</h3>);
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const content = (bullet ?? numbered)?.[1] ?? '';
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(content);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();

  return <div className="prose-legal">{blocks}</div>;
}

function Inline({
  text,
  sourceIdPrefix,
  sourceCount,
}: {
  text: string;
  sourceIdPrefix?: string;
  sourceCount: number;
}) {
  // Tokens: **bold** | [n] / [n, m]
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        const cite = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(part);
        if (cite) {
          const numbers = (cite[1] ?? '').split(',').map((n) => Number(n.trim()));
          return (
            <Fragment key={i}>
              {numbers.map((n) =>
                sourceIdPrefix && n >= 1 && n <= sourceCount ? (
                  <a
                    key={n}
                    href={`#${sourceIdPrefix}-${n}`}
                    className="cite"
                    aria-label={`Source ${n}`}
                  >
                    {n}
                  </a>
                ) : (
                  <span key={n} className="cite" aria-label={`Source ${n}`}>
                    {n}
                  </span>
                ),
              )}
            </Fragment>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
