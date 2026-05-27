# TOC-backed page annotation request

PDF extraction page: 401

Verified TOC target(s): [{"toc_id": "toc:0035", "title": "REFERENCES", "level": 1, "target_page": 374, "matched_pdf_page_index": 400, "extraction_page": 401}]

Agent-selected families: sections, footnotes_references, headers_footers

## Why this page was selected

- verified TOC target(s): toc:0035 REFERENCES -> printed p.374
- TOC title hint `REFERENCES` maps to footnotes_references
- page chrome signal: running_headers=2, running_footers=2

## Exact human questions

- Confirm the visible section heading(s) match the verified TOC target(s); do not re-annotate the TOC page.
- Distinguish references, citation blocks, footnotes, and ordinary body paragraphs.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
