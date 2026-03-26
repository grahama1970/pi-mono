#!/usr/bin/env python3
"""
Persona Review Orchestrator — simple sequential loop.

One agent per persona. One task at a time. One commit per fix.
The orchestrator (this script) owns sequencing, git safety, and reporting.
The agent gets a 5-line prompt with one specific thing to fix.

Usage:
  python server/persona-orchestrator.py                    # all personas, all groups
  python server/persona-orchestrator.py --persona tim      # just Tim
  python server/persona-orchestrator.py --group code-view  # just code-view group
  python server/persona-orchestrator.py --parallel         # 3 personas concurrently
"""

import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import httpx

# ── Config ───────────────────────────────────────────────────────────────────

SUBAGENT_URL = "http://localhost:8620/chat/stream"
WORKSPACE = "/home/node/workspace/packages/ux-lab"  # container path
HOST_WORKSPACE = Path(__file__).resolve().parent.parent
REPORT_PATH = HOST_WORKSPACE / "persona-review-report.md"
RESULTS_DIR = HOST_WORKSPACE / "convergence-reports"
RESULTS_DIR.mkdir(exist_ok=True)

MANIFESTS = {
    "tim-blazytko": "tim-blazytko-review.test.json",
    "gynvael-coldwind": "gynvael-coldwind-review.test.json",
    "liveoverflow": "liveoverflow-review.test.json",
}

GROUP_FILES = {
    "first-impressions": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "graph-navigation": "src/components/binary-explorer/BinaryGraph.tsx",
    "graph-exploration": "src/components/binary-explorer/BinaryGraph.tsx",
    "graph-interaction": "src/components/binary-explorer/BinaryGraph.tsx",
    "code-view": "src/components/binary-explorer/CodePane.tsx",
    "node-detail": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "chat-analysis": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "chat-exploration": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "table-view": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "symbol-tree": "src/components/binary-explorer/SymbolTree.tsx",
    "progressive-disclosure": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "search-and-filter": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "vulnerability-hunting": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "visual-design": "src/components/common/EmbryStyle.ts",
    "perspective-views": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "scene-management": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "investigation-journal": "src/components/common/InvestigationJournal.tsx",
    "taxonomy-integration": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "automation": "server/index.ts",
    "data-structures": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "cross-references": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "state-machines": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "performance": "src/components/binary-explorer/BinaryGraph.tsx",
    "context-menu": "src/components/common/ContextMenu.tsx",
    "ctf-workflow": "src/components/common/InvestigationJournal.tsx",
    "learning-path": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "accessibility": "src/components/binary-explorer/BinaryExplorerView.tsx",
    "error-states": "src/components/binary-explorer/BinaryExplorerView.tsx",
}


# ── Types ────────────────────────────────────────────────────────────────────

@dataclass
class Task:
    group: str
    criterion: str
    source_file: str
    status: str = "pending"  # pending, running, done, failed
    score: int = 0
    commit: str = ""
    error: str = ""
    duration_s: float = 0


@dataclass
class PersonaRun:
    persona: str
    model: str = "sonnet"
    tasks: list[Task] = field(default_factory=list)
    start_time: float = 0
    end_time: float = 0


# ── Load manifest tasks ─────────────────────────────────────────────────────

def load_tasks(persona: str, group_filter: Optional[str] = None) -> list[Task]:
    manifest_file = HOST_WORKSPACE / MANIFESTS[persona]
    manifest = json.loads(manifest_file.read_text())
    tasks: list[Task] = []
    seen_groups: set[str] = set()

    for test in manifest["tests"]:
        group = test.get("group", "unknown")
        if group_filter and group != group_filter:
            continue
        # One task per group (aggregated criteria)
        if group in seen_groups:
            continue
        seen_groups.add(group)

        criteria = []
        for step in test.get("steps", []):
            if step.get("action") == "persona_review" and step.get("review_criteria"):
                criteria.append(step["review_criteria"])

        if criteria:
            source = GROUP_FILES.get(group, "src/components/binary-explorer/BinaryExplorerView.tsx")
            tasks.append(Task(
                group=group,
                criterion=criteria[0],  # first criterion for this group
                source_file=source,
            ))

    return tasks


# ── Run one subagent call via SSE ────────────────────────────────────────────

async def run_subagent(prompt: str, max_turns: int = 15) -> tuple[str, list[str], float]:
    """Returns (accumulated_text, tool_calls, duration_ms)."""
    result_text = ""
    all_text = ""
    tools: list[str] = []
    duration_ms = 0

    payload = {
        "model": "sonnet",
        "prompt": prompt,
        "workspace": WORKSPACE,
        "max_turns": max_turns,
        "idle_timeout": 300,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(400, connect=10)) as client:
        async with client.stream("POST", SUBAGENT_URL, json=payload) as resp:
            current_event = ""
            async for line in resp.aiter_lines():
                line = line.strip()
                if line.startswith("event: "):
                    current_event = line[7:]
                elif line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if current_event == "assistant":
                            content = data.get("message", {}).get("content", [])
                            if isinstance(content, list):
                                for c in content:
                                    if c.get("type") == "tool_use":
                                        tools.append(c["name"])
                                        print(f"      [tool] {c['name']}", flush=True)
                                    elif c.get("type") == "text":
                                        all_text += c.get("text", "") + "\n"
                        elif current_event == "result":
                            result_text = data.get("result", "")
                        elif current_event == "done":
                            duration_ms = data.get("duration_ms", 0)
                    except json.JSONDecodeError:
                        pass

    return result_text or all_text, tools, duration_ms


# ── Store task result to /memory ──────────────────────────────────────────────

async def store_to_memory(persona: str, task: Task) -> None:
    """Store each task result to ArangoDB via memory daemon Unix socket."""
    import socket as sock
    try:
        problem = f"PERSONA_FIX:{persona}:{task.group} — {task.status}"
        solution = json.dumps(asdict(task))
        tags = ["persona-fix", "binary-explorer", persona, task.group]
        body = json.dumps({"problem": problem, "solution": solution, "tags": tags, "scope": "binary-explorer-reviews"})

        s = sock.socket(sock.AF_UNIX, sock.SOCK_STREAM)
        s.connect("/run/user/1000/embry/memory.sock")
        req = f"POST /learn HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}"
        s.sendall(req.encode())
        s.recv(4096)
        s.close()
    except Exception:
        pass  # non-fatal


# ── Run one persona through its task list ────────────────────────────────────

async def run_persona(persona: str, tasks: list[Task]) -> PersonaRun:
    run = PersonaRun(persona=persona, tasks=tasks, start_time=time.time())
    agent_md_path = HOST_WORKSPACE.parent.parent / ".pi" / "agents" / persona / "AGENTS.md"
    agent_profile = agent_md_path.read_text()[:1000] if agent_md_path.exists() else ""

    print(f"\n{'='*60}")
    print(f"  {persona} — {len(tasks)} tasks")
    print(f"{'='*60}")

    for i, task in enumerate(tasks):
        task.status = "running"
        print(f"\n  [{i+1}/{len(tasks)}] {task.group}: {task.criterion[:60]}...")
        start = time.time()

        prompt = f"""Fix this in {task.source_file}:
{task.criterion}

1. Edit the file
2. npx tsc --noEmit 2>&1 | head -5
3. git add -A && git commit -m "persona/{persona}: fix {task.group}"

Do NOT read more than 2 files. Edit immediately."""

        # Record git HEAD before the subagent runs
        import subprocess as sp
        repo_root = str(HOST_WORKSPACE.parent.parent)
        head_before = sp.run(["git", "rev-parse", "HEAD"], cwd=repo_root, capture_output=True, text=True).stdout.strip()

        try:
            text, tools, dur_ms = await run_subagent(prompt, max_turns=50)
            task.duration_s = time.time() - start

            # Detect success from git — if a new commit landed with the task group name, it worked
            git_log = sp.run(
                ["git", "log", "--oneline", f"{head_before}..HEAD", "--grep", f"persona/{persona}"],
                cwd=repo_root, capture_output=True, text=True
            ).stdout.strip()

            if git_log:
                task.status = "done"
                task.commit = git_log.split()[0]
            else:
                # Fallback: try JSON parsing
                json_match = re.search(r'\{[^{}]*"task"[^{}]*\}', text)
                if json_match:
                    result = json.loads(json_match.group())
                    task.status = result.get("status", "failed")
                    task.commit = result.get("commit", "")
                    task.error = result.get("error", "")
                else:
                    task.status = "failed"
                    task.error = f"No commit, no JSON ({len(tools)} tools: {[t for t in tools if t in ('Edit','Write','Bash')]})"

            edit_count = sum(1 for t in tools if t in ("Edit", "Write"))
            print(f"    → {task.status} ({task.duration_s:.0f}s, {edit_count} edits, {len(tools)} tools)")
            if task.commit:
                print(f"    → commit: {task.commit}")
            if task.error:
                print(f"    → error: {task.error[:100]}")

            # Store to /memory
            await store_to_memory(persona, task)

        except Exception as e:
            task.status = "failed"
            task.error = str(e)[:200]
            task.duration_s = time.time() - start
            print(f"    → EXCEPTION: {e}")
            await store_to_memory(persona, task)

    run.end_time = time.time()
    return run


# ── Report ───────────────────────────────────────────────────────────────────

def write_report(runs: list[PersonaRun]) -> None:
    lines = ["# Binary Explorer Persona Review Report\n"]
    lines.append("One row per persona × group. Generated by persona-orchestrator.py.\n")
    lines.append("| Persona | Group | Source | Status | Duration | Commit | Error |")
    lines.append("|---------|-------|--------|--------|----------|--------|-------|")

    for run in runs:
        for task in run.tasks:
            lines.append(
                f"| {run.persona} | {task.group} | {task.source_file.split('/')[-1]} "
                f"| {task.status} | {task.duration_s:.0f}s "
                f"| {task.commit[:8] if task.commit else '—'} "
                f"| {task.error[:40] if task.error else '—'} |"
            )

    done = sum(1 for r in runs for t in r.tasks if t.status == "done")
    total = sum(len(r.tasks) for r in runs)
    lines.append(f"\n**{done}/{total} tasks completed**")

    REPORT_PATH.write_text("\n".join(lines))
    print(f"\nReport: {REPORT_PATH}")

    # Also save JSON
    results_file = RESULTS_DIR / f"run-{int(time.time())}.json"
    results_file.write_text(json.dumps([asdict(r) for r in runs], indent=2))
    print(f"Results: {results_file}")


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--persona", help="Run only this persona (tim, gynvael, liveoverflow)")
    parser.add_argument("--group", help="Run only this feature group")
    parser.add_argument("--parallel", action="store_true", help="Run 3 personas concurrently")
    args = parser.parse_args()

    # Resolve persona names
    persona_map = {
        "tim": "tim-blazytko",
        "gynvael": "gynvael-coldwind",
        "liveoverflow": "liveoverflow",
    }

    if args.persona:
        personas = [persona_map.get(args.persona, args.persona)]
    else:
        personas = list(MANIFESTS.keys())

    # Load tasks
    persona_tasks: dict[str, list[Task]] = {}
    for p in personas:
        tasks = load_tasks(p, group_filter=args.group)
        if tasks:
            persona_tasks[p] = tasks
            print(f"{p}: {len(tasks)} tasks")

    if not persona_tasks:
        print("No tasks to run.")
        return

    # Check subagent health
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get("http://localhost:8620/health")
            health = r.json()
            print(f"Subagent: {health['status']} ({health['backends']})")
    except Exception as e:
        print(f"ERROR: Subagent not available: {e}")
        return

    print(f"\nTotal: {sum(len(t) for t in persona_tasks.values())} tasks across {len(persona_tasks)} personas")
    print(f"Mode: {'parallel' if args.parallel else 'sequential'}\n")

    # Run
    if args.parallel and len(persona_tasks) > 1:
        runs = await asyncio.gather(
            *[run_persona(p, tasks) for p, tasks in persona_tasks.items()]
        )
    else:
        runs = []
        for p, tasks in persona_tasks.items():
            run = await run_persona(p, tasks)
            runs.append(run)

    # Report
    write_report(list(runs))

    # Summary
    done = sum(1 for r in runs for t in r.tasks if t.status == "done")
    total = sum(len(r.tasks) for r in runs)
    elapsed = max(r.end_time for r in runs) - min(r.start_time for r in runs)
    print(f"\n{'='*60}")
    print(f"  DONE: {done}/{total} tasks in {elapsed:.0f}s")
    print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
