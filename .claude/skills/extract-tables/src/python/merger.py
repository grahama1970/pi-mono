"""Cross-page table merger.

Detects tables split across consecutive pages and merges them.
Heuristic path (default):
1. Tables on consecutive pages
2. Same column count OR second table has no header
3. X-axis overlap > 50% of smaller table width
4. Width ratio > 90%
5. "continued" in title triggers auto-merge
"""
from __future__ import annotations
from typing import Optional

import polars as pl

try:
    from .models import Table
except ImportError:
    from models import Table


def merge_split_tables(tables: list[Table]) -> list[Table]:
    """Merge tables that span across page breaks.

    Args:
        tables: List of tables sorted by (page_number, y0, x0)

    Returns:
        Merged list (may be shorter than input)
    """
    if len(tables) <= 1:
        return tables

    merged = []
    skip = set()

    for i, table in enumerate(tables):
        if i in skip:
            continue

        # Look for merge candidate on next page
        current = table
        j = i + 1
        while j < len(tables):
            candidate = tables[j]
            if _should_merge(current, candidate):
                current = _merge_pair(current, candidate)
                skip.add(j)
                j += 1
            else:
                break

        merged.append(current)

    return merged


def _should_merge(a: Table, b: Table) -> bool:
    """Determine if table b is a continuation of table a."""
    # Must be on consecutive pages
    if b.page_number != a.page_number + 1:
        return False

    # "continued" in title triggers auto-merge
    if b.title and "continued" in b.title.lower():
        return True

    # Same column count
    a_cols = a.cols
    b_cols = b.cols
    if a_cols > 0 and b_cols > 0 and a_cols != b_cols:
        return False

    # Width ratio > 90%
    a_width = a.bbox[2] - a.bbox[0]
    b_width = b.bbox[2] - b.bbox[0]
    if a_width > 0 and b_width > 0:
        ratio = min(a_width, b_width) / max(a_width, b_width)
        if ratio < 0.9:
            return False

    # X-axis overlap > 50%
    overlap_x0 = max(a.bbox[0], b.bbox[0])
    overlap_x1 = min(a.bbox[2], b.bbox[2])
    if overlap_x1 > overlap_x0:
        overlap_width = overlap_x1 - overlap_x0
        min_width = min(a_width, b_width)
        if min_width > 0 and overlap_width / min_width < 0.5:
            return False
    else:
        return False

    return True


def _merge_pair(a: Table, b: Table) -> Table:
    """Merge table b into table a."""
    # Track components
    components = []
    if a.components:
        components.extend(a.components)
    else:
        components.append({"page_number": a.page_number, "bbox": a.bbox})
    components.append({"page_number": b.page_number, "bbox": b.bbox})

    # Merge data
    merged_data = None
    if a._data and b._data:
        # Skip header row of second table if it matches first table's header
        b_data = b._data
        if (len(a._data) > 0 and len(b_data) > 0
                and a._data[0] == b_data[0]):
            b_data = b_data[1:]  # Skip duplicate header
        merged_data = a._data + b_data
    elif a._data:
        merged_data = a._data
    elif b._data:
        merged_data = b._data

    # Merge DataFrames if present
    merged_df = None
    if a._df is not None and b._df is not None:
        try:
            # If column names match, concatenate directly
            if list(a._df.columns) == list(b._df.columns):
                merged_df = pl.concat([a._df, b._df])
            else:
                merged_df = a._df
        except Exception:
            merged_df = a._df
    elif a._df is not None:
        merged_df = a._df
    elif b._df is not None:
        merged_df = b._df

    # Merge cells
    merged_cells = list(a.cells) + list(b.cells)

    # Merged bbox spans both pages -- keep first page's bbox
    merged_bbox = a.bbox

    return Table(
        cells=merged_cells,
        page_number=a.page_number,
        page_index=a.page_index,
        bbox=merged_bbox,
        strategy=a.strategy,
        accuracy=min(a.accuracy, b.accuracy),
        whitespace=max(a.whitespace, b.whitespace),
        title=a.title,
        ai_title=a.ai_title,
        components=components,
        _data=merged_data,
        _df=merged_df,
        _rows=a._rows + b._rows,
        _cols=max(a._cols, b._cols),
    )
