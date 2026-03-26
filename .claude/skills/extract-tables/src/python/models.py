"""Core data structures for table extraction."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterator, Optional

import polars as pl


@dataclass(slots=True)
class Cell:
    """A single table cell with position and content."""
    x1: float
    y1: float
    x2: float
    y2: float
    text: str = ""
    row_span: int = 1
    col_span: int = 1


@dataclass
class Table:
    """An extracted table with metadata.

    All bboxes use top-left origin: (x0, y0_top, x1, y1_bottom).
    """
    cells: list[Cell] = field(default_factory=list)
    page_number: int = 0  # 1-indexed
    page_index: int = 0   # 0-indexed
    bbox: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    strategy: str = ""
    accuracy: float = 0.0
    whitespace: float = 0.0
    fragmentation: float = 0.0
    title: Optional[str] = None
    ai_title: Optional[str] = None
    ai_description: Optional[str] = None
    ai_headers: Optional[list[str]] = None
    components: Optional[list[dict]] = None  # For merged tables
    _data: Optional[list[list[str]]] = field(default=None, repr=False)
    _df: Optional[pl.DataFrame] = field(default=None, repr=False)
    _rows: int = 0
    _cols: int = 0

    def __init__(self, *, df: Optional[pl.DataFrame] = None, **kwargs):
        """Custom init to accept 'df' as alias for '_df'."""
        # Set defaults for fields not provided
        field_defaults = {
            "cells": [],
            "page_number": 0,
            "page_index": 0,
            "bbox": (0.0, 0.0, 0.0, 0.0),
            "strategy": "",
            "accuracy": 0.0,
            "whitespace": 0.0,
            "fragmentation": 0.0,
            "title": None,
            "ai_title": None,
            "ai_description": None,
            "ai_headers": None,
            "components": None,
            "_data": None,
            "_df": None,
            "_rows": 0,
            "_cols": 0,
        }
        for fname, default in field_defaults.items():
            value = kwargs.pop(fname, default)
            # For mutable defaults, make a copy
            if fname == "cells" and value is field_defaults["cells"]:
                value = []
            object.__setattr__(self, fname, value)
        if df is not None:
            object.__setattr__(self, "_df", df)

    @property
    def df(self) -> pl.DataFrame:
        """Return table data as polars DataFrame."""
        if self._df is not None:
            return self._df
        if self._data is None:
            return pl.DataFrame()
        if not self._data:
            return pl.DataFrame()
        # First row as headers if available
        headers = self._data[0] if self._data else []
        rows = self._data[1:] if len(self._data) > 1 else []
        if headers:
            # Ensure all rows have same length as headers
            padded = [r + [""] * (len(headers) - len(r)) for r in rows]
            return pl.DataFrame(padded, schema=headers, orient="row")
        return pl.DataFrame()

    @property
    def rows(self) -> int:
        return self._rows or (len(self._data) if self._data else 0)

    @property
    def cols(self) -> int:
        if self._cols:
            return self._cols
        if self._data:
            return len(self._data[0])
        if self._df is not None:
            return len(self._df.columns)
        return 0

    def to_csv(self) -> str:
        return self.df.write_csv()

    def to_json(self) -> str:
        return self.df.write_json()

    def to_dict(self) -> dict:
        return {
            "page_number": self.page_number,
            "page_index": self.page_index,
            "bbox": self.bbox,
            "strategy": self.strategy,
            "accuracy": self.accuracy,
            "whitespace": self.whitespace,
            "title": self.title,
            "ai_title": self.ai_title,
            "data": self._data,
        }


@dataclass(slots=True)
class ExtractionResult:
    """Result of table extraction from a PDF.

    Tables are sorted by (page_number, y0, x0) — reading order.
    """
    tables: list[Table] = field(default_factory=list)
    pages_processed: int = 0
    elapsed: float = 0.0
    strategy_history: list[dict] = field(default_factory=list)

    def __post_init__(self):
        self._sort_tables()

    def _sort_tables(self):
        """Sort tables by reading order: page, then top-to-bottom, then left-to-right."""
        self.tables.sort(key=lambda t: (t.page_number, t.bbox[1], t.bbox[0]))

    def __len__(self) -> int:
        return len(self.tables)

    def __getitem__(self, idx: int) -> Table:
        return self.tables[idx]

    def __iter__(self) -> Iterator[Table]:
        return iter(self.tables)

    def __bool__(self) -> bool:
        return len(self.tables) > 0

    def merge_tables(self) -> ExtractionResult:
        """Delegate to merger module for cross-page merging."""
        from .merger import merge_split_tables
        merged = merge_split_tables(self.tables)
        return ExtractionResult(
            tables=merged,
            pages_processed=self.pages_processed,
            elapsed=self.elapsed,
            strategy_history=self.strategy_history,
        )
