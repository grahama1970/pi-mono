"""Root conftest: make src/python importable as 'extract_tables' package."""
import importlib
import os
import sys

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.join(SKILL_DIR, "src", "python")

# Ensure src/python is on sys.path so that non-relative imports
# within sub-modules (e.g. `from models import ...`) still resolve.
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

# Register src/python as the 'extract_tables' package so that
# `from extract_tables import read_pdf` works with relative imports.
if "extract_tables" not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        "extract_tables",
        os.path.join(_src_python, "__init__.py"),
        submodule_search_locations=[_src_python],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["extract_tables"] = mod
    spec.loader.exec_module(mod)
