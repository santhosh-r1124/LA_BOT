# @legal-platform/web

The public website: Indian legal-information chat, the document assistant, the advocate directory and
user accounts. Next.js 15 (App Router, React 19) with Tailwind CSS v4, on port 3000.

## Run

Most people run everything with `docker compose up --build` from the repo root. To work on the site
with hot reload, start the API first (see [`apps/api/README.md`](../api/README.md)), then:

```bash
pnpm install                              # once, from the repo root
pnpm --filter @legal-platform/web dev     # http://localhost:3000
# or both frontends together: pnpm dev
```

No setup is needed. The site talks to the API at `http://localhost:8000` by default. To point it
elsewhere, copy `.env.example` to `.env.local` and change `NEXT_PUBLIC_API_BASE_URL` (a build-time,
browser-visible value; restart the dev server afterwards). `src/lib/env.ts` validates it with zod
and fails fast on a bad value. No keys belong here: AI keys are configured on the API.

## Pages

| Route                              | What it does                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                | Landing page with a question box and a live status panel from `GET /api/v1/status` (mode, library, directory)                                                                |
| `/chat`                            | Streaming legal chat with numbered sources, risk badge, recommended advocates and history when logged in. `?q=<question>` is read once on load and sent as the first message |
| `/documents`                       | Pick one of 11 document types, answer the questionnaire, get a draft and notes (copy or download as text)                                                                    |
| `/advocates`, `/advocates/[id]`    | Search and filter the directory; advocate profile                                                                                                                            |
| `/advocates/import`                | Admin only: upload an advocate CSV                                                                                                                                           |
| `/login`, `/register`              | Sign in and sign up (demo sign-in is open by default on the API)                                                                                                             |
| `/profile`                         | Your details and state                                                                                                                                                       |
| `/verify-email`, `/reset-password` | Landing pages for the links the API writes to its log                                                                                                                        |
| `/api/health`                      | Route handler that combines "web is up" with the API's `GET /health/ready`                                                                                                   |

## Offline and AI mode

The UI never assumes AI is on. It reads `llm.mode` from `GET /api/v1/status` and each reply's
`answer_mode` (`"ai"` or `"sources_only"`), and `generation_mode` (`"ai"` or `"template"`) on
documents:

- **Sources-only replies** show the passages with their numbered `[1]`, `[2]` sources and a note that
  AI answers are off. An empty library shows an explanatory notice instead of a blank page.
- **Template drafts** are labelled as such, with placeholders left for the user to fill in.
- The same pages work in both modes; only the notices and wording differ.

## Structure

```
src/
├── app/                 # routes; each feature keeps its components, helpers and CSS module beside its page
│   ├── chat/            #   composer, message list, notices, history sidebar, helpers (+ tests)
│   ├── documents/       #   type picker, questionnaire, result view, draft parsing (+ tests)
│   ├── advocates/       #   directory, profile, CSV import
│   └── login/ register/ profile/ ...
├── components/          # site header and footer, theme toggle, form and UI primitives, icons
└── lib/                 # typed API client, chat SSE client, auth context, theme, formatting
```

- `lib/api-client.ts` is a typed fetch wrapper that parses the shared `{error: {...}}` envelope.
  `lib/chat-client.ts` reads the SSE stream (`start`, `delta`, `done`, `error`).
- Shared enums, the mandatory disclaimer and the design system come from `@legal-platform/shared`.
- Fonts are self-hosted (Newsreader, Instrument Sans, IBM Plex Mono); nothing is fetched from a
  third party at runtime.

## Themes

Light and dark follow the OS. `<html data-theme="light|dark">` forces one; no attribute means "follow
the OS". The header menu offers Light, Dark and System and saves the choice in
`localStorage["la-theme"]` (removed for "system"). An inline script in `layout.tsx` applies the saved
choice before first paint, so there is no flash. The contract and tokens are in
[`docs/design-system.md`](../../docs/design-system.md).

## Checks

```bash
pnpm exec tsc --noEmit    # or: pnpm typecheck
pnpm exec eslint .        # or: pnpm lint
pnpm exec vitest run      # or: pnpm test
```

Run these from `apps/web`. Do not run `pnpm build` while `pnpm dev` is running; both write to
`.next`.
