"""review-plan: Validate task files before /orchestrate."""

import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import typer
from loguru import logger

app = typer.Typer(help="Validate task files before orchestration")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = PROJECT_ROOT / ".pi" / "skills-manifest.json"

# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class Finding:
    task: str
    check: str
    grade: str  # PASS, WARN, FAIL
    message: str
    line: int = 0
    suggestion: str = ""


@dataclass
class ReviewResult:
    file: str
    tasks: int = 0
    phases: int = 0
    findings: list[Finding] = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return sum(1 for f in self.findings if f.grade == "PASS")

    @property
    def warn_count(self) -> int:
        return sum(1 for f in self.findings if f.grade == "WARN")

    @property
    def fail_count(self) -> int:
        return sum(1 for f in self.findings if f.grade == "FAIL")


# ─── Parsers ─────────────────────────────────────────────────────────────────


def parse_task_file(content: str) -> list[dict]:
    """Extract tasks from a 0N_TASKS.md or plan file."""
    tasks = []
    current_task = None
    lines = content.split("\n")

    for i, line in enumerate(lines, 1):
        # Match task headers: ### Task N.N: Title or ## Task N: Title
        task_match = re.match(r"^#{2,3}\s+Task\s+(\d+(?:\.\d+)?):?\s*(.*)", line)
        if task_match:
            if current_task:
                tasks.append(current_task)
            current_task = {
                "id": task_match.group(1),
                "title": task_match.group(2).strip(),
                "line": i,
                "body": "",
                "dod": "",
                "gate": "",
            }
            continue

        # Match phase headers
        phase_match = re.match(r"^#{1,2}\s+Phase\s+(\d+(?:\.\d+)?)", line)
        if phase_match and current_task:
            tasks.append(current_task)
            current_task = None

        if current_task:
            current_task["body"] += line + "\n"

            # Extract Definition of Done
            if re.match(r"^[-*]\s+\*\*Definition of Done\*\*:", line, re.I):
                current_task["dod"] = line
            elif "definition of done" in line.lower() and ":" in line:
                current_task["dod"] = line

            # Extract Gate
            if re.match(r"^[-*]\s+\*\*Gate\*\*:", line, re.I):
                current_task["gate"] = line
            elif re.match(r"^[-*]\s+Gate:", line, re.I):
                current_task["gate"] = line

    if current_task:
        tasks.append(current_task)

    return tasks


def count_phases(content: str) -> int:
    return len(re.findall(r"^#{1,2}\s+Phase\s+\d+", content, re.MULTILINE))


# ─── Checkers ────────────────────────────────────────────────────────────────


def check_claims(task: dict, findings: list[Finding]):
    """Check 1: Verify file paths and references exist in the codebase."""
    body = task["body"]

    # Extract file paths from backticks and markdown
    file_refs = re.findall(r"`([^`]*(?:\.(?:py|ts|js|rs|go|sh|json|toml|yaml|yml|md))\b[^`]*)`", body)
    # Also catch paths in **bold** or plain text
    file_refs += re.findall(r"(?:^|\s)((?:\.?/)?(?:[\w.-]+/)+[\w.-]+\.(?:py|ts|js|rs|go|sh|json|toml|yaml|yml|md))\b", body)

    for ref in file_refs:
        # Clean up the reference
        ref = ref.strip().split(":")[0]  # Remove :line_number
        if ref.startswith("~"):
            continue  # Skip home-relative paths
        if ref.startswith("/") and not ref.startswith("/."):
            full_path = Path(ref)
        else:
            full_path = PROJECT_ROOT / ref

        if not full_path.exists() and not any(
            PROJECT_ROOT.glob(f"**/{Path(ref).name}")
        ):
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="claim",
                grade="WARN",
                message=f"Referenced path `{ref}` not found in codebase",
                line=task["line"],
                suggestion=f"Verify path exists or update reference",
            ))


def check_skill_overlap(task: dict, manifest: dict | None, findings: list[Finding]):
    """Check 2: Detect tasks that reinvent existing skills."""
    if not manifest:
        return

    body = task["body"].lower()
    title = task["title"].lower()

    # Keywords that suggest building something new
    build_signals = ["create", "build", "implement", "add", "write", "develop"]
    if not any(signal in title for signal in build_signals):
        return

    skills = manifest.get("skills", [])
    for skill in skills:
        name = skill.get("name", "")
        desc = (skill.get("description", "") or "").lower()

        # Check if task title/body overlaps significantly with an existing skill
        desc_words = set(desc.split()) - {"the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "is"}
        body_words = set(body.split()) - {"the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "is"}

        if len(desc_words) < 5:
            continue

        overlap = desc_words & body_words
        overlap_ratio = len(overlap) / len(desc_words) if desc_words else 0

        if overlap_ratio > 0.4:
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="overlap",
                grade="WARN",
                message=f"Possible overlap with existing skill `/{name}`: {skill.get('description', '')[:80]}",
                line=task["line"],
                suggestion=f"Consider using `/{name}` instead of building from scratch",
            ))


def check_dod(task: dict, findings: list[Finding]):
    """Check 4: Audit Definition of Done quality."""
    dod = task.get("dod", "")

    if not dod:
        # Skip explore/research tasks
        body_lower = task["body"].lower()
        if any(kw in body_lower for kw in ["research", "explore", "investigate", "read", "understand"]):
            return
        findings.append(Finding(
            task=f"Task {task['id']}",
            check="dod",
            grade="WARN",
            message="No Definition of Done found",
            line=task["line"],
            suggestion="Add: `- **Definition of Done**: <test command> exits 0`",
        ))
        return

    # Check for vague DoD
    vague_patterns = [
        r"\bworks?\b",
        r"\bcorrect(ly)?\b",
        r"\bverif(y|ied)\b(?!.*\btest\b)",
        r"\bconfirm\b(?!.*\b(exit|pass|run)\b)",
        r"\bcheck\b(?!.*\b(exit|pass|run)\b)",
    ]
    for pattern in vague_patterns:
        if re.search(pattern, dod, re.I) and not re.search(r"(pytest|test|exit\s+0|run\.sh|sanity)", dod, re.I):
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="dod",
                grade="WARN",
                message=f"Definition of Done may be vague: `{dod.strip()[:80]}`",
                line=task["line"],
                suggestion="Use concrete assertions: `<command> exits 0` or `test_file.py::test_name passes`",
            ))
            break


def check_gate(task: dict, findings: list[Finding]):
    """Check 3: Verify gate definitions exist."""
    gate = task.get("gate", "")
    if not gate:
        body_lower = task["body"].lower()
        if any(kw in body_lower for kw in ["research", "explore", "reference only"]):
            return
        # Only warn if task has implementation content
        if any(kw in body_lower for kw in ["implement", "create", "build", "fix", "port", "install"]):
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="gate",
                grade="WARN",
                message="No Gate field found for implementation task",
                line=task["line"],
                suggestion="Add: `- **Gate**: <what must be true before this task is complete>`",
            ))


def check_skill_chains(task: dict, findings: list[Finding]):
    """Check 5: Validate /skill-name references in task body."""
    body = task["body"]

    # Extract slash skill references
    skill_refs = re.findall(r"/([a-z][a-z0-9-]{1,63})(?:\s|$|[.,;:!?)])", body)

    if not skill_refs:
        return

    # Check each ref against known skills
    manifest = load_manifest()
    if not manifest:
        return

    known_skills = {s.get("name", "") for s in manifest.get("skills", [])}

    for ref in skill_refs:
        if ref not in known_skills:
            # Skip common non-skill patterns
            if ref in {"home", "tmp", "dev", "etc", "usr", "var", "mnt", "opt", "model"}:
                continue
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="chain",
                grade="WARN",
                message=f"Referenced skill `/{ref}` not found in manifest",
                line=task["line"],
                suggestion=f"Check skill name spelling or add to skills-manifest.json",
            ))


def check_sanity_scripts(task: dict, findings: list[Finding]):
    """Check: /plan requires sanity scripts for non-standard dependencies."""
    body = task["body"]

    # Look for dependency references that might need sanity scripts
    dep_patterns = [
        r"(?:install|add|require)\s+(\w[\w-]+)",  # install X, add X
        r"(?:import|from)\s+([\w.]+)",             # import X
    ]

    has_sanity_ref = bool(re.search(r"sanity", body, re.I))
    has_dependency_section = bool(re.search(r"(?:depend|sanity\s+script|crucial\s+depend)", body, re.I))

    # If task mentions non-trivial dependencies but no sanity reference
    non_std_deps = re.findall(r"(?:camelot|paddleocr|surya|demucs|transformers|opencv|torch|tensorflow)", body, re.I)
    if non_std_deps and not has_sanity_ref:
        findings.append(Finding(
            task=f"Task {task['id']}",
            check="sanity-script",
            grade="WARN",
            message=f"References non-standard deps ({', '.join(non_std_deps)}) but no sanity script mentioned",
            line=task["line"],
            suggestion="Add sanity script per /plan conventions: `sanity/<dep>.py` that verifies the API works in isolation",
        ))


def check_blockers_resolved(task: dict, findings: list[Finding]):
    """Check: /plan requires Questions/Blockers to be resolved before orchestration."""
    body = task["body"]

    # Look for unresolved blockers/questions
    blocker_patterns = [
        r"\?\s*$",                    # Questions ending with ?
        r"(?:BLOCKER|BLOCKED|TBD|TODO|FIXME|UNCLEAR)",
        r"(?:need(?:s)?\s+clarif)",   # "needs clarification"
        r"(?:ask\s+(?:the\s+)?human)",
    ]

    for pattern in blocker_patterns:
        matches = re.findall(pattern, body, re.I | re.M)
        if len(matches) > 2:  # Allow some inline questions
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="blockers",
                grade="WARN",
                message=f"Task contains unresolved blockers/questions ({len(matches)} matches)",
                line=task["line"],
                suggestion="Resolve all Questions/Blockers before /orchestrate per /plan conventions",
            ))
            break


def check_persona_routing(task: dict, findings: list[Finding]):
    """Check: /plan requires persona agent tasks to specify the persona."""
    body = task["body"]

    # Look for persona-related language without explicit agent assignment
    persona_signals = [
        r"\b(?:brandon|margaret|rob|embry|nico|jennifer|lisa)\b",
        r"\b(?:persona|agent\s+should|have\s+someone)\b",
    ]

    has_agent_field = bool(re.search(r"(?:Agent|Persona)\s*:\s*\S+", body, re.I))

    for pattern in persona_signals:
        if re.search(pattern, body, re.I) and not has_agent_field:
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="persona-routing",
                grade="WARN",
                message="References a persona but no `Agent: <persona-name>` field found",
                line=task["line"],
                suggestion="Add `Agent: <persona-name>` per /plan conventions for persona tasks",
            ))
            break


def check_adversarial_test(task: dict, findings: list[Finding]):
    """Check 7: MANDATORY blind adversarial test enforcement. No exceptions.

    Adversarial = the implementing agent CANNOT see the test source code.
    The agent sees ONLY pass/fail output. This prevents the agent from gaming
    or faking success. /test-lab and sanity.sh are the primary blind harnesses.
    """
    body = task["body"]
    body_lower = body.lower()
    dod = task.get("dod", "")

    # Skip pure research/explore/reference tasks
    title_lower = task["title"].lower()
    if any(kw in title_lower for kw in ["verify", "check", "validate", "test"]):
        return  # Already a testing task
    if all(kw not in title_lower and kw not in body_lower[:200]
           for kw in ["implement", "create", "build", "fix", "port", "install", "add", "write", "configure"]):
        return  # Not an implementation task

    combined = dod + "\n" + body

    # Tier 1: Blind test patterns (agent cannot see test source)
    blind_patterns = [
        r"test-lab",                          # /test-lab harness
        r"verify-task",                       # test-lab verify-task
        r"sanity\.sh",                        # pre-existing sanity harness
        r"skills[_-]ci",                      # skills-ci scan (external validator)
    ]

    # Tier 2: Acceptable test patterns (runnable, but agent may have visibility)
    runnable_patterns = [
        r"pytest\s+\S+",                      # pytest test_file.py
        r"uv run pytest\s+\S+",              # uv run pytest tests/
        r"npm test",                          # npm test
        r"npx vitest\s+\S+",                 # npx vitest
        r"cargo test\s+\S+",                 # cargo test
        r"run\.sh\s+\S+.*(?:exits?\s+0)",    # run.sh command exits 0
        r"test_\w+\.py",                      # test file reference
        r"\.test\.(ts|js)",                   # JS/TS test file
        r"exits?\s+0",                        # explicit exit code check
        r"grep\s+-q\b",                       # quiet grep (returns exit code)
    ]

    has_blind = any(re.search(p, combined, re.I) for p in blind_patterns)
    has_runnable = any(re.search(p, combined, re.I) for p in runnable_patterns)

    if not has_blind and not has_runnable:
        findings.append(Finding(
            task=f"Task {task['id']}",
            check="adversarial-test",
            grade="FAIL",
            message="Implementation task has no adversarial test. Agent must not see test source — only pass/fail output.",
            line=task["line"],
            suggestion=(
                "Add blind test: `test-lab/run.sh verify-task <id> <target>` or `sanity.sh` exits 0. "
                "The implementing agent must NEVER see the test code. "
                "If using pytest, the test must be pre-existing or generated by /test-lab, not written by the same agent."
            ),
        ))
        return

    if has_runnable and not has_blind:
        # Has a test but it's not explicitly blind
        findings.append(Finding(
            task=f"Task {task['id']}",
            check="adversarial-test",
            grade="WARN",
            message="Has runnable test but no blind harness (test-lab/sanity.sh). Agent may be able to see and game the test.",
            line=task["line"],
            suggestion=(
                "Prefer blind testing via `/test-lab verify-task` or pre-existing `sanity.sh`. "
                "If the agent writes both code AND test, it can optimize for passing rather than correctness."
            ),
        ))

def check_tool_names(task: dict, findings: list[Finding]):
    """Check 6: Audit tool name references for Pi compatibility."""
    body = task["body"]

    # Claude Code tool names that differ in Pi
    tool_renames = {
        "Glob": "find",
        "Task": "subagent (via pi-subagents)",
        "WebSearch": "/dogpile",
        "WebFetch": "/fetcher or /dogpile",
        "AskUserQuestion": "/interview",
        "EnterPlanMode": "/plan command",
    }

    for cc_name, pi_name in tool_renames.items():
        # Look for capitalized tool name references (Claude Code style)
        if re.search(rf"\b{cc_name}\b", body):
            findings.append(Finding(
                task=f"Task {task['id']}",
                check="tool-name",
                grade="WARN",
                message=f"References Claude Code tool `{cc_name}` — Pi equivalent is `{pi_name}`",
                line=task["line"],
                suggestion=f"Update to Pi tool name: `{pi_name}`",
            ))


# ─── Manifest Loader ─────────────────────────────────────────────────────────


_manifest_cache: dict | None = None


def load_manifest() -> dict | None:
    global _manifest_cache
    if _manifest_cache is not None:
        return _manifest_cache
    if MANIFEST_PATH.exists():
        try:
            _manifest_cache = json.loads(MANIFEST_PATH.read_text())
            return _manifest_cache
        except Exception:
            pass
    return None


# ─── Commands ────────────────────────────────────────────────────────────────


@app.command()
def review(
    task_file: str = typer.Argument(..., help="Path to task file (0N_TASKS.md or plan)"),
    output_json: bool = typer.Option(False, "--json", help="Output as JSON"),
    suggest_fixes: bool = typer.Option(False, "--suggest-fixes", help="Include fix suggestions"),
):
    """Full review of a task file: claims, overlap, ordering, DoD, chains, tools."""
    path = Path(task_file)
    if not path.exists():
        # Try relative to project root
        path = PROJECT_ROOT / task_file
    if not path.exists():
        logger.error(f"Task file not found: {task_file}")
        raise typer.Exit(1)

    content = path.read_text()
    tasks = parse_task_file(content)
    phases = count_phases(content)
    manifest = load_manifest()

    result = ReviewResult(file=str(path), tasks=len(tasks), phases=phases)

    for task in tasks:
        check_claims(task, result.findings)
        check_skill_overlap(task, manifest, result.findings)
        check_dod(task, result.findings)
        check_gate(task, result.findings)
        check_adversarial_test(task, result.findings)
        check_skill_chains(task, result.findings)
        check_tool_names(task, result.findings)
        check_sanity_scripts(task, result.findings)
        check_blockers_resolved(task, result.findings)
        check_persona_routing(task, result.findings)

    if output_json:
        output = {
            "file": result.file,
            "tasks": result.tasks,
            "phases": result.phases,
            "pass": result.pass_count,
            "warn": result.warn_count,
            "fail": result.fail_count,
            "findings": [
                {
                    "task": f.task,
                    "check": f.check,
                    "grade": f.grade,
                    "message": f.message,
                    "line": f.line,
                    **({"suggestion": f.suggestion} if suggest_fixes and f.suggestion else {}),
                }
                for f in result.findings
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        print(f"# Review: {path.name}\n")
        print(f"## Summary")
        print(f"- Tasks: {result.tasks}")
        print(f"- Phases: {result.phases}")
        print(f"- WARN: {result.warn_count} | FAIL: {result.fail_count}\n")

        if result.fail_count > 0:
            print("## FAIL\n")
            for f in result.findings:
                if f.grade == "FAIL":
                    print(f"### {f.task} (line {f.line})")
                    print(f"- **{f.check}**: {f.message}")
                    if suggest_fixes and f.suggestion:
                        print(f"- **Fix**: {f.suggestion}")
                    print()

        if result.warn_count > 0:
            print("## WARN\n")
            for f in result.findings:
                if f.grade == "WARN":
                    print(f"### {f.task} (line {f.line})")
                    print(f"- **{f.check}**: {f.message}")
                    if suggest_fixes and f.suggestion:
                        print(f"- **Suggest**: {f.suggestion}")
                    print()

        if result.warn_count == 0 and result.fail_count == 0:
            print("All checks passed.")

    raise typer.Exit(1 if result.fail_count > 0 else 0)


@app.command()
def check(
    task_file: str = typer.Argument(..., help="Path to task file"),
    output_json: bool = typer.Option(False, "--json", help="Output as JSON"),
):
    """Quick check: claims + DoD only (skip chain validation)."""
    path = Path(task_file)
    if not path.exists():
        path = PROJECT_ROOT / task_file
    if not path.exists():
        logger.error(f"Task file not found: {task_file}")
        raise typer.Exit(1)

    content = path.read_text()
    tasks = parse_task_file(content)

    result = ReviewResult(file=str(path), tasks=len(tasks), phases=count_phases(content))

    for task in tasks:
        check_claims(task, result.findings)
        check_dod(task, result.findings)

    if output_json:
        output = {
            "file": result.file,
            "tasks": result.tasks,
            "warn": result.warn_count,
            "fail": result.fail_count,
            "findings": [
                {"task": f.task, "check": f.check, "grade": f.grade, "message": f.message}
                for f in result.findings
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        print(f"Quick check: {path.name} — {result.tasks} tasks, {result.warn_count} WARN, {result.fail_count} FAIL")
        for f in result.findings:
            print(f"  [{f.grade}] {f.task}: {f.message}")

    raise typer.Exit(1 if result.fail_count > 0 else 0)


if __name__ == "__main__":
    app()
