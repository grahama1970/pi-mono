"""CLI for /extract-entities skill.

Thin wrapper around graph_memory.entity_extraction.extract_entities().
All logic lives in graph_memory — this is just the Typer CLI + formatting.

Inputs: Question text via CLI arg or --text flag.
Outputs: JSON EntityExtractionResult to stdout.
Failures: Falls back to regex-only if ArangoDB unavailable.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import typer
from loguru import logger
from rich.console import Console
from rich.table import Table

# Add src to path for graph_memory imports
_SRC = Path(__file__).resolve().parent.parent.parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

app = typer.Typer(
    name="extract-entities",
    help="Extract control IDs, phrases, and relationships from question text.",
    no_args_is_help=True,
)
console = Console()


@app.command()
def extract(
    text: str = typer.Argument(..., help="Question or claim text to extract entities from"),
    taxonomy: bool = typer.Option(False, "--taxonomy", "-t", help="Include taxonomy bridge attributes"),
    json_output: bool = typer.Option(False, "--json", help="Output raw JSON"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress Rich formatting"),
) -> None:
    """Extract entities from question text."""
    from graph_memory.entity_extraction import extract_entities

    result = extract_entities(text, include_taxonomy=taxonomy)

    if json_output or quiet:
        print(json.dumps(result.to_dict(), indent=2, default=str))
        return

    # Rich formatted output
    console.print(f"\n[bold]Entity Extraction[/]")
    console.print(f"[dim]Question:[/] {text[:100]}")
    console.print()

    if result.control_ids:
        console.print(f"[cyan]Regex control IDs:[/] {', '.join(result.control_ids)}")
    if result.phrase_controls:
        console.print(f"[cyan]Phrase-discovered:[/] {', '.join(result.phrase_controls)}")
    if result.phrases:
        console.print(f"[cyan]Domain phrases:[/] {', '.join(result.phrases)}")

    console.print(f"\n[bold]All control IDs ({len(result.all_control_ids)}):[/] {', '.join(result.all_control_ids)}")

    if result.control_metadata:
        console.print()
        table = Table(title="Control Metadata")
        table.add_column("Control ID", style="cyan")
        table.add_column("Name")
        table.add_column("Framework", style="green")
        table.add_column("Domain")
        for c in result.control_metadata:
            table.add_row(
                c.get("control_id", ""),
                str(c.get("name", ""))[:40],
                c.get("framework", ""),
                c.get("domain", ""),
            )
        console.print(table)

    if result.related_pairs:
        console.print()
        console.print(f"[bold green]Related pairs ({len(result.related_pairs)}):[/]")
        for pair in result.related_pairs[:10]:
            console.print(f"  {pair['source']} --[{pair.get('method', '?')}]--> {pair['target']}")
    elif len(result.all_control_ids) > 1:
        console.print()
        console.print("[bold red]No relationship edges found between controls[/]")
        console.print("[dim]These controls may not be in the same SPARTA technique[/]")

    if result.taxonomy_tags:
        console.print()
        console.print(f"[bold]Taxonomy tags:[/]")
        for collection, tags in result.taxonomy_tags.items():
            if tags:
                console.print(f"  {collection}: {', '.join(tags)}")

    # Summary verdict
    console.print()
    if result.all_control_ids and result.related_pairs:
        console.print("[bold green]Coherent:[/] Entities share technique relationships")
    elif result.all_control_ids and not result.related_pairs and len(result.all_control_ids) > 1:
        console.print("[bold yellow]Incoherent:[/] Entities exist but no shared technique — may need decomposition")
    elif result.all_control_ids:
        console.print("[bold green]Single entity:[/] Coherent by definition")
    else:
        console.print("[bold red]No entities found:[/] Question may be off-topic or too vague")


@app.command()
def check(
    text: str = typer.Argument(..., help="Quick coherence check — are all entities in the same technique?"),
) -> None:
    """Quick boolean: are extracted entities coherent (same technique)?"""
    from graph_memory.entity_extraction import extract_entities

    result = extract_entities(text)

    coherent = (
        len(result.all_control_ids) <= 1
        or len(result.related_pairs) > 0
    )

    output = {
        "coherent": coherent,
        "control_count": len(result.all_control_ids),
        "control_ids": result.all_control_ids,
        "related_pairs": len(result.related_pairs),
        "phrases": result.phrases,
    }

    if not coherent:
        output["reason"] = f"Controls {result.all_control_ids} have no shared relationship edges"

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    app()
