# TOC-backed page annotation request

PDF extraction page: 468

Verified TOC target(s): []

Agent-selected families: tables, figures_images_captions, headers_footers, controls_requirements, equations_or_expected_absent

## Why this page was selected

- table/caption/grid signal: tables=0, captions=1, drawings=961
- figure/image/caption signal: captions=1, images=1
- page chrome signal: running_headers=2, running_footers=2
- control/requirement signal: requirements=41, control_refs=1
- equation expected-absent canary from full-document equation sweep

## Exact human questions

- Review table region, caption, row/column boundaries, merged/continued cells, and false-positive grid/table fragments.
- Confirm captions belong to the table, and mark true non-table figures/images only if visibly present.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.
- Confirm control IDs, enhancements, requirement statements, and semantic ownership inside paragraphs/tables.
- Confirm whether any true displayed equation exists; Appendix C sqrt/check marks are expected table notation unless visually contradicted.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
