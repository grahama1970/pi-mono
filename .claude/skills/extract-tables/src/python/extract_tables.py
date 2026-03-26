#!/usr/bin/env python3
"""extract-tables: Native PDF table extraction.

Hybrid Rust + compiled-Python architecture. Shadow-LEGO self-correcting
strategy routing via /assistant classify.

Usage:
    from extract_tables import read_pdf
    tables = read_pdf("document.pdf", pages="1", flavor="lattice")
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import click

from .strategy_router import select_strategy, get_fallback
from .shadow_logger import log_extraction
from .models import ExtractionResult, Table

SKILL_DIR = Path(__file__).resolve().parent.parent.parent


def _parse_page_range(pages: str, total_pages: int) -> list[int]:
    """Parse page range string into 0-indexed page indices.

    Examples:
        "1" -> [0]
        "1,3,5" -> [0, 2, 4]
        "1-5" -> [0, 1, 2, 3, 4]
        "all" -> [0, 1, ..., total_pages-1]
        "1-end" -> [0, 1, ..., total_pages-1]
        "2-end" -> [1, 2, ..., total_pages-1]
    """
    pages = pages.strip()
    if pages.lower() == "all":
        return list(range(total_pages))

    result: list[int] = []
    for part in pages.split(","):
        part = part.strip()
        if "-" in part:
            start_str, end_str = part.split("-", 1)
            start = int(start_str.strip())
            if end_str.strip().lower() == "end":
                end = total_pages
            else:
                end = int(end_str.strip())
            for p in range(start, end + 1):
                idx = p - 1  # Convert to 0-indexed
                if 0 <= idx < total_pages:
                    result.append(idx)
        else:
            idx = int(part) - 1
            if 0 <= idx < total_pages:
                result.append(idx)

    return sorted(set(result))


def _get_parser(strategy: str):
    """Instantiate the parser for the given strategy name."""
    from .parsers.lattice import LatticeParser
    from .parsers.stream import StreamParser
    from .parsers.network import NetworkParser
    from .parsers.hybrid import HybridParser

    parsers = {
        "lattice": LatticeParser,
        "stream": StreamParser,
        "network": NetworkParser,
        "hybrid": HybridParser,
    }
    cls = parsers.get(strategy)
    if cls is None:
        raise ValueError(f"Unknown strategy: {strategy!r}. Valid: {list(parsers)}")
    return cls()


def read_pdf(
    filepath: str,
    pages: str = "1",
    flavor: str = "auto",
    password: str | None = None,
    suppress_stdout: bool = False,
    parallel: bool = False,
    layout_kwargs: dict[str, Any] | None = None,
    **kwargs,
) -> ExtractionResult:
    """Extract tables from a PDF file.

    Drop-in replacement for camelot.io.read_pdf(). When flavor="auto",
    uses Shadow-LEGO strategy routing to pick the best parser.

    Parameters
    ----------
    filepath : str
        Path or URL to PDF file.
    pages : str
        Comma-separated page numbers. Example: '1,3,4' or '1,4-end' or 'all'.
    flavor : str
        Parser flavor: 'lattice', 'stream', 'network', 'hybrid', or 'auto'.
    password : str, optional
        PDF password for decryption.
    suppress_stdout : bool
        Suppress parser output.
    parallel : bool
        Process pages in parallel (not yet implemented).
    layout_kwargs : dict, optional
        pdfminer LAParams kwargs (unused in native pipeline).
    **kwargs
        Additional parser-specific parameters.

    Returns
    -------
    ExtractionResult
        Result containing extracted tables, strategy history, etc.
    """
    start_time = time.monotonic()

    from .pdf_bridge import get_page_count, extract_text_elements, get_page_dimensions
    from .metrics import compute_accuracy
    from .title_extractor import extract_title_from_context, batch_infer_titles
    from .merger import merge_split_tables

    # Get total page count
    total_pages = get_page_count(filepath)
    page_indices = _parse_page_range(pages, total_pages)

    all_tables: list[Table] = []
    strategy_history: list[dict] = []

    for page_idx in page_indices:
        # Select strategy
        if flavor == "auto":
            chosen, confidence = select_strategy(filepath, page_idx, **kwargs)
        else:
            chosen = flavor
            confidence = 1.0

        # Extract tables using the chosen parser
        parser = _get_parser(chosen)
        tables = parser.extract_tables(filepath, page_idx, password=password)

        # Compute accuracy for each table
        for table in tables:
            table.accuracy = compute_accuracy(table)

        # Self-correction: retry with fallback if accuracy too low or no tables found
        avg_accuracy = (
            sum(t.accuracy for t in tables) / len(tables) if tables else 0
        )
        if avg_accuracy < 80:
            best_tables = tables
            best_name = chosen
            best_avg = avg_accuracy
            for fallback_name in get_fallback(chosen):
                try:
                    alt_parser = _get_parser(fallback_name)
                    alt_tables = alt_parser.extract_tables(
                        filepath, page_idx, password=password
                    )
                    for t in alt_tables:
                        t.accuracy = compute_accuracy(t)
                    alt_avg = (
                        sum(t.accuracy for t in alt_tables) / len(alt_tables)
                        if alt_tables
                        else 0
                    )
                    # Prefer fallback if: it found tables when primary didn't,
                    # or it has better accuracy
                    if (alt_tables and not best_tables) or alt_avg > best_avg:
                        best_tables = alt_tables
                        best_name = fallback_name
                        best_avg = alt_avg
                except Exception:
                    continue
            tables = best_tables
            chosen = best_name
            avg_accuracy = best_avg

        # Set page info and strategy on all tables
        for t in tables:
            t.page_index = page_idx
            t.page_number = page_idx + 1
            if not t.strategy:
                t.strategy = chosen

        # Title extraction: heuristic from text above each table
        try:
            text_elements = extract_text_elements(filepath, page_idx, password=password)
            page_dims = get_page_dimensions(filepath, page_idx)
            for t in tables:
                if t.title is None and t.bbox != (0.0, 0.0, 0.0, 0.0):
                    t.title = extract_title_from_context(
                        text_elements, t.bbox, page_dims
                    )
        except Exception:
            pass  # Title extraction is best-effort

        strategy_history.append({
            "page": page_idx,
            "strategy": chosen,
            "tables": len(tables),
            "accuracy": avg_accuracy,
        })
        all_tables.extend(tables)

    # Cross-page merging: detect tables split across page breaks
    all_tables = merge_split_tables(all_tables)

    # VLM batch title inference for tables without titles (graceful if unavailable)
    try:
        all_tables = batch_infer_titles(all_tables)
    except Exception:
        pass  # VLM is optional

    elapsed = time.monotonic() - start_time

    # Shadow logging
    overall_accuracy = (
        sum(t.accuracy for t in all_tables) / len(all_tables)
        if all_tables
        else 0
    )
    log_extraction(
        filepath=filepath,
        pages=pages,
        flavor=strategy_history[0]["strategy"] if strategy_history else flavor,
        confidence=confidence if strategy_history else 0.0,
        num_tables=len(all_tables),
        accuracy=overall_accuracy,
        elapsed_seconds=elapsed,
    )

    return ExtractionResult(
        tables=all_tables,
        pages_processed=len(page_indices),
        elapsed=elapsed,
        strategy_history=strategy_history,
    )


# -- CLI ---------------------------------------------------------------

@click.group()
def cli():
    """extract-tables: PDF table extraction."""
    pass


@cli.command()
@click.argument("pdf_path")
@click.option("--pages", default="1", help="Pages to extract (e.g., '1', 'all', '1-end')")
@click.option("--strategy", "flavor", default="auto", help="Strategy: lattice, stream, network, hybrid, auto")
@click.option("--output", default="json", help="Output format: json, csv, markdown")
@click.option("--line-scale", default=15, type=int, help="Line scale for lattice parser")
def extract(pdf_path: str, pages: str, flavor: str, output: str, line_scale: int):
    """Extract tables from a PDF."""
    kwargs = {}
    if flavor in ("lattice", "auto"):
        kwargs["line_scale"] = line_scale

    result = read_pdf(pdf_path, pages=pages, flavor=flavor, **kwargs)

    click.echo(f"Found {len(result)} table(s)")
    for i, table in enumerate(result.tables):
        click.echo(
            f"  Table {i+1}: rows={table.rows} cols={table.cols} "
            f"accuracy={table.accuracy}"
        )

        if output == "json":
            click.echo(table.to_json())
        elif output == "csv":
            click.echo(table.to_csv())


@cli.command()
@click.argument("pdf_dir")
@click.option("--output-dir", default=".", help="Output directory")
@click.option("--strategy", "flavor", default="auto")
def batch(pdf_dir: str, output_dir: str, flavor: str):
    """Batch extract from a directory of PDFs."""
    pdf_dir_p = Path(pdf_dir)
    output_dir_p = Path(output_dir)
    output_dir_p.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(pdf_dir_p.glob("*.pdf"))
    click.echo(f"Processing {len(pdfs)} PDFs...")

    for pdf in pdfs:
        try:
            result = read_pdf(str(pdf), pages="all", flavor=flavor)
            out_file = output_dir_p / f"{pdf.stem}_tables.json"
            results_data = []
            for t in result.tables:
                results_data.append({
                    "page": t.page_number,
                    "accuracy": t.accuracy,
                    "rows": t.rows,
                    "cols": t.cols,
                    "data": t._data,
                })
            out_file.write_text(json.dumps(results_data, indent=2))
            click.echo(f"  {pdf.name}: {len(result)} tables -> {out_file.name}")
        except Exception as e:
            click.echo(f"  {pdf.name}: ERROR - {e}", err=True)


if __name__ == "__main__":
    cli()
