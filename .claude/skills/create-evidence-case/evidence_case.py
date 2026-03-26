"""CLI entrypoint for /create-evidence-case.

Build structured evidence cases using Claims-Arguments-Evidence (CAE) trees.
Exploit-first with MCTS escalation for verification strategy selection.

Inputs: Claim text via CLI args.
Outputs: Evidence case JSON to stdout, tree persisted in /memory.
Failures: Logs errors via loguru, exits with code 1 on fatal.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import typer
from loguru import logger
from rich.console import Console
from rich.tree import Tree

from models import grade_from_score
from runner import EvidenceCaseRunner
from storage import EvidenceCaseStore

app = typer.Typer(
    name="create-evidence-case",
    help="CAE evidence trees with exploit-first MCTS strategy selection.",
    no_args_is_help=True,
)
console = Console()


@app.command()
def create(
    claim: str = typer.Argument(..., help="The claim or question to verify"),
    category: str = typer.Option("auto", "--category", "-c", help="Category: compliance|code|analytics|pipeline|auto"),
    strategies: int = typer.Option(0, "--strategies", "-s", help="Force N concurrent strategies (0=exploit-first)"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress Rich TUI progress"),
    json_output: bool = typer.Option(False, "--json", help="Output raw JSON"),
) -> None:
    """Build an evidence case for a claim."""
    runner = EvidenceCaseRunner()
    try:
        result = runner.run(
            claim_text=claim,
            category=category,
            force_strategies=strategies,
            show_progress=not quiet,
        )
    except Exception as exc:
        logger.error("Evidence case runner failed: {}", exc)
        from models import VerdictNode as _VN
        result = {
            "claim": {"text": claim, "category": category, "id": "error", "verdict": "NOT_SATISFIED"},
            "strategies": [],
            "evidence": [],
            "verdict": {"state": "not_satisfied", "grade": "F", "score": 0.0,
                        "strategy_id": "", "evidence_ids": [],
                        "reasoning": f"Runner error: {exc}"},
            "answer": f"Unable to process: {exc}",
            "needs_clarification": True,
            "clarify_questions": ["Could you rephrase the question?"],
        }

    if json_output:
        # Sanitize control chars that break JSON consumers
        import re
        raw = json.dumps(result, indent=2, default=str)
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', raw)
        print(clean)
        return

    # Pretty print — transparent output so humans can course-correct
    verdict = result.get("verdict", {})
    v_state = verdict.get("state", "unknown")
    v_grade = verdict.get("grade", "?")
    v_score = verdict.get("score", 0.0)
    gate_trace = result.get("gate_trace", [])

    style = "green" if v_state == "satisfied" else "red" if v_state == "not_satisfied" else "yellow"
    console.print(f"\n[bold {style}]{v_state.upper()}[/] — Grade: {v_grade} — Score: {v_score:.3f}")
    console.print(f"[dim]Question:[/] {result['claim']['text'][:120]}")
    console.print(f"[dim]Category:[/] {result['claim']['category']}  |  Case ID: {result['claim']['id']}")

    evidence_count = len(result.get("evidence", []))
    console.print(f"[dim]Evidence:[/] {evidence_count} items")
    console.print()

    # --- Decision rationale (the human must see WHY) ---
    console.print("[bold]Why this verdict:[/]")

    for step in gate_trace:
        gate = step.get("gate", "")
        passed = step.get("passed", False)
        detail = step.get("detail", "")
        icon = "[green]PASS[/]" if passed else "[red]FAIL[/]"
        # Short gate name for readability
        short_name = gate.replace("step_", "").replace("_", " ").title()
        console.print(f"  {icon} {short_name}: {detail[:120]}")

    # --- Grounding evidence warnings ---
    recall_step = next((g for g in gate_trace if g.get("gate") == "step_2_recall"), None)
    if recall_step:
        grounding = recall_step.get("data", {}).get("grounding_evidence", {})
        if isinstance(grounding, dict):
            unresolved_id = grounding.get("unresolved_id_like", 0)
            resolved = grounding.get("resolved", 0)
            if unresolved_id > 0:
                console.print()
                console.print(f"[bold red]WARNING: {unresolved_id} ID-like term(s) "
                              f"did not resolve against the corpus[/]")
                unresolved_terms = grounding.get("unresolved_terms", [])
                for t in unresolved_terms:
                    if isinstance(t, dict) and t.get("type") == "id_like":
                        term = t.get("term", "?")
                        closest = t.get("closest_match", "none")
                        console.print(f"  [red]UNRESOLVED:[/] {term} → closest match: {closest}")
                if v_state == "satisfied":
                    console.print(f"  [yellow]The question references entities that may not exist. "
                                  f"Verdict may be a false positive.[/]")
            elif resolved > 0:
                console.print(f"\n[dim]Grounding: {resolved} terms resolved, 0 unresolved[/]")

    # --- What to check ---
    console.print()
    if v_state == "satisfied":
        console.print("[dim]Check: Do the QRAs below actually answer the question, "
                      "or just share keywords?[/]")
    elif v_state == "inconclusive":
        console.print("[dim]Check: Is this a genuine corpus gap, or a question "
                      "spanning unrelated domains?[/]")
    elif v_state == "not_satisfied":
        console.print("[dim]Check: Is the question genuinely out of scope, "
                      "or using unfamiliar terminology?[/]")


@app.command()
def get(
    case_id: str = typer.Argument(..., help="Evidence case ID to retrieve"),
    json_output: bool = typer.Option(False, "--json", help="Output raw JSON"),
) -> None:
    """Retrieve a stored evidence case."""
    store = EvidenceCaseStore()
    case = store.recall_case(case_id)
    if case is None:
        console.print(f"[red]Case {case_id} not found in /memory[/]")
        raise typer.Exit(code=1)
    if json_output:
        print(json.dumps(case, indent=2, default=str))
    else:
        console.print_json(json.dumps(case, default=str))


@app.command()
def validate(
    case_file: str = typer.Argument(..., help="Path to evidence case JSON file"),
) -> None:
    """Validate an evidence case for schema completeness."""
    path = Path(case_file)
    if not path.exists():
        console.print(f"[red]File not found: {case_file}[/]")
        raise typer.Exit(code=1)

    case = json.loads(path.read_text())
    issues: list[str] = []

    # Check required top-level keys
    for key in ("claim", "strategies", "evidence", "verdict"):
        if key not in case:
            issues.append(f"missing top-level key: {key}")

    # Check claim fields
    claim = case.get("claim", {})
    for field in ("id", "text", "category", "verdict"):
        if not claim.get(field):
            issues.append(f"claim missing: {field}")

    # Check verdict fields
    verdict = case.get("verdict", {})
    for field in ("state", "grade", "score", "strategy_id"):
        if field not in verdict:
            issues.append(f"verdict missing: {field}")

    # Check evidence chain
    strategies = case.get("strategies", [])
    evidence = case.get("evidence", [])
    if not strategies:
        issues.append("no strategies executed")
    if not evidence:
        issues.append("no evidence collected")

    selected = [s for s in strategies if s.get("selected")]
    if not selected:
        issues.append("no winning strategy marked")

    # Check evidence IDs referenced by verdict exist
    cited_ids = set(verdict.get("evidence_ids", []))
    actual_ids = {e.get("id") for e in evidence}
    missing = cited_ids - actual_ids
    if missing:
        issues.append(f"verdict cites missing evidence: {missing}")

    if issues:
        console.print("[yellow]Validation issues:[/]")
        for issue in issues:
            console.print(f"  - {issue}")
        raise typer.Exit(code=1)
    else:
        console.print("[green]Evidence case is valid[/]")


@app.command()
def history(
    category: str = typer.Option("", "--category", "-c", help="Filter by category"),
) -> None:
    """Show UCT strategy history."""
    store = EvidenceCaseStore()
    categories = [category] if category else ["compliance", "code", "analytics", "pipeline", "general"]

    for cat in categories:
        cached = store.load_uct_cache(cat)
        if not cached:
            continue
        parent_visits = sum(s.get("visits", 0) for s in cached)
        console.print(f"\n[bold cyan]{cat}[/] (total visits: {parent_visits})")
        from scoring import uct_score as _uct
        for s in sorted(cached, key=lambda x: _uct(x.get("wins", 0), x.get("visits", 0), max(parent_visits, 1)), reverse=True):
            wins = s.get("wins", 0)
            visits = s.get("visits", 0)
            uct = _uct(wins, visits, max(parent_visits, 1))
            win_rate = wins / visits if visits > 0 else 0
            console.print(f"  {s['name']:20s}  wins={wins:<4}  visits={visits:<4}  rate={win_rate:.2f}  uct={uct:.3f}")


@app.command()
def tree(
    case_id: str = typer.Argument(..., help="Evidence case ID to display"),
) -> None:
    """Print evidence tree (Rich tree display)."""
    store = EvidenceCaseStore()
    case = store.recall_case(case_id)
    if case is None:
        console.print(f"[red]Case {case_id} not found[/]")
        raise typer.Exit(code=1)

    claim = case if case.get("node_type") == "claim" else case.get("claim", case)
    rich_tree = Tree(f"[bold]{claim.get('text', case_id)[:80]}[/] [{claim.get('verdict', '?')}]")

    # If this is a full case dict with strategies/evidence
    for s in case.get("strategies", []):
        marker = "[green]*[/] " if s.get("selected") else "  "
        branch = rich_tree.add(f"{marker}[cyan]{s['name']}[/] score={s.get('score', 0):.3f} ({s.get('latency_ms', 0):.0f}ms)")
        for e in case.get("evidence", []):
            if e.get("layer") == s["name"]:
                branch.add(f"[dim]{e['method']}[/] conf={e.get('confidence', 0):.2f} — {e.get('collector', '')}")

    verdict = case.get("verdict", {})
    if verdict:
        if isinstance(verdict, str):
            rich_tree.add(f"[bold]{verdict}[/]")
        else:
            rich_tree.add(f"[bold {'green' if verdict.get('state') == 'satisfied' else 'red'}]Verdict: {verdict.get('state', '?')} ({verdict.get('grade', '?')})[/]")

    console.print(rich_tree)


if __name__ == "__main__":
    app()
