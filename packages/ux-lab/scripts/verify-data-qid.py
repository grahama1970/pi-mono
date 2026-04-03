#!/usr/bin/env python3
"""CI gate: verify data-qid coverage on interactive React elements.

Scans .tsx files for onClick/onChange/onDoubleClick handlers and checks
that the enclosing JSX element also has a data-qid attribute.

Known limitation: regex-based JSX parsing undercounts vs live DOM (CDP).
This script is a fast CI gate — the authoritative count comes from CDP.
See best-practices-react: interaction-queryspec-registration.md.

Exit 1 = not shippable.
"""
import re
import os
import sys
from pathlib import Path

# Match onClick={...}, onChange={...}, onDoubleClick={...}
HANDLER_RE = re.compile(r'\bon(?:Click|Change|DoubleClick)\s*=\s*\{')

# Exclusions: non-interactive handlers (e.g., stopPropagation, style refs)
EXCLUDE_RE = re.compile(r'e\.stopPropagation|e\.preventDefault')


def find_jsx_elements(content: str) -> list[tuple[int, str]]:
    """Find JSX elements with event handlers. Returns [(line_num, element_text)]."""
    results = []
    lines = content.split('\n')

    for i, line in enumerate(lines, 1):
        if not HANDLER_RE.search(line):
            continue
        if EXCLUDE_RE.search(line):
            continue

        # Gather context: look backwards for the opening < and forwards for >
        # This handles multi-line JSX elements
        element_lines = []

        # Look backwards up to 10 lines for opening <
        start = max(0, i - 11)
        found_open = False
        for j in range(i - 1, start - 1, -1):
            element_lines.insert(0, lines[j])
            if re.search(r'<\s*(?:button|input|select|div|span|label|a|tr|td|th)\b', lines[j]):
                found_open = True
                break

        if not found_open:
            # Might be a component like <SourceRow ... onClick=...>
            for j in range(i - 1, start - 1, -1):
                element_lines.insert(0, lines[j])
                if '<' in lines[j]:
                    found_open = True
                    break

        if not found_open:
            continue

        # Look forward up to 15 lines for the > that closes the opening tag
        for j in range(i, min(len(lines), i + 15)):
            element_lines.append(lines[j])
            # Check if this line has > not inside {{ }}
            stripped = lines[j]
            # Simple heuristic: if line ends with > or has > before a newline
            if re.search(r'>\s*$', stripped) or stripped.strip() == '>':
                break

        element_text = '\n'.join(element_lines)
        results.append((i, element_text))

    return results


def audit_file(path: str) -> tuple[int, int, list[tuple[int, str]]]:
    """Return (total_interactive, has_qid, [(line, snippet)])."""
    content = Path(path).read_text()
    elements = find_jsx_elements(content)

    total = 0
    has_qid = 0
    missing: list[tuple[int, str]] = []

    for line_num, element_text in elements:
        total += 1
        if 'data-qid' in element_text:
            has_qid += 1
        else:
            # Extract a short snippet for the report
            snippet = element_text.split('\n')[0].strip()[:80]
            missing.append((line_num, snippet))

    return total, has_qid, missing


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), '..', 'src', 'components'
    )

    # Optional: --sparta-only flag to limit to SPARTA explorer
    sparta_only = '--sparta-only' in sys.argv

    grand_total = 0
    grand_qid = 0
    all_missing: list[tuple[str, int, str]] = []

    # Support single-file mode
    if os.path.isfile(base):
        file_list = [(os.path.dirname(base), [], [os.path.basename(base)])]
    else:
        file_list = list(os.walk(base))

    for root, _, files in file_list:
        for fn in files:
            if not fn.endswith('.tsx'):
                continue
            path = os.path.join(root, fn)
            rel = os.path.relpath(path, base if not os.path.isfile(base) else os.path.dirname(base))

            if sparta_only and 'sparta' not in rel:
                continue

            total, qid, missing = audit_file(path)
            grand_total += total
            grand_qid += qid
            for line_num, snippet in missing:
                all_missing.append((rel, line_num, snippet))

    pct = grand_qid * 100 // grand_total if grand_total > 0 else 0
    print(f"data-qid coverage: {grand_qid}/{grand_total} ({pct}%)")

    if all_missing:
        print(f"\nMISSING ({len(all_missing)}):")
        for rel, line_num, snippet in all_missing[:30]:
            print(f"  {rel}:{line_num} — {snippet}")
        if len(all_missing) > 30:
            print(f"  ... and {len(all_missing) - 30} more")

    if grand_total == 0:
        print("\nFAIL: 0 interactive elements found — nothing to verify (wrong path or empty scan)")
        sys.exit(1)
    elif grand_qid < grand_total:
        print(f"\nFAIL: {grand_total - grand_qid} interactive elements without data-qid")
        sys.exit(1)
    else:
        print("\nPASS: 100% data-qid coverage")
        sys.exit(0)


if __name__ == '__main__':
    main()
