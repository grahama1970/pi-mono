#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
RUST_DIR="$SKILL_DIR/src/rust"
PYTHON_DIR="$SKILL_DIR/src/python"

# ── Subcommands ──────────────────────────────────────────────
CMD="${1:-help}"
shift || true

case "$CMD" in
  extract)
    # Extract tables from a PDF
    # Usage: ./run.sh extract <pdf_path> [--strategy lattice|stream|network|hybrid|auto] [--output json|csv]
    python3 "$PYTHON_DIR/extract_tables.py" extract "$@"
    ;;

  batch)
    # Batch extract from a directory of PDFs
    python3 "$PYTHON_DIR/extract_tables.py" batch "$@"
    ;;

  build)
    # Build the Rust PyO3 module
    echo "Building Rust module with maturin..."
    cd "$RUST_DIR"
    maturin develop --release
    echo "Rust module built successfully."
    ;;

  build-python)
    # Compile Python parsers with mypyc
    echo "Compiling Python parsers with mypyc..."
    cd "$PYTHON_DIR"
    mypyc parsers/lattice.py parsers/stream.py parsers/network.py parsers/hybrid.py
    echo "Python parsers compiled."
    ;;

  test)
    # Run test suite
    cd "$SKILL_DIR"
    python3 -m pytest tests/ -v "$@"
    ;;

  shadow)
    # Show shadow log (self-correction history)
    if [ -f "$SKILL_DIR/shadow.jsonl" ]; then
      python3 -c "
import json, sys
for line in open('$SKILL_DIR/shadow.jsonl'):
    r = json.loads(line)
    status = 'AGREE' if r.get('agree') else 'DISAGREE'
    print(f\"{r.get('timestamp','')} [{status}] {r.get('strategy_predicted','')} vs {r.get('strategy_actual','')} acc={r.get('accuracy','?')}\")
" | tail -20
    else
      echo "No shadow logs yet."
    fi
    ;;

  status)
    # Health check
    bash "$SKILL_DIR/sanity.sh"
    ;;

  help|*)
    cat <<HELP
/extract-tables — Composable PDF table extraction (Rust + compiled Python)

Usage:
  ./run.sh extract <pdf> [--strategy auto] [--output json]
  ./run.sh batch <dir> [--output-dir <dir>]
  ./run.sh build           Build Rust PyO3 module
  ./run.sh build-python    Compile Python parsers (mypyc)
  ./run.sh test            Run test suite
  ./run.sh shadow          Show self-correction log
  ./run.sh status          Health check
HELP
    ;;
esac
