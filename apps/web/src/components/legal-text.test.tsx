import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LegalText, parseLegalBlocks, type LegalTextProps } from './legal-text';

describe('parseLegalBlocks', () => {
  it('splits paragraphs, bullets, numbered lists, headings and quotes', () => {
    const blocks = parseLegalBlocks(
      [
        '# Heading',
        'First line',
        'continues here.',
        '',
        '- one',
        '- two',
        '',
        '3. three',
        '4. four',
        '',
        '> quoted',
        '> text',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'h', text: 'Heading' },
      { type: 'p', text: 'First line continues here.' },
      { type: 'ul', items: ['one', 'two'] },
      { type: 'ol', items: ['three', 'four'], start: 3 },
      { type: 'quote', text: 'quoted text' },
    ]);
  });

  it('keeps the starting number of an ordered list', () => {
    expect(parseLegalBlocks('2) b\n3) c')).toEqual([{ type: 'ol', items: ['b', 'c'], start: 2 }]);
  });

  it('joins an indented continuation line onto the list item', () => {
    expect(parseLegalBlocks('- item one\n   more of item one\n- item two')).toEqual([
      { type: 'ul', items: ['item one more of item one', 'item two'] },
    ]);
  });

  it('turns a horizontal rule into its own block', () => {
    expect(parseLegalBlocks('above\n---\nbelow')).toEqual([
      { type: 'p', text: 'above' },
      { type: 'hr' },
      { type: 'p', text: 'below' },
    ]);
  });

  it('does not mistake bold for a bullet', () => {
    expect(parseLegalBlocks('**Bold** start')).toEqual([{ type: 'p', text: '**Bold** start' }]);
  });

  it('is empty for blank input', () => {
    expect(parseLegalBlocks('')).toEqual([]);
    expect(parseLegalBlocks('\n\n  \n')).toEqual([]);
  });
});

const lt = (props: LegalTextProps) => createElement(LegalText, props);

describe('LegalText', () => {
  it('links a citation to its source when the source list covers it', () => {
    render(lt({ text: 'The Act applies [1].', sourceIdPrefix: 'src-x', sourceCount: 2, sourceTitles: ['Act A', 'Act B'] }));
    const link = screen.getByRole('link', { name: 'Source 1: Act A' });
    expect(link.getAttribute('href')).toBe('#src-x-1');
  });

  it('expands [1, 2] into two chips', () => {
    render(lt({ text: 'See both [1, 2].', sourceIdPrefix: 'p', sourceCount: 2 }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('marks a citation with no matching source as unlinked and says so', () => {
    render(lt({ text: 'Invented [5].', sourceIdPrefix: 'p', sourceCount: 2 }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('Citation 5, no matching source listed')).toBeTruthy();
  });

  it('calls onCite with the number when a chip is clicked', () => {
    const onCite = vi.fn();
    render(lt({ text: 'Yes [2].', sourceIdPrefix: 'p', sourceCount: 2, onCite }));
    screen.getByRole('link', { name: 'Source 2' }).click();
    expect(onCite).toHaveBeenCalledWith(2);
  });

  it('renders bold, italic and code without injecting markup', () => {
    const { container } = render(
      lt({ text: '**bold** and *italic* and `code` and <img src=x onerror=alert(1)>' }),
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('does not treat spaced asterisks as italics', () => {
    const { container } = render(lt({ text: '5 * 3 * 2 = 30' }));
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('5 * 3 * 2 = 30');
  });

  it('starts an ordered list at its own number', () => {
    const { container } = render(lt({ text: '3. three\n4. four' }));
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('shows a caret only while streaming', () => {
    const { container, rerender } = render(lt({ text: 'Streaming text', caret: true }));
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    rerender(lt({ text: 'Streaming text' }));
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  });
});
