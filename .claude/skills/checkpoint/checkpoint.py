"""Session checkpoint storage and recall via /memory.

Captures conversation state (topic, files, decisions, next steps, git context)
and stores it as a lesson in ArangoDB. Enables agents to pick up where they
left off across sessions.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import typer
from loguru import logger
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MEMORY_PROJECT = "/home/graham/workspace/experiments/memory"
CHECKPOINT_PREFIX = "CHECKPOINT:"
DEFAULT_TAGS = ["checkpoint", "session-state"]

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

console = Console(stderr=True)
app = typer.Typer(
    name="checkpoint",
    help="Save and recall session checkpoints in /memory.",
    no_args_is_help=True,
)

logger.remove()
logger.add(sys.stderr, level=os.environ.get("LOG_LEVEL", "WARNING"))


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------


def _git(args: list[str], cwd: str | None = None) -> str:
    """Run a git command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=cwd,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _detect_project_root() -> str:
    """Auto-detect the git project root from CWD."""
    root = _git(["rev-parse", "--show-toplevel"])
    return root or os.getcwd()


def _detect_scope(project_root: str) -> str:
    """Derive a scope name from the git remote or directory name."""
    remote = _git(["remote", "get-url", "origin"], cwd=project_root)
    if remote:
        # Extract repo name from remote URL
        name = remote.rstrip("/").rsplit("/", 1)[-1]
        if name.endswith(".git"):
            name = name[:-4]
        return name
    return Path(project_root).name


def _default_workspace_scope() -> str:
    """Default scope for recall/list/last: invoking workspace directory name."""
    root = _detect_project_root()
    return Path(root).name or _detect_scope(root)


def _git_context(project_root: str) -> dict:
    """Gather current git state for checkpoint context."""
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=project_root)
    commit = _git(["rev-parse", "--short", "HEAD"], cwd=project_root)
    commit_msg = _git(["log", "-1", "--format=%s"], cwd=project_root)

    # Recent commits (last 5)
    recent_log = _git(
        ["log", "--oneline", "-5", "--no-decorate"],
        cwd=project_root,
    )
    recent_commits = recent_log.splitlines() if recent_log else []

    # Modified files (staged + unstaged, no untracked)
    diff_files = _git(["diff", "--name-only", "HEAD"], cwd=project_root)
    modified = diff_files.splitlines() if diff_files else []

    return {
        "branch": branch,
        "commit": commit,
        "commit_message": commit_msg,
        "recent_commits": recent_commits,
        "modified_files": modified[:20],  # cap at 20
    }


# ---------------------------------------------------------------------------
# Temporal queries (client-side sort of recall results)
# ---------------------------------------------------------------------------


def _query_checkpoints_by_time(
    limit: int = 1,
    scope: str = "",
) -> list[dict]:
    """Query checkpoints sorted by updated_at DESC via memory-agent recall.

    Uses --sort and --prefix flags for temporal ordering and prefix filtering.
    All AQL stays inside /memory where it belongs.
    """
    args = [
        "--q", CHECKPOINT_PREFIX,
        "--k", str(limit),
        "--tags", "checkpoint",
        "--sort", "created_at",
        "--prefix", CHECKPOINT_PREFIX,
        "--collections", "lessons",
    ]
    if scope:
        args.extend(["--scope", scope])

    result = _memory_agent("recall", args)
    return result.get("items", [])


# ---------------------------------------------------------------------------
# memory-agent interface
# ---------------------------------------------------------------------------


def _memory_agent(
    command: str,
    args: list[str],
) -> dict:
    """Shell out to memory-agent CLI and return parsed JSON."""
    # memory-agent CLI outputs JSON by default — no --json flag exists
    cmd = [
        sys.executable, "-m", "graph_memory.agent_cli",
        command,
    ] + args

    env = os.environ.copy()
    env["PYTHONPATH"] = os.path.join(MEMORY_PROJECT, "src")
    env.setdefault("ARANGO_DB", "memory")

    logger.debug("Running: {}", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=MEMORY_PROJECT,
            env=env,
        )
    except subprocess.TimeoutExpired:
        console.print("[red]memory-agent timed out after 30s[/red]")
        raise typer.Exit(1)

    if result.returncode != 0:
        stderr = result.stderr.strip()
        console.print(f"[red]memory-agent {command} failed:[/red] {stderr}")
        logger.error("stdout: {}", result.stdout)
        raise typer.Exit(1)

    # Parse JSON from stdout -- may have log lines before the JSON
    stdout = result.stdout.strip()
    if not stdout:
        return {}

    # Find the first { or [ to skip any log preamble
    for i, ch in enumerate(stdout):
        if ch in ("{", "["):
            try:
                return json.loads(stdout[i:])
            except json.JSONDecodeError:
                pass

    # Fallback: try parsing the whole thing
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        logger.warning("Could not parse memory-agent output as JSON")
        return {"raw": stdout}


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


@app.command()
def save(
    topic: str = typer.Option(..., "--topic", "-t", help="Current conversation topic"),
    summary: str = typer.Option(..., "--summary", "-s", help="Brief summary of where we left off"),
    files: Optional[list[str]] = typer.Option(None, "--files", "-f", help="Key file paths (repeatable)"),
    decisions: Optional[list[str]] = typer.Option(None, "--decisions", help="Key decisions made (repeatable)"),
    next_steps: Optional[list[str]] = typer.Option(None, "--next-steps", help="What should happen next (repeatable)"),
    project_root: Optional[str] = typer.Option(None, "--project-root", help="Project root (auto-detected from git)"),
    scope: Optional[str] = typer.Option(None, "--scope", help="Memory scope (default: project name)"),
    output_json: bool = typer.Option(False, "--json", is_flag=True, help="Output as JSON"),
) -> None:
    """Save a session checkpoint to /memory."""
    # Resolve project root and scope
    root = project_root or _detect_project_root()
    scope_val = scope or _detect_scope(root)

    # Gather git context
    git_ctx = _git_context(root)

    # Build the structured solution document
    timestamp = datetime.now(timezone.utc).isoformat()
    solution_doc = {
        "checkpoint_version": 1,
        "timestamp": timestamp,
        "topic": topic,
        "summary": summary,
        "files": files or [],
        "decisions": decisions or [],
        "next_steps": next_steps or [],
        "git": git_ctx,
        "project_root": root,
    }

    # problem = titled summary for search
    problem_text = f"{CHECKPOINT_PREFIX} {topic}\n\n{summary}"

    # solution = structured JSON
    solution_text = json.dumps(solution_doc, indent=2)

    # Store via memory-agent learn
    result = _memory_agent("learn", [
        "--problem", problem_text,
        "--solution", solution_text,
        "--scope", scope_val,
        "--tag", "checkpoint",
        "--tag", "session-state",
    ])

    if output_json:
        output = {
            "status": "saved",
            "topic": topic,
            "scope": scope_val,
            "timestamp": timestamp,
            "memory_result": result,
        }
        console.print(json.dumps(output, indent=2))
        return

    # Rich display
    console.print()
    console.print(Panel(
        f"[bold green]Checkpoint saved[/bold green]\n\n"
        f"[bold]Topic:[/bold] {topic}\n"
        f"[bold]Scope:[/bold] {scope_val}\n"
        f"[bold]Branch:[/bold] {git_ctx.get('branch', 'unknown')}\n"
        f"[bold]Commit:[/bold] {git_ctx.get('commit', 'unknown')} - {git_ctx.get('commit_message', '')}\n"
        f"[bold]Time:[/bold] {timestamp}\n"
        f"[bold]Files:[/bold] {len(files or [])}\n"
        f"[bold]Decisions:[/bold] {len(decisions or [])}\n"
        f"[bold]Next steps:[/bold] {len(next_steps or [])}",
        title="CHECKPOINT",
        border_style="green",
    ))


@app.command()
def recall(
    topic: Optional[str] = typer.Option(None, "--topic", "-t", help="Topic to search for"),
    scope: Optional[str] = typer.Option(None, "--scope", help="Memory scope filter (default: current workspace)"),
    limit: int = typer.Option(3, "--limit", "-k", help="Max results"),
    output_json: bool = typer.Option(False, "--json", is_flag=True, help="Output as JSON"),
) -> None:
    """Recall checkpoints matching a topic from /memory."""
    query = f"{CHECKPOINT_PREFIX} {topic}" if topic else CHECKPOINT_PREFIX
    scope_val = scope or _default_workspace_scope()

    args = [
        "--q", query,
        "--scope", scope_val,
        "--k", str(limit),
        "--tags", "checkpoint",
        "--prefix", CHECKPOINT_PREFIX,
        "--collections", "lessons",
    ]

    result = _memory_agent("recall", args)

    items = result.get("items", [])
    checkpoints = _parse_checkpoint_items(items)

    if output_json:
        console.print(json.dumps(checkpoints, indent=2))
        return

    if not checkpoints:
        console.print("[yellow]No checkpoints found.[/yellow]")
        if topic:
            console.print(f"[dim]Searched for: {query}[/dim]")
        return

    for i, cp in enumerate(checkpoints):
        _render_checkpoint(cp, index=i + 1)


@app.command()
def last(
    scope: Optional[str] = typer.Option(None, "--scope", help="Memory scope filter (default: current workspace)"),
    output_json: bool = typer.Option(False, "--json", is_flag=True, help="Output as JSON"),
) -> None:
    """Recall the most recent checkpoint by time. Zero args needed."""
    scope_val = scope or _default_workspace_scope()

    # Use direct AQL for true temporal ordering (not semantic search)
    items = _query_checkpoints_by_time(limit=1, scope=scope_val)

    if not items:
        console.print("[yellow]No checkpoints found.[/yellow]")
        return

    checkpoints = _parse_checkpoint_items(items)

    if output_json:
        console.print(json.dumps(checkpoints[0] if checkpoints else {}, indent=2))
        return

    if not checkpoints:
        console.print("[yellow]No checkpoints found.[/yellow]")
        return

    _render_checkpoint(checkpoints[0], index=1)


@app.command("list")
def list_cmd(
    limit: int = typer.Option(5, "--limit", "-k", help="Max results"),
    scope: Optional[str] = typer.Option(None, "--scope", help="Memory scope filter (default: current workspace)"),
    output_json: bool = typer.Option(False, "--json", is_flag=True, help="Output as JSON"),
) -> None:
    """List recent checkpoints sorted by time."""
    # Use direct AQL for true temporal ordering
    items = _query_checkpoints_by_time(limit=limit, scope=scope or _default_workspace_scope())
    checkpoints = _parse_checkpoint_items(items)

    if output_json:
        console.print(json.dumps(checkpoints, indent=2))
        return

    if not checkpoints:
        console.print("[yellow]No checkpoints found.[/yellow]")
        return

    table = Table(title="Recent Checkpoints", show_lines=True)
    table.add_column("#", style="dim", width=3)
    table.add_column("Topic", style="bold")
    table.add_column("Summary", max_width=50)
    table.add_column("Branch", style="cyan")
    table.add_column("Time", style="green")
    table.add_column("Score", style="yellow", width=6)

    for i, cp in enumerate(checkpoints, 1):
        git = cp.get("git", {})
        table.add_row(
            str(i),
            cp.get("topic", "?"),
            _truncate(cp.get("summary", ""), 50),
            git.get("branch", "?"),
            cp.get("timestamp", "?")[:19],
            f"{cp.get('score', 0):.2f}",
        )

    console.print(table)


# ---------------------------------------------------------------------------
# Parsing and rendering helpers
# ---------------------------------------------------------------------------


def _parse_checkpoint_items(items: list[dict]) -> list[dict]:
    """Parse memory-agent recall items into checkpoint dicts."""
    checkpoints = []
    for item in items:
        solution = item.get("solution", "")
        problem = item.get("problem", "")

        # Try to parse the solution as structured JSON
        parsed = {}
        if solution:
            try:
                parsed = json.loads(solution)
            except (json.JSONDecodeError, TypeError):
                parsed = {"raw_solution": solution}

        # Extract topic from problem field
        topic = parsed.get("topic", "")
        if not topic and problem:
            # Strip CHECKPOINT: prefix
            topic = problem
            if topic.startswith(CHECKPOINT_PREFIX):
                topic = topic[len(CHECKPOINT_PREFIX):].strip()
            # Take first line as topic
            topic = topic.split("\n")[0].strip()

        # Extract summary
        summary = parsed.get("summary", "")
        if not summary and problem:
            lines = problem.split("\n")
            summary = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

        checkpoint = {
            "topic": topic,
            "summary": summary,
            "files": parsed.get("files", []),
            "decisions": parsed.get("decisions", []),
            "next_steps": parsed.get("next_steps", []),
            "git": parsed.get("git", {}),
            "project_root": parsed.get("project_root", ""),
            "timestamp": parsed.get("timestamp", _epoch_to_iso(item.get("updated_at")) or item.get("created_at", "")),
            "scope": item.get("scope", ""),
            "score": item.get("scores", {}).get("dense", 0),
            "_key": item.get("_key", ""),
        }
        checkpoints.append(checkpoint)

    return checkpoints


def _render_checkpoint(cp: dict, index: int = 1) -> None:
    """Render a single checkpoint using Rich panels."""
    git = cp.get("git", {})

    # Build content lines
    lines = [
        f"[bold]Topic:[/bold] {cp.get('topic', '?')}",
        f"[bold]Scope:[/bold] {cp.get('scope', '?')}",
        f"[bold]Summary:[/bold] {cp.get('summary', 'N/A')}",
        "",
    ]

    # Git state
    if git:
        lines.append("[bold]Git State:[/bold]")
        lines.append(f"  Branch: {git.get('branch', '?')}")
        lines.append(f"  Commit: {git.get('commit', '?')} - {git.get('commit_message', '')}")
        if git.get("modified_files"):
            lines.append(f"  Modified: {', '.join(git['modified_files'][:5])}")
            if len(git["modified_files"]) > 5:
                lines.append(f"  ... and {len(git['modified_files']) - 5} more")
        lines.append("")

    # Files
    if cp.get("files"):
        lines.append("[bold]Key Files:[/bold]")
        for f in cp["files"]:
            lines.append(f"  - {f}")
        lines.append("")

    # Decisions
    if cp.get("decisions"):
        lines.append("[bold]Decisions:[/bold]")
        for d in cp["decisions"]:
            lines.append(f"  - {d}")
        lines.append("")

    # Next steps
    if cp.get("next_steps"):
        lines.append("[bold]Next Steps:[/bold]")
        for ns in cp["next_steps"]:
            lines.append(f"  - {ns}")
        lines.append("")

    # Metadata
    lines.append(f"[dim]Saved: {cp.get('timestamp', '?')}[/dim]")
    if cp.get("_key"):
        lines.append(f"[dim]Key: {cp['_key']}[/dim]")

    console.print(Panel(
        "\n".join(lines),
        title=f"Checkpoint #{index}",
        border_style="blue",
    ))


def _epoch_to_iso(epoch: int | float | None) -> str:
    """Convert a Unix epoch to ISO 8601 string, or empty string if None."""
    if not epoch:
        return ""
    try:
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
    except (OSError, ValueError):
        return ""


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len, adding ellipsis if needed."""
    text = text.replace("\n", " ").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app()
