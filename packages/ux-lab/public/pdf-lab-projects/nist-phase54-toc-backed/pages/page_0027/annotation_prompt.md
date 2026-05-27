# TOC-backed page annotation request

PDF extraction page: 27

Verified TOC target(s): []

Agent-selected families: tables, figures_images_captions, headers_footers

## Why this page was selected

- table/caption/grid signal: tables=0, captions=29, drawings=735
- figure/image/caption signal: captions=29, images=1
- page chrome signal: running_headers=2, running_footers=1

## Exact human questions

- Review table region, caption, row/column boundaries, merged/continued cells, and false-positive grid/table fragments.
- Confirm captions belong to the table, and mark true non-table figures/images only if visibly present.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
