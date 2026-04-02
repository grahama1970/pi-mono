"""Output parsing helpers for subagent-service.

Extracts usage (cost, tokens) from CLI backend output:
- Claude stream-json events
- Codex/Gemini stderr token reports
"""
from __future__ import annotations

import re
from typing import Optional


def extract_usage_from_events(
    events: list[dict],
) -> tuple[Optional[float], Optional[int], Optional[int]]:
    """Extract cost and tokens from Claude stream-json events."""
    cost_usd = None
    tokens_in = None
    tokens_out = None
    for ev in reversed(events):
        if ev.get("type") == "result":
            cost_usd = ev.get("total_cost_usd")
            usage = ev.get("usage", {})
            tokens_in = usage.get("input_tokens")
            tokens_out = usage.get("output_tokens")
            break
    return cost_usd, tokens_in, tokens_out


def parse_tokens_from_stderr(
    stderr: str,
) -> tuple[Optional[int], Optional[int]]:
    """Best-effort token extraction from Codex/Gemini stderr.

    Patterns vary by CLI version — we try common formats:
    - "Tokens: 1234 in / 567 out"
    - "input_tokens: 1234"
    - "total_tokens: 1801"
    """
    tokens_in = None
    tokens_out = None
    # Pattern: "N in / M out" or "input: N, output: M"
    m = re.search(
        r"(\d[\d,]+)\s*(?:input|in)\b.*?(\d[\d,]+)\s*(?:output|out)\b", stderr, re.I
    )
    if m:
        tokens_in = int(m.group(1).replace(",", ""))
        tokens_out = int(m.group(2).replace(",", ""))
        return tokens_in, tokens_out
    # Pattern: "input_tokens: N"
    m = re.search(r"input.?tokens?\D*(\d[\d,]+)", stderr, re.I)
    if m:
        tokens_in = int(m.group(1).replace(",", ""))
    m = re.search(r"output.?tokens?\D*(\d[\d,]+)", stderr, re.I)
    if m:
        tokens_out = int(m.group(1).replace(",", ""))
    return tokens_in, tokens_out
