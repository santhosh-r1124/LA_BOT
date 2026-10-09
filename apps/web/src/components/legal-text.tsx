// `React` is imported explicitly because vitest compiles JSX with the classic
// runtime (tsconfig has `jsx: preserve`); Next itself uses the automatic one.
import React, { Fragment, type ReactNode } from 'react';

/**
 * Renders model output (a small Markdown subset) as React elements, never
 * `dangerouslySetInnerHTML`, so model text can't inject markup.
 *
 * Supported: paragraphs, `-`/`*` bullets, `1.` numbered lists (keeping their
 * starting number), `#`-`###` headings, `>` quotes, `---` rules, `**bold**`,
 * `*italic*`, `` `code` ``, and `[n]` citation markers. A marker becomes a
 * link to the numbered source list when `sourceCount` covers it; a marker with
 * no matching source is drawn dashed and labelled as such, so an invented
 * citation never looks like a checked one.
 */

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[]; start: number };

/** Split text into blocks. Pure, so it can be tested without rendering. */
export function parseLegalBlocks(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let list: { ordered: boolean; items: string[]; start: number } | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: 'quote', text: quote.join(' ') });
    quote = [];
  };
  const flushList = () => {
    if (list) {
      blocks.push(
        list.ordered
          ? { type: 'ol', items: list.items, start: list.start }
          : { type: 'ul', items: list.items },
      );
    }
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,3}\s+(.*)$/.exec(line);
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    const rule = /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);

    if (!line.trim()) {
      flushAll();
    } else if (rule) {
      flushAll();
      blocks.push({ type: 'hr' });
    } else if (heading) {
      flushAll();
      blocks.push({ type: 'h', text: heading[1] ?? '' });
    } else if (quoted) {
      flushParagraph();
      flushList();
      if (quoted[1]?.trim()) quote.push(quoted[1].trim());
    } else if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      const content = (bullet ? bullet[1] : numbered?.[2]) ?? '';
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [], start: numbered ? Number(numbered[1]) || 1 : 1 };
      }
      list.items.push(content);
    } else if (list && /^\s{2,}\S/.test(rawLine) && list.items.length > 0) {
      // An indented line continues the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  flushAll();
  return blocks;
}

export interface LegalTextProps {
  text: string;
  /** Prefix of the element ids of the numbered source list: `${prefix}-${n}`. */
  sourceIdPrefix?: string;
  sourceCount?: number;
  /** Source titles by position, used as the chips' accessible names. */
  sourceTitles?: string[];
  /** Called when a citation chip is activated (open the matching source). */
  onCite?: (n: number) => void;
  /** Show a blinking caret after the last character while text is streaming. */
  caret?: boolean;
  className?: string;
}

export function LegalText({
  text,
  sourceIdPrefix,
  sourceCount = 0,
  sourceTitles,
  onCite,
  caret = false,
  className,
}: LegalTextProps) {
  const blocks = parseLegalBlocks(text);
  const lastIndex = blocks.length - 1;

  const inline = (value: string, key: string, withCaret: boolean) => (
    <Inline
      key={key}
      text={value}
      sourceIdPrefix={sourceIdPrefix}
      sourceCount={sourceCount}
      sourceTitles={sourceTitles}
      onCite={onCite}
      caret={withCaret}
    />
  );

  const rendered: ReactNode[] = blocks.map((block, i) => {
    const k = `b${i}`;
    const isLast = i === lastIndex;
    switch (block.type) {
      case 'p':
        return <p key={k}>{inline(block.text, k, caret && isLast)}</p>;
      case 'h':
        return <h3 key={k}>{inline(block.text, k, caret && isLast)}</h3>;
      case 'quote':
        return <blockquote key={k}>{inline(block.text, k, caret && isLast)}</blockquote>;
      case 'hr':
        return <hr key={k} className="border-line my-4" />;
      case 'ul':
        return (
          <ul key={k}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item, `${k}-${j}`, caret && isLast && j === block.items.length - 1)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={k} start={block.start}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item, `${k}-${j}`, caret && isLast && j === block.items.length - 1)}</li>
            ))}
          </ol>
        );
    }
  });

  // Streaming has produced no block yet (text is only whitespace): show the caret alone.
  if (caret && blocks.length === 0) rendered.push(<p key="caret">{<Caret />}</p>);

  return (
    <div className={['prose-legal text-[1.0625rem] leading-[1.7]', className].filter(Boolean).join(' ')}>
      {rendered}
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden="true"
      className="bg-accent ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[0.18em] animate-pulse rounded-[1px] align-baseline"
    />
  );
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*|\[\d+(?:\s*,\s*\d+)*\])/g;
const CITE = /^\[(\d+(?:\s*,\s*\d+)*)\]$/;

function Inline({
  text,
  sourceIdPrefix,
  sourceCount,
  sourceTitles,
  onCite,
  caret,
}: {
  text: string;
  sourceIdPrefix?: string;
  sourceCount: number;
  sourceTitles?: string[];
  onCite?: (n: number) => void;
  caret: boolean;
}) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        // String.split with a capture group puts the matched tokens at odd indexes.
        const isToken = i % 2 === 1;
        if (isToken && part.startsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (isToken && part.startsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (isToken && part.startsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        const cite = isToken ? CITE.exec(part) : null;
        if (cite) {
          const numbers = (cite[1] ?? '').split(',').map((n) => Number(n.trim()));
          return (
            <span key={i} className="whitespace-nowrap">
              {numbers.map((n) => {
                const valid = Boolean(sourceIdPrefix) && n >= 1 && n <= sourceCount;
                const title = valid ? sourceTitles?.[n - 1] : undefined;
                if (valid) {
                  return (
                    <a
                      key={n}
                      href={`#${sourceIdPrefix}-${n}`}
                      className="cite relative h-[1.3rem] min-w-[1.45rem] after:absolute after:-inset-[3px] after:content-['']"
                      aria-label={title ? `Source ${n}: ${title}` : `Source ${n}`}
                      title={title}
                      onClick={() => onCite?.(n)}
                    >
                      {n}
                    </a>
                  );
                }
                return (
                  <span
                    key={n}
                    className="cite h-[1.3rem] min-w-[1.45rem] border-dashed opacity-70"
                    aria-label={`Citation ${n}, no matching source listed`}
                    title="No matching source is listed for this citation"
                  >
                    {n}
                  </span>
                );
              })}
            </span>
          );
        }
        // Keep the last word and a following citation chip on one line.
        const next = parts[i + 1];
        const tieToChip = !isToken && next !== undefined && CITE.test(next) && /\s$/.test(part);
        return <Fragment key={i}>{tieToChip ? part.replace(/\s+$/, ' ') : part}</Fragment>;
      })}
      {caret && <Caret />}
    </>
  );
}
