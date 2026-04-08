#!/usr/bin/env python3
"""Unified skill policy hook for Claude Code.

Single hook handling 4 events:
  - UserPromptSubmit: detect /slash skills, load policy.yaml contracts, capture baseline
  - PostToolUse(Read): track which files the agent has read
  - PreToolUse(Write|Edit|Bash): enforce required_reads, forbidden_use, bash_policy
  - Stop: final workspace validation against loaded contracts

Replaces: skill-check.sh, post-skill-check.sh, bash-mutation-guard.sh
Keeps: unset-venv.sh (different concern), post-compact-resume.sh (different event),
       code_runner_guard.py (orthogonal code-runner DoD enforcement)
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None

REPO_ROOT = None
STATE_DIR = Path(".claude/hooks/state")
SKILLS_DIR = Path(".pi/skills")
GLOBAL_POLICY_DIR = Path(".claude/policies")


def repo_root() -> Path:
    global REPO_ROOT
    if REPO_ROOT is not None:
        return REPO_ROOT
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        REPO_ROOT = Path(out.stdout.strip()).resolve()
    except Exception:
        REPO_ROOT = Path.cwd().resolve()
    return REPO_ROOT


def rel_repo_path(path: str | Path, root: Path | None = None) -> str:
    root = root or repo_root()
    p = Path(path)
    if not p.is_absolute():
        p = (root / p).resolve()
    try:
        return p.relative_to(root).as_posix()
    except Exception:
        return p.resolve().as_posix()


def load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def get_event(payload: dict[str, Any]) -> str:
    return payload.get("hook_event_name", "")


def get_tool_name(payload: dict[str, Any]) -> str:
    return payload.get("tool_name", "")


def emit(data: dict[str, Any]) -> None:
    print(json.dumps(data))


def emit_deny(reason: str, event: str = "PreToolUse") -> None:
    emit({
        "hookSpecificOutput": {
            "hookEventName": event,
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })
    sys.exit(0)


def emit_warn(message: str) -> None:
    """Print a warning to stderr (visible to user) but allow the operation."""
    print(message, file=sys.stderr)


# --- State management ---

def state_path(payload: dict[str, Any]) -> Path:
    session_id = payload.get("session_id", "default")
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", session_id)
    root = repo_root()
    path = root / STATE_DIR / f"{safe}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_state(path: Path) -> dict[str, Any]:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {
        "skills": [],
        "required_reads": [],
        "required_use": {"any_of": [], "allow_parallel_impl": True},
        "forbidden_use": {"any_of": []},
        "bash_policy": {},
        "files_read": [],
        "baseline_status": [],
        "baseline_hashes": {},
        "root": str(repo_root()),
    }


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True))


# --- Slash command detection ---

def detect_slash_skills(prompt: str) -> list[str]:
    found = re.findall(r"(?<!\S)/([a-zA-Z0-9_-]+)\b", prompt)
    return list(dict.fromkeys(found))


# --- Policy loading ---

def load_policy_yaml(path: Path) -> dict[str, Any] | None:
    if yaml is None:
        return None
    if not path.exists():
        return None
    try:
        data = yaml.safe_load(path.read_text()) or {}
        return data
    except Exception:
        return None


def load_policy_for_skill(skill_name: str) -> dict[str, Any] | None:
    root = repo_root()
    return load_policy_yaml(root / SKILLS_DIR / skill_name / "policy.yaml")


def load_global_policies() -> list[dict[str, Any]]:
    """Load all policy.yaml files from .claude/policies/ (always-on rules)."""
    root = repo_root()
    policy_dir = root / GLOBAL_POLICY_DIR
    if not policy_dir.exists():
        return []
    policies = []
    for f in sorted(policy_dir.glob("*.yaml")):
        p = load_policy_yaml(f)
        if p:
            policies.append(p)
    return policies


def merge_policies(policies: list[dict[str, Any]], root: Path) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "skills": [],
        "required_reads": [],
        "required_use": {"any_of": [], "allow_parallel_impl": True},
        "forbidden_use": {"any_of": []},
        "bash_policy": {},
        "root": str(root),
    }
    for p in policies:
        if p.get("name"):
            merged["skills"].append(p["name"])
        merged["required_reads"].extend(p.get("required_reads", []))
        merged["required_use"]["any_of"].extend(
            p.get("required_use", {}).get("any_of", [])
        )
        merged["forbidden_use"]["any_of"].extend(
            p.get("forbidden_use", {}).get("any_of", [])
        )
        if p.get("required_use", {}).get("allow_parallel_impl", True) is False:
            merged["required_use"]["allow_parallel_impl"] = False
        if p.get("bash_policy"):
            merged["bash_policy"] = p["bash_policy"]

    merged["skills"] = list(dict.fromkeys(merged["skills"]))
    merged["required_reads"] = list(dict.fromkeys(
        rel_repo_path(x, root) for x in merged["required_reads"]
    ))
    return merged


# --- Git helpers ---

def git_status_porcelain(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root, capture_output=True, text=True, check=True,
        )
        return out.stdout.splitlines()
    except Exception:
        return []


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def capture_baseline(required_reads: list[str], root: Path) -> tuple[list[str], dict[str, str]]:
    status = git_status_porcelain(root)
    hashes: dict[str, str] = {}
    for rel in required_reads:
        p = root / rel
        if p.exists() and p.is_file():
            hashes[rel] = sha256_file(p)
    return status, hashes


# --- Read tracking ---

def record_read(state: dict[str, Any], payload: dict[str, Any]) -> None:
    tool_input = payload.get("tool_input", {}) or {}
    path = tool_input.get("file_path") or tool_input.get("path")
    if isinstance(path, str) and path:
        root = Path(state.get("root") or repo_root())
        rel = rel_repo_path(path, root)
        state["files_read"] = list(dict.fromkeys(
            state.get("files_read", []) + [rel]
        ))


def any_required_read_satisfied(state: dict[str, Any]) -> bool:
    required = set(state.get("required_reads", []))
    if not required:
        return True
    observed = set(state.get("files_read", []))
    return bool(required & observed)


# --- Content analysis ---

def get_write_target(payload: dict[str, Any], root: Path) -> str | None:
    tool_input = payload.get("tool_input", {}) or {}
    raw = tool_input.get("file_path") or tool_input.get("path")
    if not raw:
        return None
    return rel_repo_path(raw, root)


def get_pending_text(payload: dict[str, Any]) -> str:
    tool_input = payload.get("tool_input", {}) or {}
    text_fields = [
        tool_input.get("content"),
        tool_input.get("new_string"),
        tool_input.get("replacement"),
        tool_input.get("command"),
    ]
    return "\n".join([x for x in text_fields if isinstance(x, str)])


def parse_python_signals(text: str) -> dict[str, set[str]] | None:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    imports: set[str] = set()
    calls: set[str] = set()
    classes: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                imports.add(f"{mod}.{alias.name}" if mod else alias.name)
        elif isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name):
                calls.add(fn.id)
            elif isinstance(fn, ast.Attribute):
                calls.add(fn.attr)
        elif isinstance(node, ast.ClassDef):
            classes.add(node.name)
    return {"imports": imports, "calls": calls, "classes": classes}


# --- Rule checking ---

def check_forbidden_rules(
    rules: list[dict[str, Any]], text: str, py: dict[str, set[str]] | None
) -> str | None:
    for rule in rules:
        # Regex-based pattern match (for non-Python or cross-language patterns)
        if "pattern" in rule:
            if re.search(rule["pattern"], text):
                return rule.get("reason", f"forbidden pattern: {rule['pattern']}")

        if "endpoint" in rule and rule["endpoint"] in text:
            return rule.get("reason", f"forbidden endpoint: {rule['endpoint']}")

        if "shell_contains" in rule and rule["shell_contains"] in text:
            return rule.get("reason", f"forbidden shell pattern: {rule['shell_contains']}")

        if py is None:
            continue

        if "import" in rule:
            needle = rule["import"]
            if any(imp == needle or imp.endswith("." + needle) for imp in py["imports"]):
                return rule.get("reason", f"forbidden import: {needle}")

        if "call" in rule and rule["call"] in py["calls"]:
            return rule.get("reason", f"forbidden call: {rule['call']}")

        if "defines_class" in rule and rule["defines_class"] in py["classes"]:
            return rule.get("reason", f"forbidden class: {rule['defines_class']}")

    return None


def check_required_rules(
    rules: list[dict[str, Any]], target: str | None,
    text: str, py: dict[str, set[str]] | None,
) -> bool:
    if not rules:
        return True
    for rule in rules:
        if "modifies_path" in rule and target:
            if (
                rel_repo_path(rule["modifies_path"], Path.cwd()) == target
                or rule["modifies_path"] == target
            ):
                return True
        if py is None:
            continue
        if "call" in rule and rule["call"] in py["calls"]:
            return True
        if "import_and_use" in rule:
            symbol = rule["import_and_use"].split(".")[-1]
            if (
                any(symbol == imp.split(".")[-1] for imp in py["imports"])
                and symbol in py["calls"]
            ):
                return True
        if "import" in rule:
            needle = rule["import"]
            if any(imp == needle or imp.endswith("." + needle) for imp in py["imports"]):
                return True
        if "endpoint" in rule and rule["endpoint"] in text:
            return True
    return False


# --- Bash mutation detection (ported from bash-mutation-guard.sh) ---

BASH_MUTATION_PATTERNS = [
    (r"\s+>\s+\S+\.(py|ts|tsx|js|jsx|sh|rs|go|c|cpp|java)", "shell redirect to code file"),
    (r"cat\s*>|>\s*\S+\.(py|ts|tsx|js|jsx|sh)|cat\s*<<|tee\s+\S+\.(py|ts|tsx|js|jsx|sh)", "cat/tee/heredoc write to code file"),
    (r"sed\s+-i|perl\s+-[pi]i?", "in-place edit (use Edit tool)"),
    (r"(mv|cp)\s+.*\s+.*(src/|lib/|\.pi/skills/)", "mv/cp into source directory"),
    (r"git\s+checkout\s+--\s", "git checkout -- (overwrites files)"),
    (r"python3?\s+-c.*open\(.*['\"]w['\"]", "python -c file write"),
]

BASH_SAFE_PREFIXES = (
    "ls ", "head ", "tail ", "wc ", "grep ", "rg ", "find ",
    "git status", "git log", "git diff", "git show", "git branch",
    "python3 -c", "python -c", "pytest", "npm test", "npm run", "npm install",
    "uv ", "ruff ", "which ", "echo ", "pwd", "cd ", "mkdir ", "chmod ",
    "stat ", "file ", "diff ", "jq ", "curl ", "cat ",
)


def check_bash_mutations(command: str) -> str | None:
    """Check if a bash command mutates files outside Write/Edit tools."""
    stripped = command.strip()

    # Quick-pass safe commands
    if any(stripped.startswith(p) for p in BASH_SAFE_PREFIXES):
        # But catch cat with redirect
        if stripped.startswith("cat ") and ">" not in stripped:
            return None
        elif not stripped.startswith("cat "):
            return None

    # Git commands are safe (commit -m with heredoc, push, etc.)
    if re.match(r"^\s*git\s+(commit|push|tag|stash|fetch|pull|merge|rebase|cherry-pick|log|status|diff|show|branch|remote|config)\b", stripped):
        return None

    # Docker exec runs inside container
    if re.match(r"^\s*(sudo\s+)?docker\s+exec\s", stripped):
        return None

    # Writes to .claude/hooks/ are self-maintenance
    if ".claude/hooks/" in stripped:
        return None

    for pattern, label in BASH_MUTATION_PATTERNS:
        if re.search(pattern, stripped):
            return f"bash mutation detected: {label}. Use Write/Edit tool instead."

    return None


# --- Final validation ---

def touched_files_since_baseline(
    root: Path, baseline_status: list[str]
) -> list[str]:
    current = git_status_porcelain(root)
    touched = set()
    for line in current:
        if len(line) > 3:
            path = line[3:].strip()
            if " -> " in path:
                path = path.split(" -> ")[-1]
            touched.add(path)
    return sorted(touched)


def final_validate(state: dict[str, Any]) -> list[str]:
    root = Path(state.get("root") or repo_root())
    violations: list[str] = []
    required_rules = state.get("required_use", {}).get("any_of", [])
    forbidden_rules = state.get("forbidden_use", {}).get("any_of", [])
    allow_parallel = state.get("required_use", {}).get("allow_parallel_impl", True)

    touched = touched_files_since_baseline(root, state.get("baseline_status", []))
    if not touched:
        return []

    required_rule_satisfied = True if (not required_rules or allow_parallel) else False
    required_paths = {
        rel_repo_path(rule["modifies_path"], root)
        for rule in required_rules if "modifies_path" in rule
    }

    for rel in touched:
        path = root / rel
        if not path.exists() or not path.is_file():
            continue
        try:
            text = path.read_text()
        except Exception:
            continue

        py = None
        if path.suffix == ".py":
            py = parse_python_signals(text)

        bad = check_forbidden_rules(forbidden_rules, text, py)
        if bad:
            violations.append(f"{bad} in {rel}")

        if required_rules and not required_rule_satisfied:
            if rel in required_paths:
                required_rule_satisfied = True
            elif check_required_rules(required_rules, rel, text, py):
                required_rule_satisfied = True

    if required_rules and not allow_parallel and not required_rule_satisfied:
        violations.append("final workspace does not satisfy required implementation path")

    return violations


# --- Event handlers ---

def handle_prompt_submit(payload: dict[str, Any]) -> None:
    """On user prompt: detect skills, load policies, capture baseline."""
    root = repo_root()
    prompt = payload.get("prompt") or payload.get("user_prompt") or payload.get("input") or ""

    # Always load global policies
    global_policies = load_global_policies()

    # Detect slash-invoked skills and load their policies
    skills = detect_slash_skills(prompt)
    skill_policies = [load_policy_for_skill(s) for s in skills]
    skill_policies = [p for p in skill_policies if p]

    all_policies = global_policies + skill_policies
    if not all_policies:
        # No policies to enforce — write empty state so PreToolUse knows
        spath = state_path(payload)
        save_state(spath, load_state(spath))
        return

    merged = merge_policies(all_policies, root)
    baseline_status, baseline_hashes = capture_baseline(merged["required_reads"], root)
    merged["files_read"] = []
    merged["baseline_status"] = baseline_status
    merged["baseline_hashes"] = baseline_hashes
    save_state(state_path(payload), merged)


def handle_post_read(payload: dict[str, Any]) -> None:
    """Track file reads for required_reads enforcement."""
    spath = state_path(payload)
    state = load_state(spath)
    record_read(state, payload)
    save_state(spath, state)


def handle_pre_tool(payload: dict[str, Any]) -> None:
    """Enforce policy on Write/Edit/Bash before execution."""
    spath = state_path(payload)
    state = load_state(spath)
    root = Path(state.get("root") or repo_root())
    event = get_event(payload)
    tool = get_tool_name(payload)
    text = get_pending_text(payload)
    target = get_write_target(payload, root)

    has_skill_policies = bool(state.get("skills"))
    has_forbidden = bool(state.get("forbidden_use", {}).get("any_of"))

    if tool in {"Write", "Edit", "MultiEdit"}:
        # Skip non-code files for forbidden checks
        if target and not any(target.endswith(ext) for ext in (
            ".py", ".ts", ".tsx", ".js", ".jsx", ".sh", ".rs", ".go", ".c", ".cpp", ".java",
        )):
            return

        # Skip hook files (can't gate the gate)
        if target and ".claude/hooks/" in target:
            return

        # Required reads: only enforce when skill-specific policies are active
        if has_skill_policies and not any_required_read_satisfied(state):
            emit_deny(
                "Blocked: required skill/source files were not read before writing. "
                f"Read one of: {', '.join(state.get('required_reads', []))}",
                event,
            )

        # Forbidden patterns: always enforce (global + skill policies)
        if has_forbidden and text.strip():
            py = parse_python_signals(text) if target and target.endswith(".py") else None
            bad = check_forbidden_rules(
                state.get("forbidden_use", {}).get("any_of", []), text, py,
            )
            if bad:
                emit_deny(f"Blocked: {bad}", event)

        # Required use: only for skill policies with allow_parallel_impl=false
        if has_skill_policies:
            allow_parallel = state.get("required_use", {}).get("allow_parallel_impl", True)
            if not allow_parallel:
                py = parse_python_signals(text) if target and target.endswith(".py") else None
                if not check_required_rules(
                    state.get("required_use", {}).get("any_of", []), target, text, py,
                ):
                    emit_deny(
                        "Blocked: write does not use the required implementation path "
                        "and parallel bespoke implementation is disallowed.",
                        event,
                    )

    elif tool == "Bash":
        cmd = text.strip()

        # Bash mutation guard (replaces bash-mutation-guard.sh)
        mutation = check_bash_mutations(cmd)
        if mutation:
            emit_deny(mutation, event)

        # Skill-specific bash policy
        if has_skill_policies:
            bash_policy = state.get("bash_policy", {}) or {}
            if bash_policy.get("mode") == "whitelist":
                allowed = bash_policy.get("allowed_prefixes", [])
                if not any(cmd.startswith(prefix) for prefix in allowed):
                    emit_deny(
                        f"Blocked: bash command not in skill allowlist: {cmd[:80]}",
                        event,
                    )
            elif has_forbidden:
                bad = check_forbidden_rules(
                    state.get("forbidden_use", {}).get("any_of", []), cmd, None,
                )
                if bad:
                    emit_deny(f"Blocked: {bad}", event)


def handle_stop(payload: dict[str, Any]) -> None:
    """Final validation: check all touched files against policy."""
    spath = state_path(payload)
    state = load_state(spath)
    event = get_event(payload)

    if not state.get("skills") and not state.get("forbidden_use", {}).get("any_of"):
        return

    violations = final_validate(state)
    if violations:
        # Warn but don't block on Stop — blocking stop is too disruptive
        emit_warn(
            "\n=== POLICY VIOLATIONS IN FINAL WORKSPACE ===\n"
            + "\n".join(f"  - {v}" for v in violations)
            + "\n=== END VIOLATIONS ===\n"
        )


def main() -> None:
    payload = load_payload()
    event = get_event(payload)

    if yaml is None:
        # Fail open with warning — don't block the entire workflow
        emit_warn("WARNING: skill_policy hook requires PyYAML (pip install pyyaml). Policy enforcement disabled.")
        return

    if event == "UserPromptSubmit":
        handle_prompt_submit(payload)
    elif event == "PostToolUse" and get_tool_name(payload) == "Read":
        handle_post_read(payload)
    elif event == "PreToolUse":
        handle_pre_tool(payload)
    elif event in ("Stop", "SubagentStop"):
        handle_stop(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Fail open — never block the agent due to hook bugs
        print(f"skill_policy hook error (non-blocking): {e}", file=sys.stderr)
        sys.exit(0)
