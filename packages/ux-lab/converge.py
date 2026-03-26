#!/usr/bin/env python3
"""Design convergence loop with three hard gates.

Consultants (human + agent) work FOR the client persona (e.g. nico-bailon).
No production TSX is written until the client approves the design board.

Gate 0: SPEC PREFLIGHT — client validates spec completeness or FAIL
Gate 1: DESIGN BOARD — each component has HTML/CSS→PNG, rationale, expected
         results, animation spec, hover states, ShadCN identification or FAIL
Gate 2: MOCKUP CONVERGENCE — improve.py loop until min(grades) >= threshold

Usage:
    python converge.py --client nico-bailon --board design/DESIGN_BOARD.md \
        --designer-rules ~/.pi/skills/extractor-quality-check/steve_schoger_persona.yaml \
        --max-rounds 5
"""

import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)

# Import the existing improvement loop
from improve import run_improvement_loop
from converge_personas import (
    load_persona,
    load_designer,
    build_client_checks,
    validate_board_against_designer,
)


# ─── Component Spec Schema ────────────────────────────────────────────────────
# Every component/pane in the design board MUST have these fields.
# If any are missing, Gate 1 FAILs and no production code is written.

REQUIRED_COMPONENT_FIELDS = {
    "mockup_html": "Path to HTML/CSS mockup file (e.g. figures/quarantine_view_mockup.html)",
    "mockup_png": "Path to rendered PNG screenshot of the mockup",
    "rationale": "First-person rationale from the client: WHY this layout",
    "expected_results": "What the client expects to see — measurable, testable",
    "component_type": "One of: shadcn | custom | composition (shadcn = pre-existing ShadCN component)",
    "shadcn_components": "If component_type includes shadcn: list which ShadCN components are used",
    "animation": "Animation spec: 'none' or {type, duration_ms, easing, trigger}",
    "hover_states": "Mouse-over behavior: what changes on hover (color, border, background, cursor)",
    "keyboard": "Keyboard shortcuts/interactions for this component (or 'none')",
    "data_source": "Where data comes from (API endpoint, JSONL file, sample fixture, etc.)",
}

# Fields that are WARNINGS (recommended but not blocking)
RECOMMENDED_COMPONENT_FIELDS = {
    "empty_state": "What shows when no data is available",
    "loading_state": "What shows during data load",
    "error_state": "What shows on error",
    "responsive": "Behavior at different viewport sizes",
    "aria": "Accessibility attributes (ARIA roles, labels)",
}


@dataclass
class ComponentSpec:
    """Parsed component specification from DESIGN_BOARD.md."""
    name: str
    section_heading: str
    fields_present: dict = field(default_factory=dict)   # field_name -> value
    fields_missing: list = field(default_factory=list)    # field_name list
    warnings: list = field(default_factory=list)          # recommended but missing
    valid: bool = False


@dataclass
class SpecPreflightResult:
    """Result of Gate 0: spec preflight check."""
    passed: bool
    client_persona: str
    checks: dict = field(default_factory=dict)  # check_name -> {passed, detail}
    missing: list = field(default_factory=list)


@dataclass
class DesignBoardResult:
    """Result of Gate 1: design board validation."""
    passed: bool
    components: list = field(default_factory=list)  # list of ComponentSpec
    total_components: int = 0
    valid_components: int = 0
    issues: list = field(default_factory=list)


@dataclass
class ConvergeResult:
    """Overall convergence result across all three gates."""
    gate0_passed: bool
    gate1_passed: bool
    gate2_passed: bool
    gate0: Optional[SpecPreflightResult] = None
    gate1: Optional[DesignBoardResult] = None
    gate2_rounds: int = 0
    gate2_converged: bool = False
    production_approved: bool = False


# ─── Gate 0: Spec Preflight ───────────────────────────────────────────────────

SPEC_PREFLIGHT_CHECKS = {
    "persona_assessment": {
        "description": "Persona assessment section exists with workflow documentation",
        "patterns": [r"##.*persona.*assessment", r"##.*who\s+is", r"workflow"],
    },
    "view_priority": {
        "description": "View priority order documented (matches client's time allocation)",
        "patterns": [r"priority", r"80%|primary|secondary|tertiary"],
    },
    "quality_thresholds": {
        "description": "Quality thresholds specified with concrete numbers",
        "patterns": [r"threshold", r"0\.\d{2}", r"acceptable|reject|needs.review"],
    },
    "keyboard_shortcuts": {
        "description": "Keyboard shortcuts defined for frequent actions",
        "patterns": [r"keyboard|shortcut|hotkey", r"[jk].*nav|enter.*open|esc.*close"],
    },
    "data_sources": {
        "description": "Data sources identified for each view",
        "patterns": [r"data.source|api.*endpoint|jsonl|json|sample.*data|fixture"],
    },
    "interaction_states": {
        "description": "Interaction states covered (empty, loading, error, populated)",
        "patterns": [r"empty.*state|loading|error.*state|populated|no.*data"],
    },
    "dont_want_list": {
        "description": "Client's 'don't want' list addressed",
        "patterns": [r"don.t.*want|not.*want|no.*animation|no.*light.*mode|no.*decorat"],
    },
    "color_palette": {
        "description": "Color palette with NVIS tokens (not raw hex in TSX)",
        "patterns": [r"color.*palette|nvis|embry.*style|token"],
    },
    "typography": {
        "description": "Typography spec (font, sizes, weights)",
        "patterns": [r"typograph|font.*size|font.*weight|monospace|sans.serif"],
    },
}


def run_spec_preflight(board_path: Path, client_persona: str) -> SpecPreflightResult:
    """Gate 0: Validate that the design board spec is complete.

    Loads the client persona YAML and generates persona-specific checks
    in addition to the generic SPEC_PREFLIGHT_CHECKS. The client's
    viewer_priorities, qa_workflow, and quality_thresholds drive validation.
    """
    logger.info("=" * 70)
    logger.info("GATE 0: SPEC PREFLIGHT — Does the spec cover {}'s workflow?", client_persona)
    logger.info("=" * 70)

    if not board_path.exists():
        logger.error("Design board not found: {}", board_path)
        return SpecPreflightResult(
            passed=False,
            client_persona=client_persona,
            missing=["Design board file does not exist"],
        )

    # Load persona YAML for persona-driven checks
    persona = load_persona(client_persona)
    persona_checks = build_client_checks(persona) if persona else {}
    if persona:
        logger.info("  Loaded {} persona-specific checks from {}", len(persona_checks), persona.get("name", client_persona))

    # Merge generic + persona-specific checks
    all_checks = {**SPEC_PREFLIGHT_CHECKS, **persona_checks}

    content = board_path.read_text().lower()
    checks = {}
    missing = []
    persona_missing = []

    for check_name, check_def in all_checks.items():
        patterns = check_def["patterns"]
        matches = sum(1 for p in patterns if re.search(p, content, re.IGNORECASE))
        threshold = max(1, len(patterns) // 2)  # Must match at least half the patterns
        passed = matches >= threshold
        is_persona_check = check_name.startswith("persona_")

        checks[check_name] = {
            "passed": passed,
            "description": check_def["description"],
            "matches": matches,
            "required": threshold,
            "source": check_def.get("source", "generic"),
        }

        status = "PASS" if passed else "FAIL"
        prefix = "  " if not is_persona_check else "  [PERSONA] "
        logger.info("{}[{}] {} ({}/{} patterns)", prefix, status, check_def["description"],
                     matches, len(patterns))

        if not passed:
            entry = f"{check_name}: {check_def['description']}"
            missing.append(entry)
            if is_persona_check:
                persona_missing.append(entry)

    all_passed = len(missing) == 0

    if all_passed:
        logger.info("")
        logger.info("GATE 0: PASSED — spec covers {}'s workflow ({} generic + {} persona checks)",
                     client_persona, len(SPEC_PREFLIGHT_CHECKS), len(persona_checks))
    else:
        logger.error("")
        logger.error("GATE 0: FAILED — {} checks missing ({} generic, {} persona):",
                     len(missing), len(missing) - len(persona_missing), len(persona_missing))
        for m in missing:
            logger.error("  - {}", m)
        logger.error("Fix the spec before proceeding to design.")

    return SpecPreflightResult(
        passed=all_passed,
        client_persona=client_persona,
        checks=checks,
        missing=missing,
    )


# ─── Gate 1: Design Board Validation ─────────────────────────────────────────

def _extract_components_from_board(board_path: Path) -> list[dict]:
    """Parse DESIGN_BOARD.md to find component/view sections.

    Looks for ## View N: or ## Component: patterns and extracts
    the content between them for field validation.
    """
    content = board_path.read_text()
    components = []

    # Match view/component sections: "## View N: Name" or "## Component: Name"
    section_pattern = re.compile(
        r"^##\s+(?:View\s+\d+:\s*|Component:\s*|Cross-View:\s*)(.+?)$",
        re.MULTILINE | re.IGNORECASE,
    )

    matches = list(section_pattern.finditer(content))
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        section_content = content[start:end]
        components.append({
            "name": match.group(1).strip(),
            "heading": match.group(0).strip(),
            "content": section_content,
            "content_lower": section_content.lower(),
        })

    return components


def _validate_component(comp: dict, figures_dir: Path) -> ComponentSpec:
    """Validate a single component against the required fields schema."""
    spec = ComponentSpec(
        name=comp["name"],
        section_heading=comp["heading"],
    )
    content = comp["content_lower"]
    content_raw = comp["content"]

    # Check each required field
    for field_name, field_desc in REQUIRED_COMPONENT_FIELDS.items():
        present = False
        value = ""

        if field_name == "mockup_html":
            # Check for HTML file reference
            html_match = re.search(r"figures/\S+\.html", content_raw)
            if html_match:
                html_path = figures_dir.parent / html_match.group(0)
                present = html_path.exists()
                value = html_match.group(0) if present else f"{html_match.group(0)} (FILE NOT FOUND)"

        elif field_name == "mockup_png":
            # Check for PNG file reference
            png_match = re.search(r"figures/\S+\.png", content_raw)
            if png_match:
                png_path = figures_dir.parent / png_match.group(0)
                present = png_path.exists()
                value = png_match.group(0) if present else f"{png_match.group(0)} (FILE NOT FOUND)"
            # Also check for markdown image links
            if not present:
                img_match = re.search(r"!\[.*?\]\((figures/\S+\.png)\)", content_raw)
                if img_match:
                    png_path = figures_dir.parent / img_match.group(1)
                    present = png_path.exists()
                    value = img_match.group(1) if present else f"{img_match.group(1)} (FILE NOT FOUND)"

        elif field_name == "rationale":
            # Look for rationale section or first-person reasoning
            rationale_patterns = [
                r"rationale|reasoning|why\s+this",
                r"\"I\s+|\"My\s+|\"When\s+I\s+",  # First-person quotes
                r"nico.*says|nico.*wants|nico.*needs",
            ]
            matches = sum(1 for p in rationale_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} rationale indicators"

        elif field_name == "expected_results":
            patterns = [r"expect|should\s+show|should\s+display|must\s+render|assertion"]
            matches = sum(1 for p in patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} expectation indicators"

        elif field_name == "component_type":
            type_patterns = [r"shadcn|custom|composition|pre.exist"]
            matches = sum(1 for p in type_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = "type specified" if present else "MISSING"

        elif field_name == "shadcn_components":
            # Only required if shadcn is mentioned
            if "shadcn" in content:
                shadcn_names = re.findall(r"(?:Button|Card|Table|Dialog|Select|Input|Badge|Tabs|Tooltip|Checkbox|Popover|Command|Sheet|Drawer|ScrollArea|Separator|DropdownMenu|ContextMenu|RadioGroup|Switch|Slider|Progress|Avatar|HoverCard|Accordion|Alert|AspectRatio|Calendar|Carousel|Chart|Collapsible|Combobox|DataTable|DatePicker|Form|Label|Menubar|NavigationMenu|Pagination|Resizable|Skeleton|Sonner|Toggle|ToggleGroup)\b", content_raw)
                present = len(shadcn_names) > 0
                value = ", ".join(set(shadcn_names)) if present else "shadcn mentioned but no components listed"
            else:
                present = True  # Not applicable
                value = "N/A (custom component)"

        elif field_name == "animation":
            anim_patterns = [
                r"animation:\s*none|no\s+animation|0ms",
                r"animation.*\{|duration.*ms|easing|transition|transform",
                r"150ms|200ms|300ms|cubic.bezier",
            ]
            matches = sum(1 for p in anim_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} animation spec indicators"

        elif field_name == "hover_states":
            hover_patterns = [r"hover|mouse.over|:hover|on.hover|hover.*state"]
            matches = sum(1 for p in hover_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} hover indicators"

        elif field_name == "keyboard":
            kb_patterns = [r"keyboard|shortcut|key.*bind|hotkey|j/k|enter|esc|tab"]
            matches = sum(1 for p in kb_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} keyboard indicators"

        elif field_name == "data_source":
            data_patterns = [r"data.*source|api|endpoint|jsonl|json.*file|fixture|loader|fetch"]
            matches = sum(1 for p in data_patterns if re.search(p, content, re.IGNORECASE))
            present = matches >= 1
            value = f"{matches} data source indicators"

        if present:
            spec.fields_present[field_name] = value
        else:
            spec.fields_missing.append(field_name)

    # Check recommended fields (warnings only)
    for field_name, field_desc in RECOMMENDED_COMPONENT_FIELDS.items():
        if field_name == "empty_state":
            if not re.search(r"empty|no.*data|placeholder", content, re.IGNORECASE):
                spec.warnings.append(f"{field_name}: {field_desc}")
        elif field_name == "loading_state":
            if not re.search(r"loading|spinner|skeleton|progress", content, re.IGNORECASE):
                spec.warnings.append(f"{field_name}: {field_desc}")
        elif field_name == "error_state":
            if not re.search(r"error.*state|fail.*display|error.*message", content, re.IGNORECASE):
                spec.warnings.append(f"{field_name}: {field_desc}")
        elif field_name == "responsive":
            if not re.search(r"responsive|mobile|viewport|breakpoint|resize", content, re.IGNORECASE):
                spec.warnings.append(f"{field_name}: {field_desc}")
        elif field_name == "aria":
            if not re.search(r"aria|a11y|accessibility|screen.reader|role=", content, re.IGNORECASE):
                spec.warnings.append(f"{field_name}: {field_desc}")

    spec.valid = len(spec.fields_missing) == 0
    return spec


def run_design_board_validation(
    board_path: Path,
    designer_rules_path: Optional[Path] = None,
) -> DesignBoardResult:
    """Gate 1: Validate component specs AND designer rules.

    Component validation: each pane MUST have mockup_html, mockup_png,
    rationale, expected_results, component_type, animation, hover_states,
    keyboard, data_source.

    Designer validation: Steve Schoger's persona YAML constrains the
    board — NVIS tokens, 4px/8px grid, <=200ms animation, monospace
    numbers, contrast over size, border elimination.
    """
    logger.info("")
    logger.info("=" * 70)
    logger.info("GATE 1: DESIGN BOARD VALIDATION — Does every component have full spec?")
    logger.info("=" * 70)

    if not board_path.exists():
        return DesignBoardResult(
            passed=False,
            issues=["Design board file does not exist"],
        )

    figures_dir = board_path.parent / "figures"
    raw_components = _extract_components_from_board(board_path)

    if not raw_components:
        logger.error("No component sections found in design board")
        logger.error("Expected sections like: '## View 1: QuarantineView' or '## Component: MonitorStrip'")
        return DesignBoardResult(
            passed=False,
            issues=["No component sections found — expected '## View N:' or '## Component:' headings"],
        )

    components = []
    issues = []

    for raw in raw_components:
        spec = _validate_component(raw, figures_dir)
        components.append(spec)

        status = "PASS" if spec.valid else "FAIL"
        logger.info("")
        logger.info("  [{}] {}", status, spec.name)

        if spec.fields_present:
            for fname, fval in spec.fields_present.items():
                logger.info("    + {}: {}", fname, fval)

        if spec.fields_missing:
            for fname in spec.fields_missing:
                desc = REQUIRED_COMPONENT_FIELDS[fname]
                logger.error("    - MISSING {}: {}", fname, desc)
                issues.append(f"{spec.name}: missing {fname} — {desc}")

        if spec.warnings:
            for w in spec.warnings:
                logger.warning("    ? WARN {}", w)

    valid_count = sum(1 for c in components if c.valid)
    total_count = len(components)
    components_passed = valid_count == total_count

    # ── Designer rules validation (Steve Schoger) ──
    designer = load_designer(designer_rules_path)
    designer_passed = True
    if designer:
        designer_name = designer.get("name", "designer")
        logger.info("")
        logger.info("  --- Designer Rules: {} ---", designer_name)
        board_content = board_path.read_text()
        designer_results = validate_board_against_designer(board_content, designer)
        for dr in designer_results:
            status = "PASS" if dr["passed"] else "FAIL"
            logger.info("  [{}] {} ({}/{})", status, dr["description"],
                        dr["matches"], dr["required"])
            if not dr["passed"]:
                designer_passed = False
                issues.append(f"[Designer] {dr['description']}")
    else:
        logger.warning("  No designer persona loaded — skipping design constraint checks")

    all_passed = components_passed and designer_passed

    logger.info("")
    if all_passed:
        logger.info("GATE 1: PASSED — {}/{} components + designer rules", valid_count, total_count)
    else:
        logger.error("GATE 1: FAILED — {}/{} components valid, {} issues:", valid_count, total_count, len(issues))
        for issue in issues:
            logger.error("  - {}", issue)
        logger.error("")
        logger.error("Fix the design board before proceeding to mockup convergence.")
        logger.error("No production TSX until the design board passes.")

    return DesignBoardResult(
        passed=all_passed,
        components=components,
        total_components=total_count,
        valid_components=valid_count,
        issues=issues,
    )


# ─── Main Convergence Orchestrator ────────────────────────────────────────────

def run_converge(
    client_persona: str,
    board_path: Path,
    designer_rules: Optional[Path] = None,
    max_rounds: int = 5,
    manifest: Optional[Path] = None,
    tokens: Optional[Path] = None,
    provider: str = "gemini",
    surface: Optional[str] = None,
    output_base: Optional[Path] = None,
    skip_gate0: bool = False,
    skip_gate1: bool = False,
) -> ConvergeResult:
    """Run the full three-gate convergence loop.

    Gate 0: Spec preflight (can the client find their workflow in the spec?)
    Gate 1: Design board validation (does every component have full spec?)
    Gate 2: Mockup convergence (does the client approve the rendered result?)

    No production TSX is written until all three gates pass.
    """
    result = ConvergeResult(
        gate0_passed=False,
        gate1_passed=False,
        gate2_passed=False,
    )

    logger.info("")
    logger.info("╔" + "═" * 68 + "╗")
    logger.info("║  DESIGN CONVERGENCE LOOP                                         ║")
    logger.info("║  Client: {:<57}║", client_persona)
    logger.info("║  Board:  {:<57}║", str(board_path)[-57:])
    logger.info("║  Max rounds: {:<53}║", max_rounds)
    logger.info("╚" + "═" * 68 + "╝")
    logger.info("")

    # ── Gate 0: Spec Preflight ──
    if skip_gate0:
        logger.warning("GATE 0: SKIPPED (--skip-gate0)")
        result.gate0_passed = True
    else:
        gate0 = run_spec_preflight(board_path, client_persona)
        result.gate0 = gate0
        result.gate0_passed = gate0.passed

        if not gate0.passed:
            logger.error("")
            logger.error("BLOCKED: Spec preflight failed. Fix the design board spec.")
            logger.error("The client ({}) cannot find their workflow in the spec.", client_persona)
            _write_converge_result(result, output_base or board_path.parent)
            return result

    # ── Gate 1: Design Board Validation ──
    if skip_gate1:
        logger.warning("GATE 1: SKIPPED (--skip-gate1)")
        result.gate1_passed = True
    else:
        gate1 = run_design_board_validation(board_path, designer_rules)
        result.gate1 = gate1
        result.gate1_passed = gate1.passed

        if not gate1.passed:
            logger.error("")
            logger.error("BLOCKED: Design board validation failed.")
            logger.error("Every component needs: mockup_html, mockup_png, rationale,")
            logger.error("expected_results, component_type, animation, hover_states,")
            logger.error("keyboard, data_source.")
            logger.error("")
            logger.error("NO PRODUCTION TSX UNTIL THE DESIGN BOARD PASSES.")
            _write_converge_result(result, output_base or board_path.parent)
            return result

    # ── Gate 2: Mockup Convergence ──
    logger.info("")
    logger.info("=" * 70)
    logger.info("GATE 2: MOCKUP CONVERGENCE — {} reviews rendered mockups", client_persona)
    logger.info("=" * 70)

    # Load Steve Schoger (designer) and Nico's persona for two-persona dialogue
    designer_dict = load_designer(designer_rules) if designer_rules else load_designer()
    client_persona_dict = load_persona(client_persona)
    mockup_dir = board_path.parent / "figures"

    loop_results = run_improvement_loop(
        persona=client_persona,
        max_rounds=max_rounds,
        manifest=manifest,
        tokens=tokens,
        provider=provider,
        surface=surface,
        output_base=output_base,
        designer=designer_dict,
        mockup_dir=mockup_dir if mockup_dir.exists() else None,
        client_persona=client_persona_dict,
    )

    if loop_results:
        result.gate2_rounds = len(loop_results)
        result.gate2_converged = loop_results[-1].converged
        result.gate2_passed = loop_results[-1].converged

    result.production_approved = (
        result.gate0_passed and result.gate1_passed and result.gate2_passed
    )

    # Write final result
    _write_converge_result(result, output_base or board_path.parent)

    logger.info("")
    logger.info("╔" + "═" * 68 + "╗")
    if result.production_approved:
        logger.info("║  PRODUCTION APPROVED — all 3 gates passed                        ║")
        logger.info("║  {} approved the design board after {} rounds{} ║",
                     client_persona, result.gate2_rounds,
                     " " * (38 - len(client_persona) - len(str(result.gate2_rounds))))
        logger.info("║  TSX implementation may now proceed.                             ║")
    else:
        logger.info("║  PRODUCTION BLOCKED                                              ║")
        g0 = "PASS" if result.gate0_passed else "FAIL"
        g1 = "PASS" if result.gate1_passed else "FAIL"
        g2 = "PASS" if result.gate2_passed else "FAIL"
        logger.info("║  Gate 0 (Spec):    {}                                           ║", g0)
        logger.info("║  Gate 1 (Board):   {}                                           ║", g1)
        logger.info("║  Gate 2 (Mockup):  {}                                           ║", g2)
    logger.info("╚" + "═" * 68 + "╝")

    return result


def _write_converge_result(result: ConvergeResult, output_dir: Path):
    """Write machine-readable convergence result."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    data = {
        "production_approved": result.production_approved,
        "gate0_spec_preflight": {
            "passed": result.gate0_passed,
            "missing": result.gate0.missing if result.gate0 else [],
        },
        "gate1_design_board": {
            "passed": result.gate1_passed,
            "total_components": result.gate1.total_components if result.gate1 else 0,
            "valid_components": result.gate1.valid_components if result.gate1 else 0,
            "issues": result.gate1.issues if result.gate1 else [],
        },
        "gate2_mockup_convergence": {
            "passed": result.gate2_passed,
            "rounds": result.gate2_rounds,
            "converged": result.gate2_converged,
        },
    }

    result_path = output_dir / "converge_result.json"
    result_path.write_text(json.dumps(data, indent=2))
    logger.info("Convergence result: {}", result_path)


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Design convergence loop with three hard gates. "
                    "No production TSX until the client persona approves.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Gates:
  0  SPEC PREFLIGHT     Client's workflow covered in the spec?
  1  DESIGN BOARD       Every component has mockup, rationale, animation spec?
  2  MOCKUP CONVERGENCE Client grades mockups >= threshold?

Examples:
  # Full convergence (all 3 gates)
  python converge.py --client nico-bailon --board design/DESIGN_BOARD.md

  # Validate spec + board only (no mockup loop)
  python converge.py --client nico-bailon --board design/DESIGN_BOARD.md --gates 0,1

  # Skip to mockup loop (spec + board already validated)
  python converge.py --client nico-bailon --board design/DESIGN_BOARD.md \\
      --skip-gate0 --skip-gate1
        """,
    )
    parser.add_argument("--client", required=True,
                        help="Client persona name (e.g. nico-bailon). The client approves or rejects.")
    parser.add_argument("--board", type=Path, required=True,
                        help="Path to DESIGN_BOARD.md")
    parser.add_argument("--designer-rules", type=Path, default=None,
                        help="Path to designer persona YAML (e.g. steve_schoger_persona.yaml) — "
                             "applied as design constraints, NOT an active agent")
    parser.add_argument("--max-rounds", type=int, default=5,
                        help="Max mockup convergence rounds (default: 5)")
    parser.add_argument("--manifest", type=Path, default=None,
                        help="Custom interaction manifest for /test-interactions")
    parser.add_argument("--tokens", type=Path, default=None,
                        help="Design tokens JSON file")
    parser.add_argument("--provider", default="gemini",
                        help="Vision LLM provider for /review-design (default: gemini)")
    parser.add_argument("--surface", default=None,
                        help="Test only this surface")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output directory for convergence runs")
    parser.add_argument("--skip-gate0", action="store_true",
                        help="Skip spec preflight (use when spec is already validated)")
    parser.add_argument("--skip-gate1", action="store_true",
                        help="Skip design board validation (use when board is already validated)")
    parser.add_argument("--gates", default=None,
                        help="Run only these gates (comma-separated: 0,1,2). "
                             "Useful for validating spec/board without running the full loop.")

    args = parser.parse_args()

    # Handle --gates flag
    skip_gate0 = args.skip_gate0
    skip_gate1 = args.skip_gate1
    run_gate2 = True

    if args.gates:
        gates = set(args.gates.split(","))
        if "0" not in gates:
            skip_gate0 = True
        if "1" not in gates:
            skip_gate1 = True
        if "2" not in gates:
            run_gate2 = False

    if not run_gate2:
        # Validate-only mode: run gates 0 and/or 1 but not the loop
        result = ConvergeResult(gate0_passed=False, gate1_passed=False, gate2_passed=False)

        if not skip_gate0:
            gate0 = run_spec_preflight(args.board, args.client)
            result.gate0 = gate0
            result.gate0_passed = gate0.passed

        if not skip_gate1:
            gate1 = run_design_board_validation(args.board, args.designer_rules)
            result.gate1 = gate1
            result.gate1_passed = gate1.passed

        _write_converge_result(result, args.output or args.board.parent)
        sys.exit(0 if (result.gate0_passed and result.gate1_passed) else 1)

    result = run_converge(
        client_persona=args.client,
        board_path=args.board,
        designer_rules=args.designer_rules,
        max_rounds=args.max_rounds,
        manifest=args.manifest,
        tokens=args.tokens,
        provider=args.provider,
        surface=args.surface,
        output_base=args.output,
        skip_gate0=skip_gate0,
        skip_gate1=skip_gate1,
    )

    sys.exit(0 if result.production_approved else 1)


if __name__ == "__main__":
    main()
