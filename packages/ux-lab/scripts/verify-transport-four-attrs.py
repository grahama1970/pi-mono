#!/usr/bin/env python3
"""CI gate: every interactive element in transport UI must have data-qid, data-qs-action, title, and a matching useRegisterAction."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = ROOT / "src/components/scillm/transport"
SHARED = [
    ROOT / "src/components/shared-chat/SkillPalette.tsx",
    ROOT / "src/components/common/LeftPane.tsx",
]

TAG = re.compile(r"<(button|a|input|select|textarea)\b", re.I)
REGISTERED = re.compile(r"action:\s*['\"]([A-Z0-9_]+)['\"]")
ACTION_CONST = re.compile(
    r"(?:TRANSPORT_|LEFT_PANE_|SKILL_PALETTE_)[A-Z0-9_]{2,}"
)
QS_STATIC = re.compile(r'data-qs-action=(?:\{)?["\']([A-Z0-9_]+)["\']')


def file_actions(text: str) -> set[str]:
    return set(REGISTERED.findall(text))


def block_actions(block: str) -> set[str]:
    actions = set(QS_STATIC.findall(block))
    actions.update(ACTION_CONST.findall(block))
    if "LEFT_PANE_SORT_${" in block:
        actions.update(
            {
                "LEFT_PANE_SORT_RECENT",
                "LEFT_PANE_SORT_SCORE",
                "LEFT_PANE_SORT_ALPHA",
            }
        )
    return {a for a in actions if not a.endswith("_")}


def scan_file(path: Path) -> list[str]:
    text = path.read_text()
    registered = file_actions(text)
    lines = text.splitlines()
    issues: list[str] = []
    for i, line in enumerate(lines, 1):
        if not TAG.search(line):
            continue
        block = "\n".join(lines[max(0, i - 1) : min(len(lines), i + 24)])
        action_ctx = "\n".join(lines[max(0, i - 15) : min(len(lines), i + 24)])
        if not re.search(r"\bon(?:Click|Change|Submit)\s*=", block):
            # Non-interactive tags (e.g. display-only anchors) still need attrs if href navigates
            if "<a" in block.lower() and "href=" in block:
                pass
            else:
                continue
        missing: list[str] = []
        if "data-qid=" not in block and "data-qid={" not in block:
            missing.append("data-qid")
        actions = block_actions(action_ctx)
        if not actions:
            missing.append("data-qs-action")
        else:
            unknown = sorted(a for a in actions if a not in registered)
            if unknown:
                missing.append(f"useRegisterAction({', '.join(unknown)})")
        if "title=" not in block and "aria-label=" not in block:
            missing.append("title")
        if missing:
            issues.append(f"{path.relative_to(ROOT)}:{i} missing {', '.join(missing)}")
    return issues


def main() -> int:
    paths = sorted(TRANSPORT.glob("*.tsx")) + [p for p in SHARED if p.exists()]
    all_issues: list[str] = []
    for path in paths:
        all_issues.extend(scan_file(path))

    if not all_issues:
        print(f"PASS: four-attribute rule satisfied ({len(paths)} files)")
        return 0

    print(f"FAIL: {len(all_issues)} interactive element(s) violate four-attribute rule\n")
    for issue in all_issues:
        print(f"  {issue}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
