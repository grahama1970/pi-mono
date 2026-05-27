# Whole-page annotation request

PDF page: 421

Agent-selected families: sections, footnotes_references, headers_footers, definitions_glossary

## Candidate-selection signals

- section-like headings in first 20 lines: 3
- footnote/reference signals: footnotes=0, references=5
- running header/footer or front-matter page chrome signal
- definition/glossary signals: 2

## Visual annotation notes

- Confirm visible section/chapter/appendix headings and whether they should be section anchors or ordinary text.
- Confirm whether small bottom text, citations, or standards references are footnotes, references, or body content.
- Identify page chrome separately from body content: headers, footers, page numbers, side labels, and boilerplate.
- Mark definitions/acronyms/glossary entries and distinguish term labels from descriptive paragraphs.

Please annotate every visible semantically relevant PDF element on this page, including missed elements not present in pdf_oxide output. For each element, mark family, visible region/bbox if practical, expected text/role, and whether the current extraction/preset output is acceptable.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals.
