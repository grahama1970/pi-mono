"""Tests for data-audit skill.

Requires duckdb (from data-audit skill).
Skipped when run from pi-mono root where duckdb is not installed.
"""
import pytest
from pathlib import Path
import subprocess

try:
    import duckdb  # noqa: F401
    _HAS_DUCKDB = True
except ImportError:
    _HAS_DUCKDB = False

AUDIT_SCRIPT = Path(".agent/skills/data-audit/audit.py")

@pytest.mark.skipif(not _HAS_DUCKDB, reason="duckdb not installed")
def test_data_audit_run():
    if not AUDIT_SCRIPT.exists():
        pytest.skip(f"Audit script not found at {AUDIT_SCRIPT}")

    result = subprocess.run(
        ["python", str(AUDIT_SCRIPT), "--help"],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0
