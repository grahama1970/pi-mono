# TOC-backed page annotation request

PDF extraction page: 34

Verified TOC target(s): [{"toc_id": "toc:0008", "title": "CHAPTER TWO THE FUNDAMENTALS", "level": 1, "target_page": 7, "matched_pdf_page_index": 33, "extraction_page": 34}, {"toc_id": "toc:0009", "title": "2.1 REQUIREMENTS AND CONTROLS", "level": 2, "target_page": 7, "matched_pdf_page_index": 33, "extraction_page": 34}]

Agent-selected families: sections, headers_footers, controls_requirements

## Why this page was selected

- verified TOC target(s): toc:0008 CHAPTER TWO THE FUNDAMENTALS -> printed p.7; toc:0009 2.1 REQUIREMENTS AND CONTROLS -> printed p.7
- TOC title hint `REQUIREMENTS AND CONTROLS` maps to controls_requirements, sections
- page chrome signal: running_headers=2, running_footers=2

## Exact human questions

- Confirm the visible section heading(s) match the verified TOC target(s); do not re-annotate the TOC page.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.
- Confirm control IDs, enhancements, requirement statements, and semantic ownership inside paragraphs/tables.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
