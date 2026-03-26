#!/usr/bin/env python3
"""Persona-driven validation for the design convergence loop.

Loads client persona (Nico) and designer persona (Steve Schoger) YAMLs,
generating spec preflight checks and design board constraints.

- Client persona → Gate 0 checks (viewer_priorities, qa_workflow, thresholds)
- Designer persona → Gate 1 checks (spacing, contrast, typography, dark mode rules)
"""

import re
from pathlib import Path
from typing import Optional

try:
    import yaml
except ImportError:
    yaml = None

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)


# ─── Persona YAML Locations ─────────────────────────────────────────────────
PERSONA_DIR = Path.home() / ".pi" / "skills" / "extractor-quality-check"
PERSONA_YAMLS = {
    "nico-bailon": PERSONA_DIR / "nico_bailon_persona.yaml",
    "brandon-bailey": PERSONA_DIR / "brandon_bailey_persona.yaml",
    "margaret-chen": PERSONA_DIR / "margaret_chen_persona.yaml",
    "steve-schoger": PERSONA_DIR / "steve_schoger_persona.yaml",
}

# Steve is the default designer — his rules constrain all design boards
DEFAULT_DESIGNER = "steve-schoger"


def load_persona(name: str) -> Optional[dict]:
    """Load a persona YAML and return parsed dict."""
    if yaml is None:
        logger.warning("PyYAML not installed — persona-driven checks disabled")
        return None

    yaml_path = PERSONA_YAMLS.get(name)
    if not yaml_path or not yaml_path.exists():
        alt = PERSONA_DIR / f"{name.replace('-', '_')}_persona.yaml"
        if alt.exists():
            yaml_path = alt
        else:
            logger.warning("No persona YAML found for '{}' — using generic checks", name)
            return None

    logger.info("Loading persona: {}", yaml_path)
    return yaml.safe_load(yaml_path.read_text())


def load_designer(designer_rules_path: Optional[Path] = None) -> Optional[dict]:
    """Load the designer persona YAML (Steve Schoger by default)."""
    if designer_rules_path and designer_rules_path.exists():
        if yaml is None:
            return None
        logger.info("Loading designer rules: {}", designer_rules_path)
        return yaml.safe_load(designer_rules_path.read_text())
    return load_persona(DEFAULT_DESIGNER)


# ─── Client Persona → Gate 0 Checks ─────────────────────────────────────────

# Map priority keywords to search patterns
_PRIORITY_PATTERNS = {
    "keyboard": [r"keyboard|j/k|hotkey|shortcut"],
    "j/k": [r"keyboard|j/k|hotkey|shortcut"],
    "side-by-side": [r"side.by.side|split|compare"],
    "re-extract": [r"re.extract|retry|strategy.*override"],
    "diff": [r"diff|compare|delta"],
    "batch": [r"batch|bulk|multi.select"],
    "filter": [r"filter|sort|search"],
    "click-through": [r"click.through|navigate|link.*to.*pdf"],
    "click through": [r"click.through|navigate|link.*to.*pdf"],
    "histogram": [r"histogram|distribution|chart|confidence"],
    "animation": [r"no.*animation|animation.*none|no.*unnecessary"],
    "dark": [r"dark.*theme|nvis|mil.std.3009"],
    "nvis": [r"dark.*theme|nvis|mil.std.3009"],
    "200ms": [r"\d+ms|fast|performance|load.*time"],
    "load": [r"\d+ms|fast|performance|load.*time"],
}

_QA_PATTERNS = {
    "visual scan": [r"visual|layout|render"],
    "layout": [r"visual|layout|render"],
    "compare": [r"compare|side.by.side|diff"],
    "table": [r"table.*column|column.*count|table.*fidelity"],
    "section hierarchy": [r"section|hierarchy|heading.*level"],
    "figure": [r"figure|bbox|bounding"],
    "encoding": [r"encoding|unicode|ligature"],
    "unicode": [r"encoding|unicode|ligature"],
    "cascade": [r"cascade|heuristic|classifier"],
    "timeout": [r"timeout|extraction.*time|performance"],
    "extraction time": [r"timeout|extraction.*time|performance"],
}


def build_client_checks(persona: dict) -> dict:
    """Generate Gate 0 checks from the client persona YAML.

    Extracts viewer_priorities, qa_workflow, and quality_focus thresholds.
    """
    checks = {}
    name = persona.get("name", "client")

    # Viewer priorities → spec requirements
    for tab_name, priorities in persona.get("viewer_priorities", {}).items():
        if not isinstance(priorities, list):
            continue
        for i, priority in enumerate(priorities):
            priority_lower = priority.lower()
            key_words = None
            for keyword, patterns in _PRIORITY_PATTERNS.items():
                if keyword in priority_lower:
                    key_words = patterns
                    break
            if key_words:
                checks[f"persona_{tab_name}_{i}"] = {
                    "description": f"[{name}] {priority}",
                    "patterns": key_words,
                    "source": "viewer_priorities",
                }

    # Quality thresholds must appear in the spec
    thresholds = persona.get("quality_focus", {}).get("thresholds", {})
    if thresholds:
        checks["persona_quality_thresholds"] = {
            "description": f"[{name}] Quality thresholds ({', '.join(f'{k}={v}' for k, v in thresholds.items())})",
            "patterns": [rf"{val}" for val in thresholds.values()],
            "source": "quality_focus",
        }

    # QA workflow checklist items
    checklist = persona.get("qa_workflow", {}).get("quarantine_review", {}).get("checklist", [])
    for i, item in enumerate(checklist):
        item_lower = item.lower()
        key_words = None
        for keyword, patterns in _QA_PATTERNS.items():
            if keyword in item_lower:
                key_words = patterns
                break
        if key_words:
            checks[f"persona_qa_{i}"] = {
                "description": f"[{name}] QA: {item[:60]}",
                "patterns": key_words,
                "source": "qa_workflow",
            }

    return checks


# ─── Designer Persona → Gate 1 Checks ───────────────────────────────────────

def build_designer_checks(designer: dict) -> dict:
    """Generate Gate 1 design board checks from the designer persona YAML.

    Steve Schoger's rules become validation constraints on the design board:
    - Background layers must use NVIS tokens (not raw hex)
    - Typography must specify font weights >= 400
    - Borders must be 1px max or spacing-based
    - Animation must be <= 200ms or none
    - Spacing must follow 4px/8px grid
    - Tables must have right-aligned numeric columns
    """
    checks = {}
    name = designer.get("name", "designer")

    # modern_dark_mode_rules → design board constraints
    rules = designer.get("modern_dark_mode_rules", {})

    if rules.get("background_layers"):
        checks["designer_bg_tokens"] = {
            "description": f"[{name}] Background layers use semantic tokens (not raw hex)",
            "patterns": [r"bg|background|surface|embry.*style|nvis|token"],
            "source": "designer_rules",
        }

    if rules.get("text_hierarchy"):
        checks["designer_text_hierarchy"] = {
            "description": f"[{name}] Text hierarchy defined (primary/secondary/muted)",
            "patterns": [r"primary.*text|secondary.*text|muted|dim|text.*hierarchy"],
            "source": "designer_rules",
        }

    if rules.get("borders"):
        checks["designer_borders"] = {
            "description": f"[{name}] Borders: 1px max, prefer spacing over borders",
            "patterns": [r"border|spacing|1px"],
            "source": "designer_rules",
        }

    if rules.get("spacing"):
        checks["designer_spacing_grid"] = {
            "description": f"[{name}] Spacing follows grid system (4px/8px)",
            "patterns": [r"4px|8px|spacing|grid|gap"],
            "source": "designer_rules",
        }

    if rules.get("typography"):
        checks["designer_typography"] = {
            "description": f"[{name}] Typography: Inter/Geist, monospace for numbers, 13-14px body",
            "patterns": [r"inter|geist|monospace|font.*size|13px|14px"],
            "source": "designer_rules",
        }

    if rules.get("animation"):
        checks["designer_animation_limit"] = {
            "description": f"[{name}] Animation: <=200ms, functional only, no decorative",
            "patterns": [r"150ms|200ms|no.*decorat|functional.*only|animation.*none"],
            "source": "designer_rules",
        }

    if rules.get("keyboard_first"):
        checks["designer_keyboard_first"] = {
            "description": f"[{name}] Keyboard-first: Cmd+K, single-key shortcuts, arrow nav",
            "patterns": [r"cmd.*k|command.*palette|keyboard.*first|shortcut"],
            "source": "designer_rules",
        }

    if rules.get("table_rules"):
        checks["designer_table_rules"] = {
            "description": f"[{name}] Tables: left-align text, right-align numbers, monospace numeric",
            "patterns": [r"right.align|monospace|numeric|table.*align"],
            "source": "designer_rules",
        }

    # Schoger core principles from expertise list
    expertise = designer.get("expertise", [])
    for item in expertise:
        item_lower = item.lower() if isinstance(item, str) else ""
        if "contrast" in item_lower and "size" in item_lower:
            checks["designer_contrast_over_size"] = {
                "description": f"[{name}] Visual hierarchy through contrast, not size",
                "patterns": [r"contrast|hierarchy|weight"],
                "source": "designer_expertise",
            }
        elif "border elimination" in item_lower:
            checks["designer_no_borders"] = {
                "description": f"[{name}] Border elimination — spacing and background shifts instead",
                "patterns": [r"no.*border|spacing.*instead|background.*shift"],
                "source": "designer_expertise",
            }

    return checks


def validate_board_against_designer(board_content: str, designer: dict) -> list[dict]:
    """Validate design board content against designer rules.

    Returns list of {check_name, description, passed, source} dicts.
    """
    checks = build_designer_checks(designer)
    content_lower = board_content.lower()
    results = []

    for check_name, check_def in checks.items():
        patterns = check_def["patterns"]
        matches = sum(1 for p in patterns if re.search(p, content_lower, re.IGNORECASE))
        threshold = max(1, len(patterns) // 2)
        passed = matches >= threshold

        results.append({
            "check_name": check_name,
            "description": check_def["description"],
            "passed": passed,
            "matches": matches,
            "required": threshold,
            "source": check_def.get("source", "designer_rules"),
        })

    return results
