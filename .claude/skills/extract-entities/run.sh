#!/usr/bin/env bash
# Strip inherited venv to prevent uv conflicts in cross-skill subprocess calls
unset VIRTUAL_ENV
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Use memory repo venv (graph_memory lives there)
MEMORY_ROOT="${MEMORY_ROOT:-/home/graham/workspace/experiments/memory}"
VENV="${MEMORY_ROOT}/.venv"
if [[ -d "$VENV" ]]; then
    export PATH="$VENV/bin:$PATH"
    export VIRTUAL_ENV="$VENV"
fi

# Ensure graph_memory is importable
export PYTHONPATH="${MEMORY_ROOT}/src${PYTHONPATH:+:$PYTHONPATH}"

exec python "$SCRIPT_DIR/extract_entities.py" "$@"
