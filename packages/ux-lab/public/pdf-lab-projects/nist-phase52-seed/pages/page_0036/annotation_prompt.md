# Whole-page annotation request

PDF page: 36

Agent-selected families: sections, tables, figures_images_captions, footnotes_references, controls_requirements

## Candidate-selection signals

- section-like headings in first 20 lines: 1
- table caption/grid signals: captions=0, drawings=42
- figure/image signals: captions=2, images=9
- footnote/reference signals: footnotes=0, references=1
- control/requirement signals: control_ids=10, keywords=22

## Visual annotation notes

- Confirm visible section/chapter/appendix headings and whether they should be section anchors or ordinary text.
- Inspect visible grid/row/column structure; mark table regions, fragments, captions, and false-positive table-like layouts.
- Confirm actual figures/images/captions; image-object count is only a candidate signal and may include page chrome.
- Confirm whether small bottom text, citations, or standards references are footnotes, references, or body content.
- Confirm control IDs, enhancements, requirement statements, and whether table cells or paragraphs own the semantic role.

Please annotate every visible semantically relevant PDF element on this page, including missed elements not present in pdf_oxide output. For each element, mark family, visible region/bbox if practical, expected text/role, and whether the current extraction/preset output is acceptable.

Do not use the extracted JSON as ground truth; use the rendered page image as ground truth. Amend or remove the agent-selected family labels when the rendered page contradicts the candidate-selection signals.
