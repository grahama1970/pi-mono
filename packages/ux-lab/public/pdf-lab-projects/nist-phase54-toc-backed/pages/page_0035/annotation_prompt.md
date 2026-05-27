# TOC-backed page annotation request

PDF extraction page: 35

Verified TOC target(s): [{"toc_id": "toc:0010", "title": "2.2 CONTROL STRUCTURE AND ORGANIZATION", "level": 2, "target_page": 8, "matched_pdf_page_index": 34, "extraction_page": 35}]

Agent-selected families: sections, tables, figures_images_captions, lists, headers_footers

## Why this page was selected

- verified TOC target(s): toc:0010 2.2 CONTROL STRUCTURE AND ORGANIZATION -> printed p.8
- TOC title hint `CONTROL STRUCTURE` maps to sections, lists
- table/caption/grid signal: tables=0, captions=1, drawings=290
- figure/image/caption signal: captions=1, images=1
- page chrome signal: running_headers=2, running_footers=2

## Exact human questions

- Confirm the visible section heading(s) match the verified TOC target(s); do not re-annotate the TOC page.
- Review table region, caption, row/column boundaries, merged/continued cells, and false-positive grid/table fragments.
- Confirm captions belong to the table, and mark true non-table figures/images only if visibly present.
- Mark nested/continued list items and distinguish bullets from prose line wraps.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
