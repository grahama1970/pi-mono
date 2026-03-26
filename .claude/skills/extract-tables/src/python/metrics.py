"""Accuracy and whitespace metrics for extracted tables."""
from __future__ import annotations

try:
    from .models import Table
except ImportError:
    from models import Table


def compute_accuracy(table: Table) -> float:
    """Compute extraction accuracy based on cell alignment.

    Returns a score 0-100 based on how well cells have content.
    A table with all cells populated scores 100; empty cells reduce the score.
    """
    if not table.cells:
        return 0.0

    total = len(table.cells)
    filled = sum(1 for c in table.cells if c.text and c.text.strip())
    if total == 0:
        return 0.0

    return round(100.0 * filled / total, 2)


def compute_whitespace(table: Table) -> float:
    """Compute whitespace ratio in table cells.

    Returns the percentage (0-100) of cells that are empty or whitespace-only.
    """
    if not table._data:
        if not table.cells:
            return 0.0
        total = len(table.cells)
        empty = sum(1 for c in table.cells if not c.text or not c.text.strip())
        if total == 0:
            return 0.0
        return round(100.0 * empty / total, 2)

    # Use _data (2D grid) if available
    total = 0
    empty = 0
    for row in table._data:
        if isinstance(row, list):
            total += len(row)
            for cell in row:
                if isinstance(cell, str) and cell.strip() == "":
                    empty += 1
    if total == 0:
        return 0.0
    return round(100.0 * empty / total, 2)
