# Design system

The shared look of `apps/web` and `apps/advocate-portal`: tokens, two themes,
self-hosted fonts, component classes and an icon set. Everything lives in
`packages/shared/src/styles/` and is imported by each app's `globals.css`.

Brand: ink-navy surfaces, one brass accent, a serif display face for headings,
the section-sign (§) logo mark. Dark is ink-navy with brass; light is a warm
paper theme with ink text and a deeper bronze accent (not an inversion).

- [Files](#files)
- [Theme contract](#theme-contract)
- [Tokens](#tokens)
- [Typography and fonts](#typography-and-fonts)
- [Class catalogue](#class-catalogue)
- [Icons](#icons)
- [Rules](#rules)
- [Accessibility notes](#accessibility-notes)
- [Changing the system](#changing-the-system)

## Files

```
packages/shared/src/styles/
  design-system.css   entry point; only @imports the files below
  tokens.css          @theme (dark defaults + Tailwind registration), light overrides, scales
  base.css            body, headings, focus ring, selection, scrollbars, reduced motion, print
  layout.css          page/section helpers, site header/nav/brand/footer, hero background
  typography.css      .display, .title, .lede, .eyebrow, .link, measure helpers
  surfaces.css        panels, cards, lists, stats, dl, tables, avatar, disclosure, menus
  controls.css        buttons, inputs, checkbox/radio, chips, tabs, segmented, pager, composer
  feedback.css        badges, tags, alerts, banners, notes, skeleton
  prose.css           .prose-legal, .cite, .statute, .paper, .blank, .stamp, .bubble-user
  legacy.css          temporary shims (see Rules)

apps/*/src/app/globals.css   Tailwind + font CSS + design-system.css (identical in both apps)
apps/*/src/components/icons.tsx   inline SVG icons (identical in both apps)
```

Both apps import, in this order: `tailwindcss`, the `@fontsource*` CSS, then
`@legal-platform/shared/styles/design-system.css`. The shared package does not
bundle fonts; each app owns its font dependencies
(`@fontsource-variable/newsreader`, `@fontsource-variable/instrument-sans`,
`@fontsource/ibm-plex-mono`). There is no network access at runtime.

## Theme contract

| Item                  | Value                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attribute             | `<html data-theme="light">` or `<html data-theme="dark">`. Absent = follow the OS.                                                                                                                               |
| Persistence           | `localStorage["la-theme"]` is `"light"` or `"dark"`. Key removed = system.                                                                                                                                       |
| First paint           | An inline script in each app layout applies the attribute before paint (no flash).                                                                                                                               |
| CSS                   | Dark tokens on `:root`; `@media (prefers-color-scheme: light)` redefines them for `:root:not([data-theme="dark"])`; `:root[data-theme="light"]` redefines them explicitly. `color-scheme` is set in every block. |
| Specificity of intent | An explicit `data-theme` always beats the OS preference, in both directions.                                                                                                                                     |

Recommended no-flash script (put it in `<head>`, add `suppressHydrationWarning`
to `<html>` because the attribute is set before React hydrates):

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem('la-theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();
</script>
```

Setting the theme from a toggle:

```ts
function setTheme(next: 'light' | 'dark' | 'system') {
  const root = document.documentElement;
  try {
    if (next === 'system') localStorage.removeItem('la-theme');
    else localStorage.setItem('la-theme', next);
  } catch {}
  if (next === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);
}
```

A toggle that shows the right icon without JavaScript state (no hydration
mismatch): render both icons and let CSS pick, because `.on-dark` is visible
only while the resolved theme is dark and `.on-light` only while it is light.

```tsx
<button className="btn btn-ghost btn-icon" aria-label="Toggle theme" onClick={…}>
  <SunIcon className="on-dark h-5 w-5" />
  <MoonIcon className="on-light h-5 w-5" />
</button>
```

The `<meta name="theme-color">` and `viewport.colorScheme` belong to the layouts:
use `light dark` and per-scheme theme colours (`#0a0f1a` dark, `#f5f1e8` light).

## Tokens

Every colour, font, text size, radius and shadow below is registered with
Tailwind (`@theme static`), so the matching utilities exist and follow the
theme: `bg-canvas`, `text-fg-muted`, `border-line`, `text-ok`, `bg-warn-bg`,
`rounded-panel`, `shadow-raised`, `font-display`, `text-display-lg`, `bg-hover`.
Opacity modifiers work (`bg-canvas/70`).

### Core colour tokens (differ per theme)

| Token                     | Dark                  | Light                 | Use                                            |
| ------------------------- | --------------------- | --------------------- | ---------------------------------------------- |
| `--color-canvas`          | `#0a0f1a`             | `#f5f1e8`             | page background                                |
| `--color-elevated`        | `#101827`             | `#fffdf8`             | opaque raised surface: menu, composer, paper   |
| `--color-sunken`          | `#070b14`             | `#ece6d9`             | wells: segmented track                         |
| `--color-field`           | white 3.5%            | `#fffefb`             | input background                               |
| `--color-glass`           | white 4%              | paper 80%             | `.surface` fill                                |
| `--color-tint`            | white 2.5%            | paper 55%             | `.surface-flat`, cards, list fill              |
| `--color-glass-hover`     | white 6.5%            | `#fffefb`             | interactive surface hover                      |
| `--color-hover`           | white 5%              | warm ink 5.5%         | hover wash for rows and ghost buttons          |
| `--color-pressed`         | white 9%              | warm ink 10%          | active wash                                    |
| `--color-fg-strong`       | `#f6f8fc`             | `#0d131f`             | headings, bold text                            |
| `--color-fg`              | `#e8ecf3`             | `#1a2130`             | body text                                      |
| `--color-fg-muted`        | `#a6b0c3`             | `#4a5365`             | secondary text                                 |
| `--color-fg-subtle`       | `#8490a8`             | `#5a6376`             | captions, placeholders (>= 4.5:1)              |
| `--color-line`            | white 8%              | warm ink 12%          | hairlines, card borders                        |
| `--color-line-strong`     | white 15%             | warm ink 22%          | emphasised borders                             |
| `--color-control`         | `#5d697f`             | `#8a8678`             | input / checkbox border (>= 3:1)               |
| `--color-control-hover`   | `#7886a0`             | `#6b6759`             | input border on hover                          |
| `--color-accent`          | `#d6b06a` brass       | `#80530f` bronze      | primary fill, accent text, focus ring          |
| `--color-accent-strong`   | `#ebcd92`             | `#613c07`             | primary hover, emphasised accent text          |
| `--color-accent-fg`       | `#1b1508`             | `#fffaf0`             | text on an accent fill                         |
| `--color-brass`           | `#d6b06a`             | `#b78a3a`             | decoration only: logo, rules, glows, card edge |
| `--color-link` / `-hover` | `#ebcd92` / `#f6dfae` | `#80530f` / `#613c07` | links                                          |
| `--color-ok`              | `#62d394`             | `#17603a`             | success text/icon                              |
| `--color-warn`            | `#f2c14e`             | `#8c3f07`             | caution text/icon                              |
| `--color-danger`          | `#f27a7a`             | `#a61f19`             | error text/icon                                |
| `--color-info`            | `#8fb5ff`             | `#1a46a6`             | information text/icon                          |
| `--tone-tint`             | `12%`                 | `8%`                  | strength of the `-bg` tints                    |

### Derived colour tokens (computed with `color-mix`; never override per theme)

`--color-accent-soft`, `--color-accent-line`, `--color-ring` (focus glow),
`--color-selection`, and for each tone `ok | warn | danger | info`:
`--color-{tone}-bg` (tint) and `--color-{tone}-line` (border). The pair to use
is `text-{tone}` on `bg-{tone}-bg` with `border-{tone}-line`. Also
`--color-skeleton-a/b`, `--color-scroll`, `--color-scroll-hover`.

### Atmosphere and image tokens (per theme)

`--glow-a`, `--glow-b` (body backdrop), `--hero-glow`, `--grid-line` (hero
background), `--select-chevron` and `--check-mark` (data-URI images, one per
theme), `--show-on-dark`, `--show-on-light` (drive `.on-dark` / `.on-light`).

### Elevation (theme-aware shadows)

| Level | Token / class                                | Used for                      |
| ----- | -------------------------------------------- | ----------------------------- |
| 0     | `.surface-flat`, `.card`, `.card-flat`       | fill and hairline only        |
| 1     | `shadow-raised`, `.card-raised`              | cards, paper, segmented thumb |
| 2     | `.surface` (`--shadow-edge` + raised, glass) | primary panels                |
| 3     | `shadow-float`, `.menu`, `.composer`         | things floating over content  |
| 4     | `shadow-overlay`                             | reserved (no modals today)    |

`--shadow-edge` is the 1px top highlight used on glass.

### Shape, spacing, motion, layers

- Radius: `--radius-xs` 4px (tags, cite) · `--radius-sm` 6px · `--radius-control`
  8px (buttons, inputs) · `--radius-item` 12px (items, alerts) ·
  `--radius-panel` 16px (panels, auth card) · `--radius-pill`. Utilities:
  `rounded-control`, `rounded-item`, `rounded-panel`, `rounded-pill`.
- Spacing: Tailwind's 4px scale for utilities; named tokens for component CSS
  `--space-1..8` (0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4.5 rem), `--gutter` (1rem),
  `--section-gap` (fluid 3 to 5.5rem), `--page-max` 72rem, `--page-wide` 80rem,
  `--page-narrow` 46rem, `--measure` 66ch, `--header-h` 3.5rem.
- Motion: `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms,
  `--ease-out-soft`. Keyframes `la-shimmer`, `la-spin`, `la-rise`, `la-fade`.
  `prefers-reduced-motion` collapses all animation and transition durations.
- Layers: `--z-header` 30, `--z-menu` 40, `--z-toast` 50.

## Typography and fonts

| Role        | Family                                                               | Where                                                                                               |
| ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Display     | **Newsreader** (variable: optical size 6-72, weight 200-800, italic) | page and section titles, statistics, statute quotes, document paper, wordmark. Used with restraint. |
| Text and UI | **Instrument Sans** (variable weight 400-700, italic)                | body, controls, navigation, tables                                                                  |
| Mono        | **IBM Plex Mono** (400, 500; latin and latin-ext)                    | citations, ids, section numbers, template blanks, stamps                                            |

Self-hosted with `@fontsource` packages (latin and latin-ext subsets, plus
vietnamese for Newsreader's variable files, all lazily fetched by
`unicode-range`). Tokens: `--font-display`, `--font-sans`, `--font-mono`
(utilities `font-display`, `font-sans`, `font-mono`). Fallbacks, in order:
Iowan Old Style / Palatino / Georgia for display; system UI stack plus Noto
Sans Devanagari and Nirmala UI for sans (so Hindi text renders in a proper
face); Cascadia Mono / Menlo / Consolas for mono. `font-display: swap`.

Type scale (`text-*` utilities, size / line-height): `xs` 12 / 1.5 · `sm` 14 /
1.55 · `base` 16 / 1.6 · `lg` 18 / 1.55 · `xl` 20 / 1.4 · `2xl` 24 / 1.25 ·
`3xl` 30 / 1.15 · `4xl` 36 / 1.1 · `5xl` 48 / 1.05. Fluid display sizes:
`text-display-sm` (26-34px), `text-display-md` (30-44px), `text-display-lg`
(36-60px). Body is 16px. Headings get `text-wrap: balance`, paragraphs
`text-wrap: pretty`.

## Class catalogue

Classes in **bold** existed before and keep working unchanged in markup.

### Layout and chrome (`layout.css`)

| Class                                                | Use                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **`.page`**                                          | Centered page container, max 72rem, responsive gutters.                                      |
| `.page-wide` / **`.page-narrow`** / **`.page-form`** | Width modifiers: 80rem / 46rem / 28rem.                                                      |
| **`.auth-card`**                                     | Centered single card for login, register and account pages (combine with `.surface`).        |
| `.section`, `.section-sm`                            | Top margin between page sections (fluid).                                                    |
| `.section-head`, `.section-title`, `.section-lede`   | Section heading row with serif title and a muted line.                                       |
| `.stack`, `.stack-sm`, `.stack-lg`                   | Vertical flex with a gap (`--stack-gap`).                                                    |
| `.cluster`, `.cluster-lg`                            | Wrapping horizontal row with a gap, vertically centered.                                     |
| `.grid-auto`, `.grid-auto-sm`, `.grid-auto-lg`       | Auto-fill card grid (min column 16 / 11 / 22rem; override `--grid-min`).                     |
| `.divider`, `.divider-v`, `.divider-label`           | Hairline rule, vertical rule, rule with a centered caps label.                               |
| `.rule-brass`                                        | Short brass rule under a heading.                                                            |
| `.site-header`, `.site-header-inner`                 | Sticky translucent header and its centered inner row.                                        |
| `.brand`, `.brand-mark`, `.brand-name`               | Wordmark: § in a bordered brass tile plus the serif name.                                    |
| `.nav-link`                                          | Header nav item; `aria-current="page"` or `.is-active` adds the brass underline.             |
| `.site-footer`                                       | Footer with top rule and small subtle text.                                                  |
| `.hero-bg`                                           | CSS-only hero backdrop (brass glow + fading ruled grid), theme-aware. Wrap the hero section. |
| `.hero-sign`                                         | Optional ghosted § inside `.hero-bg`: `<span class="hero-sign" aria-hidden="true">§</span>`. |
| `.rise-in`, `.fade-in`                               | Entrance animations; stagger with `style="--i: 2"`.                                          |
| `.on-dark`, `.on-light`                              | Show an element only while the resolved theme is dark / light.                               |

### Typography (`typography.css`)

| Class                                                       | Use                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **`.display`**                                              | Serif display heading (weight 500, tight tracking, balanced). Pair with a `text-*` size or: |
| `.display-sm`, `.display-md`, `.display-lg`                 | Fluid display sizes with matching leading; `em` inside `.display` is italic.                |
| `.title`, `.title-lg`                                       | Sans heading for cards, rows and panels.                                                    |
| `.lede`                                                     | Intro paragraph (18px, muted, 58ch).                                                        |
| **`.eyebrow`**                                              | Small caps accent label above a title. `.eyebrow-rule` adds a leading brass dash.           |
| **`.muted`**, **`.subtle`**, `.strong`                      | Secondary, tertiary and strong text colours.                                                |
| **`.link`**                                                 | Accent link with underline.                                                                 |
| `.measure`, `.measure-sm`, `.measure-lg`                    | Max line length 66ch / 52ch / 76ch.                                                         |
| `.balance`, `.pretty`, `.tabular`, `.mono`, `.caps`, `.kbd` | Wrapping, tabular numerals, mono text, small caps label, keyboard key.                      |

### Surfaces and data (`surfaces.css`)

| Class                                                                          | Use                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **`.surface`**                                                                 | Glass panel (16px radius, blur, shadow). Primary panels only.                               |
| **`.surface-flat`**                                                            | Flat tinted item (12px radius, hairline).                                                   |
| **`.surface-interactive`**                                                     | Add to a surface for hover border/background/shadow.                                        |
| `.card`, `.card-flat`                                                          | Flat tinted card with padding (`--card-pad`).                                               |
| `.card-raised`                                                                 | Opaque card with a small shadow.                                                            |
| `.card-interactive`                                                            | Raised card that lifts and gets a brass border on hover (use on `<a>`).                     |
| `.card-accent`                                                                 | Card with a brass left edge; one per page at most.                                          |
| `.card-compact`, `.card-roomy`                                                 | Padding modifiers.                                                                          |
| `.list`, `.list-row`, `.list-flush`                                            | Divided rows in a rounded container / standalone rows / rows without container.             |
| `.list-row-interactive`, `.list-row-main`, `.list-row-title`, `.list-row-meta` | Hover wash, flexible text column, bold title, subtle meta line.                             |
| `.stat`, `.stat-value`, `.stat-label`, `.stat-note`                            | One metric: serif tabular number, caps label, note.                                         |
| `.stats`                                                                       | Row of `.stat` separated by hairlines (auto-fit columns).                                   |
| `.dl`, `.dl-stack`                                                             | Definition list as label / value grid (stacks under 480px) / always stacked.                |
| **`.data-table`**, `.table-wrap`                                               | Table styles; wrap in `.table-wrap` for rounded border and horizontal scroll.               |
| `.avatar`, `.avatar-sm/-lg/-xl`, `.avatar-square`, `.avatar-neutral`           | Initials avatar (serif, brass tint).                                                        |
| `.disclosure`                                                                  | `<details class="disclosure">` with a rotating chevron on the summary.                      |
| `.menu`, `.menu-item`, `.menu-label`, `.menu-sep`, `.menu-item-danger`         | Menu panel and rows (use `role="menu"`/`menuitem`).                                         |
| `.menu-anchor`, `.menu-pop`, `.menu-pop-left`                                  | Positioning wrapper and absolute popover (right-aligned / left-aligned). No modal involved. |

### Controls (`controls.css`)

| Class                                                                         | Use                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`.btn`**                                                                    | Base button (40px high, 8px radius). Always combine with a variant.                                                             |
| **`.btn-primary`**, **`.btn-secondary`**, **`.btn-ghost`**, **`.btn-danger`** | Brass fill / bordered / text-only / red tint.                                                                                   |
| `.btn-link`                                                                   | Looks like a link, behaves like a button.                                                                                       |
| **`.btn-sm`**, `.btn-lg`, `.btn-block`                                        | Sizes (32 / 48px) and full width. Small buttons grow to 40px on touch devices.                                                  |
| `.btn-icon`                                                                   | Square icon-only button (give it `aria-label`); combines with `-sm`/`-lg`.                                                      |
| `.btn[aria-busy="true"]` or `.is-loading`                                     | Loading state: spinner before the label, clicks blocked.                                                                        |
| `.btn-group`                                                                  | Wrapping row of buttons.                                                                                                        |
| `.spinner`, `.icon-spin`                                                      | CSS spinner; rotation for the `SpinnerIcon`.                                                                                    |
| `.field`                                                                      | Label + control + hint/error stack.                                                                                             |
| **`.label`**, `.label-optional`, **`.hint`**, **`.field-error`**              | Label (adds "(optional)"), helper text, error text. Use `aria-describedby`.                                                     |
| **`.input`**                                                                  | Styles `<input>`, `<select>` (custom chevron) and `<textarea>`; focus ring, hover, disabled, `aria-invalid="true"` error state. |
| `.input-sm`, `.input-lg`, `.input-error`, `.select`, `.textarea`              | Sizes and explicit state / element aliases.                                                                                     |
| `.input-wrap`                                                                 | Leading icon: `<div class="input-wrap"><SearchIcon /><input class="input"></div>`.                                              |
| `.checkbox`, `.radio`, `.choice`                                              | Custom checkbox/radio inputs and their label row.                                                                               |
| `.chip`                                                                       | Filter / suggestion pill; selected with `aria-pressed="true"` or `.is-active`.                                                  |
| `.tabs`, `.tab`                                                               | Underline tabs; selected with `aria-selected="true"`, `aria-current="page"` or `.is-active`.                                    |
| `.segmented`, `.segment`                                                      | Pill group (e.g. Light / Dark / System); selected with `aria-pressed`, `aria-selected`, `aria-checked` or `.is-active`.         |
| `.pager`, `.pager-nav`, `.pager-btn`, `.pager-info`                           | Pagination: summary text left, buttons right; current page `aria-current="page"`.                                               |
| `.composer`                                                                   | Chat input panel with focus-within ring (put a `<textarea>` and a button inside).                                               |

### Feedback (`feedback.css`)

| Class                               | Use                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`.badge`**                        | Neutral pill. Tones: **`.badge-ok`**, **`.badge-warn`**, **`.badge-danger`**, `.badge-info`, **`.badge-accent`**. `.badge-sm` for small. Always include text. |
| **`.dot`**                          | Status dot in `currentColor`.                                                                                                                                 |
| `.tag`                              | Rectangular mono label for ids, section numbers, dataset names.                                                                                               |
| **`.alert`**                        | Inline message. Tones: `.alert-info`, `.alert-ok`, **`.alert-warn`**, **`.alert-danger`**. A leading `<svg>` is tinted; `.alert-title` for the heading.       |
| `.banner`, `.banner-info/-warn/-ok` | Slim full-width strip, e.g. "AI answers are off".                                                                                                             |
| `.note`, `.note-warn`               | Quiet inline aside with a brass (or warn) left rule.                                                                                                          |
| **`.skeleton`**                     | Shimmer placeholder; size it with utilities. `.skeleton-circle`, `.skeleton-block` change the radius.                                                         |

### Prose and documents (`prose.css`)

| Class                       | Use                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`.prose-legal`**          | Long-form answer text: paragraphs, lists, `h3`, `strong`, `blockquote`, links, `code`. Max 72ch.                            |
| **`.cite`**                 | Numbered citation chip (mono). On `<a>` or `<button>` it fills with the accent on hover; `.is-active` for the selected one. |
| `.citation`                 | A full reference line in mono (court, date, case name).                                                                     |
| `.statute`, `.statute-cite` | Serif extract with a brass rule, and its source line.                                                                       |
| `.paper`, `.paper-pre`      | Document sheet for generated drafts (serif, brass top rule); `.paper-pre` keeps line breaks.                                |
| `.blank`                    | Fill-in-the-blank highlight inside a draft.                                                                                 |
| `.stamp`                    | Rubber-stamp label (DRAFT, TEMPLATE, SAMPLE, FIXTURE); tint with a `text-*` colour.                                         |
| `.bubble-user`              | The user's chat message bubble.                                                                                             |

## Icons

`apps/*/src/components/icons.tsx` (identical files). Each icon is a small
inline-SVG component: 24px grid, 1.75 stroke, round caps, `currentColor`.

```tsx
import { ScaleIcon, SearchIcon, Icons, type IconName } from '@/components/icons';

<SearchIcon className="h-4 w-4" />                 // decorative (aria-hidden)
<AlertIcon className="h-5 w-5" title="Warning" />  // exposed to screen readers
const I = Icons[name as IconName];                  // dynamic lookup
```

Size comes from `className`; without a size class an icon is `1em` and scales
with its text. Inside `.btn`, `.chip`, `.badge`, `.alert` and `.input-wrap` an
`<svg>` is sized and tinted automatically.

Available (`…Icon` suffix): Scale, Chat, Document, Users, Advocate, Search,
Shield, Sun, Moon, Menu, Close, Check, Alert, Info, ArrowRight, Copy, Download,
MapPin, Briefcase, Language, Spinner (rotates via `.icon-spin`), ExternalLink,
Phone, ChevronDown, Filter, Gavel, Home, Lock, Refresh, Eye.

## Rules

1. **Tokens, not colours.** Never write `bg-white/…`, `text-black`, `text-red-300`
   or hex values in components. Use `bg-canvas`, `bg-hover`, `text-fg-muted`,
   `border-line`, `text-danger`, `bg-danger-bg`, and so on; they follow the theme.
2. **Status is never colour alone.** Pair a tone with a word, and ideally an icon.
3. **One accent.** Brass (bronze on paper) only. Decorative metal uses
   `--color-brass`; text and fills use `--color-accent`.
4. **Serif with restraint.** Display face for titles, section titles, big numbers,
   statute quotes and the document sheet. Never for buttons, labels or body text.
5. **Glass only floats.** `.surface` (blur) for the header, primary panels and the
   composer. Everything nested is flat (`.surface-flat`, `.card`).
6. **Radius scale only:** 4 / 8 / 12 / 16 / pill.
7. **Focus is visible everywhere.** The global ring is a 2px accent outline with a
   2px offset; inputs use a border plus 3px glow. Do not remove outlines.
8. **Respect touch and motion.** Use the provided classes (they handle 40px
   targets, 16px inputs on touch and reduced motion).
9. **Lines that must be seen** (input borders) use `--color-control`
   (3:1 non-text contrast); decorative hairlines use `--color-line`.
10. **Legacy shims** (`legacy.css`) map Tailwind's `bg-white/[0.04|0.06|0.07]` hover
    washes to `--color-hover` under the light theme. They are only there for old
    markup; use `bg-hover` or `.nav-link` in new code and delete a shim once
    nothing uses it.

## Accessibility notes

Measured contrast (WCAG 2.x, on the page canvas):

| Pair                       | Dark   | Light  |
| -------------------------- | ------ | ------ |
| `fg` on `canvas`           | 16.2   | 14.3   |
| `fg-muted` on `canvas`     | 8.8    | 6.9    |
| `fg-subtle` on `canvas`    | 6.0    | 5.4    |
| `accent` on `canvas`       | 9.4    | 5.9    |
| `accent-fg` on `accent`    | 8.9    | 6.4    |
| each tone on its own `-bg` | >= 6.1 | >= 5.7 |

`fg-subtle` is >= 4.8:1 on `sunken` in light. Non-text boundaries of form
controls use `--color-control` (about 3.3:1). Forced-colours mode gives buttons,
inputs, chips and alerts a visible border. Print styles drop backgrounds and
hide the header and footer (`.no-print` hides anything else).

## Changing the system

- A new colour token: add it to `@theme static` in `tokens.css` (dark value),
  then add the light value to **both** light blocks (the `@media` block and the
  `[data-theme="light"]` block must stay identical). Prefer a derived
  `color-mix()` token over a second hand-picked value.
- A new component class: put it in the file that matches its group, inside
  `@layer components`, using only tokens. Add a row to the catalogue above.
- Fonts: change the `@import`s in both apps' `globals.css` and the three
  `--font-*` tokens together; keep the fallback stacks.
- Verify in both themes at 1280 and 390 px, and with the OS preference set the
  opposite way to an explicit `data-theme` to prove the explicit choice wins.
