# TOC-backed page annotation request

PDF extraction page: 421

Verified TOC target(s): [{"toc_id": "toc:0036", "title": "APPENDIX A GLOSSARY", "level": 1, "target_page": 394, "matched_pdf_page_index": 420, "extraction_page": 421}]

Agent-selected families: sections, headers_footers, definitions_glossary

## Why this page was selected

- verified TOC target(s): toc:0036 APPENDIX A GLOSSARY -> printed p.394
- TOC title hint `GLOSSARY` maps to definitions_glossary
- page chrome signal: running_headers=2, running_footers=2

## Exact human questions

- Confirm the visible section heading(s) match the verified TOC target(s); do not re-annotate the TOC page.
- Separate running headers, footers, printed page numbers, and side boilerplate from body content.
- Mark glossary/acronym term labels separately from descriptive definitions.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals. Do not re-annotate the Table of Contents page; this packet uses the verified TOC spine only as routing evidence.
