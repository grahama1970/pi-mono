#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="${CREATE_UX_API:-http://localhost:3001/api/v1}"

usage() {
  cat <<EOF
Usage: run.sh <command> [options]

Commands:
  serve         Start the dev server (API + UI)
  design        Decompose a prompt into a design plan
  health        Check API health

Design options:
  --agents N    Number of agents (default: 3)
  --brief TEXT  Design brief context

Examples:
  run.sh design "dashboard with navbar and sidebar" --agents 3
  run.sh design "login form"
  run.sh serve
EOF
}

case "${1:-}" in
  serve)
    cd "$SCRIPT_DIR"
    npm run dev
    ;;

  design)
    shift
    PROMPT=""
    AGENTS=3
    BRIEF=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --agents) AGENTS="$2"; shift 2 ;;
        --brief) BRIEF="$2"; shift 2 ;;
        *) PROMPT="$PROMPT $1"; shift ;;
      esac
    done
    PROMPT="${PROMPT## }"
    if [[ -z "$PROMPT" ]]; then
      echo "Error: prompt is required" >&2
      exit 1
    fi
    curl -s -X POST "$API_BASE/design" \
      -H "Content-Type: application/json" \
      -d "{\"prompt\":\"$PROMPT\",\"agents\":$AGENTS}" | jq .
    ;;

  health)
    curl -s "${API_BASE%/v1}/health" | jq .
    ;;

  *)
    usage
    exit 1
    ;;
esac
