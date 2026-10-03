# 0011 — Dynamic legal-source discovery replaces the static catalogue

- Status: Accepted
- Date: 2026-10-03
- Deciders: Platform team

## Context

Since Phase 3, the knowledge base's only source of new documents was
`official_sources.py`: a hand-typed, 15-entry Python tuple of India Code /
Legislative Department / MeitY URLs, run through `pnpm kb:seed`. Two problems
with that as the permanent mechanism:

1. **It doesn't scale and it goes stale.** Every new Act needs a code change
   and a redeploy. Government hosts move files — `official_sources.py`'s own
   docstring already warns of this — and a hand-maintained list has no way to
   notice a moved or newly-published source on its own.
2. **It can't cover state law at all.** `docs/project-status.md` flags
   "State/jurisdiction intelligence" as PARTIALLY COMPLETE specifically
   because "no state-specific sources (state stamp Acts, rules) are
   catalogued yet" — a static list that's already a manual chore at 15
   central Acts was never going to scale to 28 states' worth of stamp/
   registration rules.

## Decision

Split **discovery** (finding candidate sources) from **ingestion** (fetching/
chunking/embedding one — unchanged from Phase 3). A new `legal_source_catalog`
table holds discovered candidates; `SourceDiscoveryProvider` implementations
(`app/services/ingestion/discovery.py`) populate it; an admin (via
`POST /admin/legal-sources/discover` + `/catalog/*`) or `pnpm kb:discover`
decides what to ingest. `official_sources.py` still exists, wrapped as the
`curated` provider — a guaranteed fallback, no longer the only mechanism.

Two live providers were chosen because they're protocol/API-based rather than
HTML-scraped, so they don't rot every time a site is redesigned:

- **`india_code_oai`** — India Code's own URL pattern
  (`/handle/123456789/...`, `/bitstream/123456789/...`) is DSpace's
  signature. DSpace repositories expose a standard OAI-PMH feed
  (`ListRecords`/`oai_dc`, Dublin Core metadata) for harvesting their entire
  holdings — a protocol, not a page layout, so it survives redesigns that
  break scrapers. The exact path (`/oai/request` vs `/server/oai/request`)
  and the community/set id for "central Acts" vs. a given state aren't
  something this sandbox could verify (see Limitations); the provider tries
  each configured path and records which one actually works.
- **`hf_dataset`** — `RUDXLABS/india-central-state-acts` on Hugging Face is a
  public corpus of ~34,729 central *and state* Act PDFs scraped from India
  Code directly, which is exactly the state-law coverage gap above. Read via
  HF's public, keyless `datasets-server` rows API (no scraping, no auth).
  Column names are matched against several candidates defensively since the
  dataset's exact schema wasn't verifiable here either.

Discovered rows are deduplicated by `source_url` (`ON CONFLICT DO UPDATE`,
refreshing `title`/`last_seen_at`) so re-running discovery is idempotent and
cheap, and a row's `status` (`NEW` / `INGESTED` / `INVALID` / `SKIPPED`)
tracks its own lifecycle independent of re-discovery.

## Limitations (be honest about what's verified vs. not)

This was built in a network-sandboxed coding environment whose egress
allowlist covers only package registries and Anthropic's own API — it cannot
reach `indiacode.nic.in`, `huggingface.co`, or `data.gov.in` (confirmed: both
raw TCP connects and the agent's own fetch tool were rejected by the egress
proxy for all three). Consequently:

- The OAI-PMH endpoint path/set and the HF dataset's column names are
  **inferred from public documentation and conventions, not confirmed
  against a live response**. Both providers fail soft and record a specific,
  actionable error (wrong path tried, unrecognized columns) rather than
  silently returning nothing or crashing, so a real run immediately shows
  what to adjust.
- **Nothing here was actually ingested end-to-end during this change** — that
  needs both network access to the above hosts and `GEMINI_API_KEY` for
  embeddings, neither available in this sandbox. The `curated` provider
  (the original 15 sources) is unaffected and still works exactly as before.
- To run this for real: enable broader network access for wherever this
  runs (a coding/CI environment's network settings, or just run it from a
  normal machine/deployment with open egress), set `GEMINI_API_KEY`, then
  `pnpm kb:discover` (inspect `GET /admin/legal-sources/catalog`) followed by
  `pnpm kb:discover:ingest` or `POST /admin/legal-sources/catalog/ingest-all`.
  If a provider's error names a wrong path or unmapped column, fix the
  relevant `Settings` field (`INDIA_CODE_OAI_PATHS`, `INDIA_CODE_OAI_SET`) or
  `HuggingFaceDatasetProvider`'s candidate keys and re-run — no other code
  changes needed, which is the actual point of this decision: growing the
  corpus is now a config/data problem, not a code one.

## Consequences

- New table `legal_source_catalog` (migration `0008`), new admin endpoints,
  new `kb:discover(:ingest)` scripts. No changes to the ingestion pipeline
  itself or to `LegalDocument`/`LegalChunk`.
- Adding a third-party catalogue (e.g. a future state-government open-data
  portal) is a new `SourceDiscoveryProvider`, not a schema change.
- `docs/project-status.md`'s "state-specific sources" gap now has a real
  mechanism to close — contingent on the network/embedding caveats above.
