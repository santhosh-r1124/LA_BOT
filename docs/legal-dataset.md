# Legal knowledge base: Hugging Face dataset choice

LA_BOT's legal library is filled from a Hugging Face dataset of real Indian
court judgments. This page records which dataset was chosen, why, and exactly
what could and could not be verified when the choice was made.

## Candidates

| | `Sumitedu/indian-case-laws` | `dedol-hf/india-case-legal-rag` |
| --- | --- | --- |
| Found on the web | Yes. Its card is the **KanoonGPT Open Legal Data Initiative** dataset (the page is titled `KanoonGPT/indian-case-laws`) | **No.** Web searches for the id returned nothing, so its existence, size, license and fields could not be confirmed |
| Content | Judgments of the Supreme Court of India and 25 High Courts, 1950–2026 (rolling) | Unknown |
| Size | About 10.9 GB of parquet files; KanoonGPT reports about 17.1 million judgment records; includes a small `sample/v1/...parquet` file | Unknown |
| License | KanoonGPT's site says Apache-2.0; the Hub page header shows an unusual value ("xet"). **Check the dataset card before relying on it.** | Unknown |
| Fields (per publisher) | `case_title`, `parties`, `cnr_number`, `neutral_citation`, `law_report_citation`, `court_name`, `bench_name`, `decision_date`, `disposition_text`, `indexable_text`, `headnote_text`, source PDF/JSON links | Unknown |
| Hub dataset viewer | Reported **broken** for this dataset, so rows can't be paged through the viewer API | Unknown |
| RAG suitability | Good: full judgment text plus court, date and citation metadata to cite | Can't be assessed |

Sources: [Hub page](https://huggingface.co/datasets/Sumitedu/indian-case-laws),
[KanoonGPT/indian-case-laws](https://huggingface.co/datasets/KanoonGPT/indian-case-laws),
[KanoonGPT open-data page](https://kanoongpt.in/open-initiative/).

## Decision

**`Sumitedu/indian-case-laws`** (default `HF_DATASET_NAME`). It is the only
candidate that could be confirmed to exist and to contain real Indian
judgments, and it carries the metadata (court, decision date, neutral
citation, case title) that answers need for honest citations.

Because its dataset viewer is broken, the loader falls back to reading the
repo's parquet files directly, preferring the publisher's small `sample` file,
with HTTP range requests: only the file footer and the needed column chunks of
one row group at a time are fetched, never the 10.9 GB repo. A renamed repo
(Sumitedu → KanoonGPT) is followed and both ids count as the same dataset.

To use another dataset, set `HF_DATASET_NAME` (and, if needed,
`HF_DATASET_FILE`, `HF_TEXT_FIELD`, `HF_TITLE_FIELD`) and run
`python -m app.scripts.ingest_hf_dataset --inspect` first: it prints the
license, size, columns, the detected field mapping and three sample rows as
they would be stored.

## What was not verified

The environment this was built in blocks `huggingface.co` and
`datasets-server.huggingface.co`, so **no row of the real dataset has been
downloaded or ingested yet**. The facts above come from the publisher's pages
via web search. The loader is tested against a fake Hugging Face server (Hub
API, viewer API, parquet and JSON Lines over range requests) with synthetic
fixtures that are rolled back after each test and never enter the knowledge
base.

On first start with internet access, check the **Platform status** panel (or
`GET /api/v1/status` → `knowledge_base.corpus_load`). If the real file layout
differs from what the publisher describes (for example a row group too large
to fetch), the status says so and names the setting to change. Nothing fails
silently, and no placeholder documents are created.

## Pipeline

```
HF dataset ─► inspect (Hub API: license, gated, files; viewer API or parquet footer)
           ─► detect fields (text / title / id / court / date / citation)
           ─► pages of HF_BATCH_SIZE rows (viewer /rows, parquet row groups, JSONL stream)
           ─► normalise (skip rows with < 200 chars of text; metadata copied, never inferred)
           ─► chunk (1500 chars, 200 overlap) ─► legal_documents + legal_chunks (no embedding yet)
           ─► embed_missing (Gemini, batches of 50, stops cleanly on quota, resumes later)
           ─► hybrid retrieval (keyword FTS + pgvector, fused with RRF) ─► LLM ─► cited answer
```

Each document is keyed by `(dataset, row id)`, so re-running never duplicates.
`HF_MAX_DOCUMENTS` is a target total: the same value again does nothing, a
larger one continues after the last row read.
