#!/usr/bin/env python3
"""Nico ↔ Steve designer dialogue engine for the convergence loop.

Steve Schoger reads Nico Bailon's findings and responds:
- FIX: agrees, provides corrected HTML
- PUSHBACK: disagrees with design rationale, Nico evaluates
- PARTIAL: fixes some, pushes back on the rest

This module is called from improve.py as step 3 of the improvement loop.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)

# ─── scillm proxy config ─────────────────────────────────────────────────────
SCILLM_URL = "http://localhost:4001/v1/chat/completions"
SCILLM_TOKEN = "sk-dev-proxy-123"
SCILLM_MODEL = "text"  # routes to best available text model

# Map finding titles to mockup HTML files (fuzzy match on view name)
_VIEW_MOCKUP_MAP = {
    "quarantine": "quarantine_view_mockup.html",
    "cascade": "cascade_view_mockup.html",
    "quality": "quality_view_mockup.html",
    "corpus": "corpus_view_mockup.html",
    "supervisor": "supervisor_view_mockup.html",
    "providers": "providers_view_mockup.html",
    "requirements": "requirements_view_mockup.html",
    "component": "component_states_mockup.html",
}


@dataclass
class DesignerResponse:
    """Steve's response to a single finding."""
    finding_title: str
    finding_severity: str
    disposition: str  # fix, pushback, partial
    rationale: str
    fixed_html: Optional[str] = None
    pushback_reason: Optional[str] = None
    principle: str = ""
    nico_verdict: Optional[str] = None  # accept, reject (for pushbacks)
    nico_reasoning: str = ""
    final_severity: str = ""  # after dialogue


def _identify_mockup(finding_title: str, mockup_dir: Path) -> Optional[Path]:
    """Match a finding title to the HTML mockup it affects."""
    title_lower = finding_title.lower()
    for keyword, filename in _VIEW_MOCKUP_MAP.items():
        if keyword in title_lower:
            path = mockup_dir / filename
            if path.exists():
                return path
    # Fallback: try all HTML files in mockup_dir
    for html_file in sorted(mockup_dir.glob("*.html")):
        stem = html_file.stem.lower().replace("_mockup", "").replace("_view", "")
        if stem in title_lower or title_lower in stem:
            return html_file
    return None


def _build_steve_system_prompt(designer: dict) -> str:
    """Build Steve Schoger's system prompt from his persona YAML."""
    name = designer.get("name", "Steve Schoger")
    rules = designer.get("modern_dark_mode_rules", {})
    catchphrases = designer.get("personality", {}).get("catchphrases", [])

    prompt = f"""You are {name}, UI Design Expert and Design Board Creator.
You collaborate with Nico Bailon in a design convergence loop. Nico is the QA engineer
who reviews quarantined PDFs — he's your client. You respect his workflow expertise
but you also have strong design principles you won't compromise on.

YOUR CORE PRINCIPLES:
{chr(10).join(f'- {c}' for c in catchphrases)}

YOUR DESIGN RULES (non-negotiable):
- Background layers: {json.dumps(rules.get('background_layers', {}))}
- Text hierarchy: {json.dumps(rules.get('text_hierarchy', {}))}
- Borders: {json.dumps(rules.get('borders', {}))}
- Spacing: {json.dumps(rules.get('spacing', {}))}
- Typography: {json.dumps(rules.get('typography', {}))}
- Animation: {json.dumps(rules.get('animation', {}))}
- Table rules: {json.dumps(rules.get('table_rules', {}))}
- Keyboard first: {json.dumps(rules.get('keyboard_first', {}))}

BEHAVIOR:
When Nico raises a finding, you respond with ONE of:
1. FIX — You agree. Provide the corrected HTML.
2. PUSHBACK — You disagree based on design principles. Explain WHY in first person
   using your expertise. Be specific about which principle applies.
3. PARTIAL — Fix part of it, push back on the rest.

Your response MUST be valid JSON with this structure:
{{
  "disposition": "fix" | "pushback" | "partial",
  "rationale": "First-person explanation of your design reasoning",
  "fixed_html": "Full corrected HTML (only if disposition is fix or partial, null otherwise)",
  "pushback_reason": "Why you disagree (only if disposition is pushback or partial, null otherwise)",
  "principle": "Which design principle applies (e.g. 'contrast over size', 'spacing over borders')"
}}
"""
    return prompt


def _build_nico_evaluator_prompt(client_persona: dict) -> str:
    """Build Nico's evaluator prompt for assessing Steve's pushbacks."""
    name = client_persona.get("name", "Nico Bailon")
    priorities = client_persona.get("viewer_priorities", {})
    thresholds = client_persona.get("quality_focus", {}).get("thresholds", {})

    prompt = f"""You are {name}, Extraction QA Engineer. Steve Schoger (the designer) has
pushed back on one of your findings with a design rationale.

YOUR PRIORITIES: {json.dumps(priorities, default=str)}
YOUR THRESHOLDS: {json.dumps(thresholds, default=str)}

Evaluate Steve's pushback. You ACCEPT if:
- His design principle is sound AND doesn't hurt your workflow
- The visual improvement he's defending actually helps readability
- The tradeoff is reasonable for a data-dense QA interface

You REJECT if:
- It compromises your ability to triage 50+ PDFs per session
- It reduces information density without good reason
- It conflicts with NVIS dark theme requirements
- It makes keyboard navigation harder

Respond with valid JSON:
{{
  "verdict": "accept" | "reject",
  "reasoning": "First-person explanation of why you accept or reject",
  "severity_adjustment": "keep" | "downgrade_to_low" | "escalate_to_high"
}}
"""
    return prompt


def _call_scillm(system_prompt: str, user_message: str) -> Optional[dict]:
    """Call scillm proxy and parse JSON response."""
    try:
        resp = httpx.post(
            SCILLM_URL,
            headers={"Authorization": f"Bearer {SCILLM_TOKEN}"},
            json={
                "model": SCILLM_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0.3,
                "max_tokens": 8192,
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        # Extract JSON from possible markdown code block
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        return json.loads(content)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, IndexError) as e:
        logger.error("scillm call failed: {}", e)
        return None


def run_designer_remediation(
    findings: list[dict],
    mockup_dir: Path,
    designer: dict,
    client_persona: Optional[dict],
    round_dir: Path,
) -> list[DesignerResponse]:
    """Steve reads Nico's findings and responds — fix, pushback, or partial.

    For pushbacks, Nico evaluates and accepts or rejects.
    Fixed HTML is written back to the mockup files.
    """
    responses = []
    steve_prompt = _build_steve_system_prompt(designer)
    nico_prompt = _build_nico_evaluator_prompt(client_persona or {})

    for finding in findings:
        title = finding["title"]
        severity = finding["severity"]

        if severity == "low":
            responses.append(DesignerResponse(
                finding_title=title, finding_severity=severity,
                disposition="acknowledged", rationale="Low severity — noted for polish pass.",
                final_severity="low",
            ))
            continue

        # Find the affected mockup
        mockup_path = _identify_mockup(title, mockup_dir)
        current_html = ""
        if mockup_path:
            current_html = mockup_path.read_text()

        # Ask Steve to respond
        user_msg = f"""FINDING from Nico Bailon:
Title: {title}
Severity: {severity}

Current HTML mockup file: {mockup_path.name if mockup_path else 'unknown'}

{f'Current HTML ({len(current_html)} chars, showing first 4000):' if current_html else 'No HTML mockup found.'}
{current_html[:4000] if current_html else ''}

Respond to this finding. Fix it, push back with design rationale, or do both (partial)."""

        logger.info("    Steve responding to: {} ({})", title, severity)
        steve_response = _call_scillm(steve_prompt, user_msg)

        if not steve_response:
            logger.warning("    Steve failed to respond — finding stays as-is")
            responses.append(DesignerResponse(
                finding_title=title, finding_severity=severity,
                disposition="error", rationale="LLM call failed",
                final_severity=severity,
            ))
            continue

        disposition = steve_response.get("disposition", "fix")
        dr = DesignerResponse(
            finding_title=title,
            finding_severity=severity,
            disposition=disposition,
            rationale=steve_response.get("rationale", ""),
            fixed_html=steve_response.get("fixed_html"),
            pushback_reason=steve_response.get("pushback_reason"),
            principle=steve_response.get("principle", ""),
        )

        # If Steve fixed it, write the HTML back
        if disposition in ("fix", "partial") and dr.fixed_html and mockup_path:
            backup = round_dir / f"{mockup_path.stem}_before_steve.html"
            backup.write_text(current_html)
            mockup_path.write_text(dr.fixed_html)
            logger.info("    Steve FIXED {} → wrote {}", mockup_path.name, len(dr.fixed_html))

        # If Steve pushed back, Nico evaluates
        if disposition in ("pushback", "partial"):
            logger.info("    Steve PUSHBACK on '{}': {}", title, dr.pushback_reason or dr.rationale)

            nico_msg = f"""Steve Schoger pushed back on your finding:

YOUR FINDING: {title} (Severity: {severity})

STEVE'S PUSHBACK: {dr.pushback_reason or dr.rationale}
STEVE'S PRINCIPLE: {dr.principle}

Do you accept his design rationale or reject it?"""

            nico_eval = _call_scillm(nico_prompt, nico_msg)
            if nico_eval:
                dr.nico_verdict = nico_eval.get("verdict", "reject")
                dr.nico_reasoning = nico_eval.get("reasoning", "")
                severity_adj = nico_eval.get("severity_adjustment", "keep")

                if dr.nico_verdict == "accept":
                    logger.info("    Nico ACCEPTS Steve's rationale → downgrading")
                    dr.final_severity = "low" if severity_adj == "downgrade_to_low" else "low"
                else:
                    logger.info("    Nico REJECTS Steve's pushback → severity stays {}", severity)
                    dr.final_severity = "high" if severity_adj == "escalate_to_high" else severity
            else:
                dr.final_severity = severity
        else:
            dr.final_severity = "resolved" if disposition == "fix" else severity

        responses.append(dr)

    # Write dialogue log
    _write_dialogue_log(responses, round_dir)
    return responses


def _write_dialogue_log(responses: list[DesignerResponse], round_dir: Path):
    """Write the Nico↔Steve dialogue as both markdown and JSON."""
    lines = ["# Nico ↔ Steve Design Dialogue", ""]

    for r in responses:
        icon = {"fix": "✅", "pushback": "↩️", "partial": "⚡", "acknowledged": "📝",
                "error": "❌"}.get(r.disposition, "?")
        lines.append(f"## {icon} {r.finding_title} ({r.finding_severity})")
        lines.append(f"**Steve's disposition**: {r.disposition}")
        lines.append(f"**Steve's rationale**: {r.rationale}")
        if r.pushback_reason:
            lines.append(f"**Steve's pushback**: {r.pushback_reason}")
            lines.append(f"**Principle**: {r.principle}")
        if r.nico_verdict:
            verdict_icon = "✅" if r.nico_verdict == "accept" else "❌"
            lines.append(f"**Nico's verdict**: {verdict_icon} {r.nico_verdict}")
            lines.append(f"**Nico's reasoning**: {r.nico_reasoning}")
        lines.append(f"**Final severity**: {r.final_severity}")
        lines.append("")

    (round_dir / "DIALOGUE.md").write_text("\n".join(lines))

    json_data = [
        {
            "finding": r.finding_title,
            "original_severity": r.finding_severity,
            "steve_disposition": r.disposition,
            "steve_rationale": r.rationale,
            "steve_pushback": r.pushback_reason,
            "steve_principle": r.principle,
            "nico_verdict": r.nico_verdict,
            "nico_reasoning": r.nico_reasoning,
            "final_severity": r.final_severity,
        }
        for r in responses
    ]
    (round_dir / "dialogue.json").write_text(json.dumps(json_data, indent=2))
