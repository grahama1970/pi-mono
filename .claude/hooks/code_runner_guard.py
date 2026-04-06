#!/usr/bin/env python3
"""code-runner guard hook.

Enforces three rules:
1. PreToolUse(Bash): Block code-runner run.sh unless SKILL.md and spec were Read first
2. PreToolUse(Write/Edit): Block edits to protected files (hooks, SKILL.md, settings)
3. Stop: Block stop if code-runner result is missing or dod_passed=false
"""
from __future__ import annotations

import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any, Iterable

PROTECTED_BASENAMES = {
    ".env",
    ".gitignore",
    "SKILL.md",
    "run.sh",
    "sanity.sh",
}

PROTECTED_PATH_FRAGMENTS = (
    "/.git/",
    "/.claude/hooks/",
    "/.claude/settings.json",
    "/.claude/settings.local.json",
)


def load_payload() -> dict[str, Any]:
    return json.load(sys.stdin)


def emit_pretool_deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


def emit_stop_block(reason: str) -> None:
    print(json.dumps({
        "decision": "block",
        "reason": reason,
    }))


def norm(path: str | None, cwd: str) -> str | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute():
        p = Path(cwd) / p
    try:
        return str(p.resolve())
    except Exception:
        return str(p)


def walk(obj: Any) -> Iterable[dict[str, Any]]:
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item)


def iter_tool_calls(transcript_path: str) -> Iterable[dict[str, Any]]:
    p = Path(os.path.expanduser(transcript_path))
    if not p.exists():
        return
    with p.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except Exception:
                continue
            for node in walk(record):
                if isinstance(node, dict) and isinstance(node.get("tool_input"), dict) and node.get("tool_name"):
                    yield node


def parse_code_runner_invocation(command: str, cwd: str) -> tuple[str, str, str] | None:
    try:
        tokens = shlex.split(command)
    except Exception:
        return None

    for i, tok in enumerate(tokens):
        if tok.endswith("run.sh") and i + 2 < len(tokens) and tokens[i + 1] == "run":
            run_sh = norm(tok, cwd)
            spec = norm(tokens[i + 2], cwd)
            if not run_sh or not spec:
                return None
            skill_md = str(Path(run_sh).with_name("SKILL.md"))
            return run_sh, skill_md, spec

    return None


def transcript_has_read(transcript_path: str, target_path: str, cwd: str) -> bool:
    wanted = norm(target_path, cwd)
    if not wanted:
        return False

    for call in iter_tool_calls(transcript_path):
        if call.get("tool_name") != "Read":
            continue
        ti = call.get("tool_input", {})
        seen = ti.get("file_path") or ti.get("path")
        seen = norm(seen, cwd)
        if seen == wanted:
            return True
    return False


def find_latest_code_runner_spec(transcript_paths: list[str], cwd: str) -> tuple[str, str, str] | None:
    for transcript_path in transcript_paths:
        if not transcript_path:
            continue
        calls = list(iter_tool_calls(transcript_path))
        for call in reversed(calls):
            if call.get("tool_name") != "Bash":
                continue
            cmd = (call.get("tool_input") or {}).get("command", "")
            parsed = parse_code_runner_invocation(cmd, cwd)
            if parsed:
                return parsed
    return None


def load_result_for_spec(spec_path: str) -> tuple[str, dict[str, Any] | None]:
    spec_file = Path(spec_path)
    if not spec_file.exists():
        return "", None

    try:
        spec = json.loads(spec_file.read_text(encoding="utf-8"))
    except Exception:
        return "", None
    task_id = spec.get("task_id")
    output_dir = spec.get("output_dir")
    if not task_id or not output_dir:
        return "", None

    output_dir_path = Path(output_dir)
    if not output_dir_path.is_absolute():
        output_dir_path = (spec_file.parent / output_dir_path).resolve()

    result_path = output_dir_path / f"{task_id}.result.json"
    if not result_path.exists():
        return str(result_path), None

    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception:
        return str(result_path), None

    return str(result_path), result


def is_protected_path(file_path: str, cwd: str) -> bool:
    full = norm(file_path, cwd)
    if not full:
        return False

    p = Path(full)
    if p.name in PROTECTED_BASENAMES:
        return True

    full_norm = full.replace("\\", "/")
    if any(fragment in full_norm for fragment in PROTECTED_PATH_FRAGMENTS):
        return True

    if ".git" in p.parts:
        return True

    return False


def handle_pre_bash(payload: dict[str, Any]) -> int:
    cwd = payload["cwd"]
    command = (payload.get("tool_input") or {}).get("command", "")
    parsed = parse_code_runner_invocation(command, cwd)
    if not parsed:
        return 0

    _, skill_md, spec_path = parsed
    transcript_path = payload.get("transcript_path", "")
    missing: list[str] = []

    if not Path(spec_path).exists():
        emit_pretool_deny(
            f"Blocked: code-runner spec file does not exist: {spec_path}. "
            "Create it first, then Read it, then run code-runner."
        )
        return 0

    if not transcript_has_read(transcript_path, skill_md, cwd):
        missing.append(skill_md)

    if not transcript_has_read(transcript_path, spec_path, cwd):
        missing.append(spec_path)

    if missing:
        emit_pretool_deny(
            "Blocked: before running code-runner, use the Read tool on:\n- "
            + "\n- ".join(missing)
        )
    return 0


def handle_pre_write(payload: dict[str, Any]) -> int:
    cwd = payload["cwd"]
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        return 0

    if is_protected_path(file_path, cwd):
        emit_pretool_deny(f"Blocked: protected path cannot be modified: {norm(file_path, cwd)}")
    return 0


def handle_stop(payload: dict[str, Any]) -> int:
    if payload.get("stop_hook_active"):
        return 0

    cwd = payload["cwd"]
    transcript_paths = []

    agent_transcript = payload.get("agent_transcript_path")
    if agent_transcript:
        transcript_paths.append(agent_transcript)

    main_transcript = payload.get("transcript_path")
    if main_transcript:
        transcript_paths.append(main_transcript)

    parsed = find_latest_code_runner_spec(transcript_paths, cwd)
    if not parsed:
        return 0

    _, _, spec_path = parsed
    result_path, result = load_result_for_spec(spec_path)

    if not result_path:
        emit_stop_block(
            f"This looks like a code-runner task, but the spec could not be parsed: {spec_path}. "
            "Inspect the spec and the run output before stopping."
        )
        return 0

    if result is None:
        emit_stop_block(
            f"Do not stop yet. code-runner result file is missing or unreadable: {result_path}. "
            "Inspect the run output and either continue working or explicitly explain the failure."
        )
        return 0

    if result.get("dod_passed") is not True:
        emit_stop_block(
            f"Do not stop yet. code-runner says dod_passed=false in {result_path}. "
            "Continue working, or explicitly tell the user the DoD failed and summarize the blocking error."
        )
        return 0

    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: code_runner_guard.py [pre-bash|pre-write|stop]", file=sys.stderr)
        return 1

    mode = sys.argv[1]
    payload = load_payload()

    if mode == "pre-bash":
        return handle_pre_bash(payload)
    if mode == "pre-write":
        return handle_pre_write(payload)
    if mode == "stop":
        return handle_stop(payload)

    print(f"unknown mode: {mode}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
