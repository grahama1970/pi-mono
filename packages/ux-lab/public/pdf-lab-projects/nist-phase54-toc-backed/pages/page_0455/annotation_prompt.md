# TOC-backed page annotation request

PDF extraction page: 455

Verified TOC target(s): [{"toc_id": "toc:0038", "title": "APPENDIX C CONTROL SUMMARIES", "level": 1, "target_page": 428, "matched_pdf_page_index": 454, "extraction_page": 455}]

Agent-selected families: sections, lists, headers_footers, controls_requirements, appendix_tables

## Why this page was selected

- verified TOC target(s): toc:0038 APPENDIX C CONTROL SUMMARIES -> printed p.428
- TOC title hint `CONTROL SUMMARIES` maps to appendix_tables, controls_requirements
- list signal: lists=1, list_items=5
- page chrome signal: running_headers=2, running_footers=2

## Exact human questions

- Confirm the visible section heading(s) match the verified TOC target(s); do not re-annotate the TOC page.
- Mark nested/continued list items and distinguish bullets from prose line wraps.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.
- Confirm control IDs, enhancements, requirement statements, and semantic ownership inside paragraphs/tables.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
