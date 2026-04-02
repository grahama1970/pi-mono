"""Runtime readiness scanners for skills-ci.

Validates shell syntax, triggers presence, and executable permissions
for skill directories. Each scanner returns a list of Violation objects
following the same pattern as scanners.py.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List

from loguru import logger

_THIS_DIR = str(Path(__file__).resolve().parent)
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from models import Violation
from scanners import list_skill_dirs, parse_frontmatter


def is_internal_skill(text: str) -> bool:
    """Check if a SKILL.md declares ``internal: true`` in frontmatter.

    Internal skills are infrastructure/build-time tools not invoked by
    humans directly. They are exempt from trigger validation and naming
    convention warnings.
    """
    fm = parse_frontmatter(text)
    if fm is None:
        return False
    return bool(fm.get("internal"))


def _check_shell_syntax(script: Path, skill_name: str) -> List[Violation]:
    """Run ``bash -n`` on a shell script to detect syntax errors."""
    violations: List[Violation] = []
    try:
        result = subprocess.run(
            ["bash", "-n", str(script)],
            capture_output=True,
            text=True,
            timeout=10,
            env={k: v for k, v in os.environ.items() if k != 'VIRTUAL_ENV'},
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            # Truncate long error messages
            if len(stderr) > 200:
                stderr = stderr[:200] + "..."
            violations.append(Violation(
                rule="runtime.shell_syntax",
                severity="error",
                skill=skill_name,
                path=str(script),
                message=f"Shell syntax error in {script.name}: {stderr}",
            ))
    except subprocess.TimeoutExpired:
        violations.append(Violation(
            rule="runtime.shell_syntax",
            severity="error",
            skill=skill_name,
            path=str(script),
            message=f"Shell syntax check timed out for {script.name}.",
        ))
    except FileNotFoundError:
        # bash not available -- skip silently
        logger.debug("bash not found; skipping shell syntax check")
    return violations


def _parse_triggers_from_skill_md(text: str) -> List[str]:
    """Extract triggers list from SKILL.md frontmatter.

    Handles YAML list format::

        triggers:
          - phrase one
          - phrase two

    Also handles inline format::

        triggers: [phrase one, phrase two]
    """
    # Find frontmatter boundaries
    if not text.startswith("---\n"):
        return []
    end = text.find("\n---\n", 4)
    if end == -1:
        # Also try end-of-file frontmatter (some files end with ---)
        end = text.find("\n---", 4)
        if end == -1:
            return []

    frontmatter = text[4:end]

    # Find the triggers key
    match = re.search(r"^triggers:\s*(.*)", frontmatter, re.MULTILINE)
    if not match:
        return []

    inline_value = match.group(1).strip()

    # Inline list format: triggers: [a, b, c]
    if inline_value.startswith("["):
        inner = inline_value.strip("[]")
        items = [item.strip().strip("'\"") for item in inner.split(",") if item.strip()]
        return items

    # If there's an inline value that's not a list, treat as single trigger
    if inline_value and not inline_value.startswith("#"):
        return [inline_value.strip("'\"")]

    # YAML list format: look for subsequent lines starting with "  - "
    triggers: List[str] = []
    lines = frontmatter.splitlines()
    in_triggers = False
    for line in lines:
        if line.startswith("triggers:"):
            in_triggers = True
            continue
        if in_triggers:
            stripped = line.strip()
            if stripped.startswith("- "):
                trigger_text = stripped[2:].strip().strip("'\"")
                if trigger_text:
                    triggers.append(trigger_text)
            elif stripped == "" or stripped.startswith("#"):
                # Blank lines or comments within the list are OK
                continue
            else:
                # Hit next key -- stop collecting triggers
                break

    return triggers


# Words too generic to be useful as trigger vocabulary.
# Triggers containing ONLY these words will be flagged.
_STOP_WORDS = {
    "run", "do", "make", "this", "that", "it", "the", "a", "an",
    "please", "help", "go", "start", "execute", "use", "get",
}


def _check_triggers(skill_dir: Path) -> List[Violation]:
    """Check that SKILL.md frontmatter has non-empty, high-quality triggers.

    Validates:
    1. Triggers exist (not empty)
    2. Trigger quality: each trigger should be >= 3 words with domain vocabulary
    3. No duplicate triggers across the trigger list

    Skills with ``internal: true`` in frontmatter are exempt.
    """
    violations: List[Violation] = []
    skill_name = skill_dir.name
    skill_md = skill_dir / "SKILL.md"

    if not skill_md.exists():
        return violations

    try:
        text = skill_md.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return violations

    if is_internal_skill(text):
        return violations

    triggers = _parse_triggers_from_skill_md(text)

    if not triggers:
        violations.append(Violation(
            rule="runtime.missing_triggers",
            severity="warn",
            skill=skill_name,
            path=str(skill_md),
            message="SKILL.md frontmatter has no triggers — skill is invisible to "
                    "Tier 2/3 discovery and voice control. Add triggers or set "
                    "internal: true if this is infrastructure.",
        ))
        return violations

    # Check trigger quality
    vague_triggers = []
    for trigger in triggers:
        words = trigger.lower().split()
        # Too short — won't disambiguate from other skills
        if len(words) < 3:
            vague_triggers.append(trigger)
            continue
        # All words are stop words — no domain vocabulary
        meaningful = [w for w in words if w not in _STOP_WORDS]
        if not meaningful:
            vague_triggers.append(trigger)

    if vague_triggers:
        violations.append(Violation(
            rule="runtime.vague_triggers",
            severity="warn",
            skill=skill_name,
            path=str(skill_md),
            message=f"Vague triggers will cause false matches in voice/intent "
                    f"pipeline: {vague_triggers}. Each trigger should be >= 3 words "
                    f"with domain-specific vocabulary.",
        ))

    # Check for duplicates
    seen = set()
    dupes = []
    for trigger in triggers:
        normalized = trigger.lower().strip()
        if normalized in seen:
            dupes.append(trigger)
        seen.add(normalized)
    if dupes:
        violations.append(Violation(
            rule="runtime.duplicate_triggers",
            severity="warn",
            skill=skill_name,
            path=str(skill_md),
            message=f"Duplicate triggers waste voice/intent search space: {dupes}",
        ))

    return violations


def _check_executable_bit(skill_dir: Path) -> List[Violation]:
    """Check that run.sh has the executable permission bit set."""
    violations: List[Violation] = []
    skill_name = skill_dir.name
    run_sh = skill_dir / "run.sh"

    if not run_sh.exists():
        return violations

    if not os.access(run_sh, os.X_OK):
        violations.append(Violation(
            rule="runtime.run_sh_not_executable",
            severity="warn",
            skill=skill_name,
            path=str(run_sh),
            message="run.sh is not executable (missing +x permission).",
        ))

    return violations


def _check_read_before_use(skill_dir: Path) -> List[Violation]:
    """Check that read_before_use paths in SKILL.md frontmatter actually exist."""
    violations: List[Violation] = []
    skill_name = skill_dir.name
    skill_md = skill_dir / "SKILL.md"

    if not skill_md.exists():
        return violations

    try:
        text = skill_md.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return violations

    fm = parse_frontmatter(text)
    if fm is None:
        return violations

    rbu = fm.get("read_before_use")
    if not isinstance(rbu, list) or not rbu:
        return violations

    for path_str in rbu:
        target = skill_dir / str(path_str)
        # Also check relative to parent (for _shared/ references)
        target_alt = skill_dir.parent / str(path_str)
        if not target.exists() and not target_alt.exists():
            violations.append(Violation(
                rule="runtime.read_before_use_missing",
                severity="warn",
                skill=skill_name,
                path=str(skill_md),
                message=f"read_before_use references '{path_str}' but file not found at {target} or {target_alt}",
            ))

    return violations


def _check_bare_python_in_runsh(skill_dir: Path) -> List[Violation]:
    """Check that run.sh doesn't call bare python3 when pyproject.toml exists.

    If a skill has pyproject.toml (declaring dependencies), all python invocations
    in run.sh MUST use `uv run --project` or activate the .venv. Bare `python3`
    picks up system/~/.local packages which may have incompatible versions.

    The `alias python3='uv run ...'` pattern is acceptable IF shopt expand_aliases
    is set. Direct calls inside nohup/env/xargs don't expand aliases — those must
    use explicit `uv run`.

    Incident: 2026-03-17 anyio version mismatch broke /orchestrate because run.sh
    used bare python3 instead of uv run.
    """
    violations: List[Violation] = []
    skill_name = skill_dir.name
    run_sh = skill_dir / "run.sh"
    pyproject = skill_dir / "pyproject.toml"

    if not run_sh.exists() or not pyproject.exists():
        return violations

    try:
        text = run_sh.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return violations

    has_alias = "alias python3=" in text and "expand_aliases" in text
    lines = text.splitlines()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip comments, empty lines, echo/printf (display only)
        if not stripped or stripped.startswith("#"):
            continue
        if any(stripped.startswith(p) for p in ("echo ", "printf ", "alias ")):
            continue

        # Detect bare python3 calls that bypass the alias
        # These are in contexts where aliases don't expand: nohup, env, xargs, $()
        bare_contexts = ["nohup python3", "nohup python ", "env python3", "xargs.*python3"]
        for ctx in bare_contexts:
            if re.search(ctx, stripped):
                violations.append(Violation(
                    rule="runtime.bare_python_nohup",
                    severity="warn",
                    skill=skill_name,
                    path=f"{run_sh}:{i}",
                    message=f"Bare python3 in alias-blind context ({ctx.split()[0]}). Use 'uv run --project' explicitly.",
                ))

        # If no alias, any python3 call is suspect
        if not has_alias and re.search(r'\bpython3?\s+"?\$', stripped):
            # Exclude lines that already use uv run
            if "uv run" not in stripped:
                violations.append(Violation(
                    rule="runtime.bare_python_no_uv",
                    severity="warn",
                    skill=skill_name,
                    path=f"{run_sh}:{i}",
                    message="Bare python3 call without uv run or alias. Deps from pyproject.toml won't be available.",
                ))

    return violations


def _check_docker_compose(skill_dir: Path) -> List[Violation]:
    """Check that skills using 'docker run -d' have a docker-compose.yml.

    Persistent containers should be declared in docker-compose.yml, not buried
    in shell scripts. The compose file is the canonical spec; run.sh handles
    dynamic lifecycle on top of it.
    """
    violations: List[Violation] = []
    skill_name = skill_dir.name
    run_sh = skill_dir / "run.sh"

    if not run_sh.exists():
        return violations

    try:
        text = run_sh.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return violations

    # Only check skills that launch persistent (detached) containers
    if "docker run -d" not in text:
        return violations

    compose_file = skill_dir / "docker-compose.yml"
    if not compose_file.exists():
        violations.append(Violation(
            rule="runtime.docker_no_compose",
            severity="warn",
            skill=skill_name,
            path=str(run_sh),
            message="Uses 'docker run -d' but has no docker-compose.yml. Container specs should be declarative.",
        ))

    return violations


def scan_runtime_readiness(skill_dir: Path) -> List[Violation]:
    """Run all runtime readiness checks on a single skill directory.

    Checks:
    1. Shell syntax validation (bash -n) on run.sh and sanity.sh
    2. Triggers presence in SKILL.md frontmatter
    3. Executable bit on run.sh
    4. read_before_use paths exist
    5. Bare python3 calls when pyproject.toml exists
    6. docker run -d without docker-compose.yml

    Returns a list of Violation objects.
    """
    violations: List[Violation] = []
    skill_name = skill_dir.name

    # 1. Shell syntax validation
    for script_name in ("run.sh", "sanity.sh"):
        script = skill_dir / script_name
        if script.exists():
            violations.extend(_check_shell_syntax(script, skill_name))

    # 2. Triggers validation
    violations.extend(_check_triggers(skill_dir))

    # 3. Executable bit check
    violations.extend(_check_executable_bit(skill_dir))

    # 4. read_before_use validation
    violations.extend(_check_read_before_use(skill_dir))

    # 5. Bare python3 in run.sh
    violations.extend(_check_bare_python_in_runsh(skill_dir))

    # 6. Docker compose check
    violations.extend(_check_docker_compose(skill_dir))

    return violations
