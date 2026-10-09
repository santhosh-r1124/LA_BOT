/**
 * Turns a generated draft (plain text with a little Markdown) into structured
 * pieces the page can lay out as a document: the label line, the document body,
 * the Notes section, blocks, inline tokens and checklist items.
 *
 * Everything is parsed into data and rendered as React elements, never as HTML,
 * so model output cannot inject markup. The same parser handles the server's
 * template drafts and free-form AI drafts: the Notes heading and bullet style
 * can vary, so every pattern here is forgiving and falls back to plain text.
 */

export interface SplitDraft {
  /** The "TEMPLATE DRAFT - ..." line the server puts first, when present. */
  label: string | null;
  /** The document itself, without the label line or the Notes section. */
  body: string;
  /** Everything after the Notes heading, or null when there is none. */
  notes: string | null;
}

const LABEL_LINE = /^template draft\b/i;

// "Notes", "## Notes", "**Notes**", "Notes:", "### Notes on this draft", "Notes and next steps".
const NOTES_HEADING =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:drafting\s+)?notes?(?:\s+(?:and|&|on|for)\s+[A-Za-z ,'-]{1,40})?\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;

export function splitDraft(text: string): SplitDraft {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && !(lines[start] ?? '').trim()) start++;

  let label: string | null = null;
  const first = (lines[start] ?? '').trim();
  if (LABEL_LINE.test(first)) {
    label = first;
    start++;
  }

  let notesAt = -1;
  for (let i = lines.length - 1; i >= start; i--) {
    if (NOTES_HEADING.test(lines[i] ?? '')) {
      notesAt = i;
      break;
    }
  }

  const body = lines
    .slice(start, notesAt >= 0 ? notesAt : undefined)
    .join('\n')
    .trim();
  const notes =
    notesAt >= 0
      ? lines
          .slice(notesAt + 1)
          .join('\n')
          .trim()
      : '';

  // A "Notes" line with nothing before it is not a notes section: keep it all as the body.
  if (!body) {
    return { label, body: lines.slice(start).join('\n').trim(), notes: null };
  }
  return { label, body, notes: notes || null };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type DraftBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string; level: 2 | 3 }
  | { type: 'clause'; number: string; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'rule' };

const HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,})\s*$/;
const CLAUSE = /^\s*(\d+(?:\.\d+)+)\.?\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

/** Split a draft body into blocks, keeping line breaks inside paragraphs. */
export function parseDraftBlocks(body: string): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let clause: { number: string; lines: string[] } | null = null;
  let hasTitle = false;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
    if (list) blocks.push({ type: 'list', ...list });
    list = null;
    if (clause)
      blocks.push({ type: 'clause', number: clause.number, text: clause.lines.join('\n') });
    clause = null;
  };

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const depth = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      if (depth === 1 && !hasTitle) {
        hasTitle = true;
        blocks.push({ type: 'title', text });
      } else {
        blocks.push({ type: 'heading', text, level: depth <= 2 ? 2 : 3 });
      }
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }

    const numberedClause = CLAUSE.exec(line);
    if (numberedClause) {
      flush();
      clause = { number: numberedClause[1] ?? '', lines: [numberedClause[2] ?? ''] };
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length || clause || (list && list.ordered !== ordered)) flush();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) || 1 : 1, items: [] };
      list.items.push((bullet ? bullet[1] : numbered?.[2]) ?? '');
      continue;
    }

    // A deeper-indented line continues the list item or clause above it.
    if (list && /^\s{2,}\S/.test(raw) && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (clause) {
      clause.lines.push(line.trim());
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  /** `[SOMETHING TO FILL IN]`: a gap the reader must complete. */
  | { type: 'blank'; text: string }
  /** `____`: a line to sign or write on. `length` is the run of underscores. */
  | { type: 'line'; length: number };

const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]{1,100}\](?!\()|_{4,}|\*[^*\s](?:[^*\n]*[^*\s])?\*)/g;

/** Split one line of text into plain text, emphasis, blanks and signature lines. */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const push = (token: InlineToken) => {
    const last = tokens[tokens.length - 1];
    if (token.type === 'text' && last?.type === 'text') last.text += token.text;
    else tokens.push(token);
  };

  const parts = text.split(INLINE);
  parts.forEach((part, i) => {
    if (!part) return;
    // String.split with a capture group puts the matches at odd indexes.
    if (i % 2 === 0) {
      push({ type: 'text', text: part });
    } else if (part.startsWith('**')) {
      push({ type: 'bold', text: part.slice(2, -2) });
    } else if (part.startsWith('[')) {
      // "[1]" and the like are not gaps; a gap has a letter in it.
      push(/\p{L}/u.test(part) ? { type: 'blank', text: part } : { type: 'text', text: part });
    } else if (part.startsWith('_')) {
      push({ type: 'line', length: part.length });
    } else {
      push({ type: 'italic', text: part.slice(1, -1) });
    }
  });
  return tokens;
}

/** How many `[GAPS]` the body leaves for the reader to fill in. */
export function countBlanks(body: string): number {
  let count = 0;
  for (const line of body.split('\n')) {
    for (const token of tokenizeInline(line)) if (token.type === 'blank') count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type NoteEntry =
  { type: 'group'; text: string } | { type: 'item'; lead: string | null; text: string };

const WHOLE_LINE_BOLD = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;

function stripEmphasis(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1');
}

/** "Information normally needed: the name..." -> lead and rest, when the lead is short. */
function splitLead(text: string): { lead: string | null; text: string } {
  const match = /^([^:.!?\n]{2,60}):\s+([\s\S]+)$/.exec(text);
  if (match) {
    const lead = (match[1] ?? '').trim();
    if (lead.split(/\s+/).length <= 8 && !lead.includes('[')) {
      const rest = (match[2] ?? '').trim();
      // "Review: this is..." reads better as a heading and a sentence: capitalise the sentence.
      return { lead, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
    }
  }
  return { lead: null, text };
}

/**
 * Break the Notes section into checklist entries: one per bullet or paragraph,
 * with short headings kept as group labels. A leading "Label:" on an item is
 * pulled out so the page can set it in bold.
 */
export function parseNotes(notes: string): NoteEntry[] {
  const entries: NoteEntry[] = [];
  let current: string | null = null;

  const flush = () => {
    if (current !== null && current.trim()) {
      const { lead, text } = splitLead(stripEmphasis(current.trim()));
      entries.push({ type: 'item', lead, text });
    }
    current = null;
  };

  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    const boldLine = WHOLE_LINE_BOLD.exec(line);
    if (heading || boldLine) {
      flush();
      const text = stripEmphasis((heading?.[2] ?? boldLine?.[1] ?? '').trim()).replace(/:$/, '');
      if (text) entries.push({ type: 'group', text });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      current = (bullet ? bullet[1] : numbered?.[2]) ?? '';
    } else if (current !== null) {
      current += ` ${line.trim()}`;
    } else {
      current = line.trim();
    }
  }
  flush();
  return entries;
}

/** The note items only (no group labels). */
export function noteItems(entries: NoteEntry[]): Array<Extract<NoteEntry, { type: 'item' }>> {
  return entries.filter((e): e is Extract<NoteEntry, { type: 'item' }> => e.type === 'item');
}
