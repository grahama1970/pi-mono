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
  improve       Run self-improvement loop (persona-driven test + review iteration)
  converge      Three-gate design convergence (spec → board → mockups)
  test          Run interaction tests (via /test-interactions)

Improve options (PERSONA REQUIRED):
  --persona NAME    Persona agent (brandon-bailey, rob-armstrong, nico-bailon)
  --max-rounds N    Max improvement rounds (default: 5)
  --provider NAME   Vision LLM provider (default: gemini)
  --surface NAME    Test only this surface
  --manifest PATH   Custom interaction manifest

Converge options (CLIENT REQUIRED):
  --client NAME           Client persona who approves/rejects (e.g. nico-bailon)
  --board PATH            Path to DESIGN_BOARD.md
  --designer-rules PATH   Designer persona YAML (design constraints, not active agent)
  --max-rounds N          Max mockup convergence rounds (default: 5)
  --gates 0,1,2           Run only these gates (comma-separated)
  --skip-gate0            Skip spec preflight
  --skip-gate1            Skip design board validation

Design options:
  --agents N    Number of agents (default: 3)
  --brief TEXT  Design brief context

Examples:
  run.sh improve --persona brandon-bailey
  run.sh improve --persona nico-bailon --max-rounds 3
  run.sh converge --client nico-bailon --board design/DESIGN_BOARD.md
  run.sh converge --client nico-bailon --board design/DESIGN_BOARD.md --gates 0,1
  run.sh test --persona brandon-bailey --surface threat-map-compliance
  run.sh design "dashboard with navbar and sidebar" --agents 3
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

  improve)
    shift
    # Self-improvement loop: persona-driven test → review → iterate
    IMPROVE_ARGS=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --persona) IMPROVE_ARGS+=(--persona "$2"); shift 2 ;;
        --max-rounds) IMPROVE_ARGS+=(--max-rounds "$2"); shift 2 ;;
        --provider) IMPROVE_ARGS+=(--provider "$2"); shift 2 ;;
        --surface) IMPROVE_ARGS+=(--surface "$2"); shift 2 ;;
        --manifest) IMPROVE_ARGS+=(--manifest "$2"); shift 2 ;;
        --output) IMPROVE_ARGS+=(--output "$2"); shift 2 ;;
        --tokens) IMPROVE_ARGS+=(--tokens "$2"); shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
      esac
    done
    cd "$SCRIPT_DIR"
    python improve.py "${IMPROVE_ARGS[@]}"
    ;;

  converge)
    shift
    # Three-gate design convergence: spec → board → mockups
    CONVERGE_ARGS=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --client) CONVERGE_ARGS+=(--client "$2"); shift 2 ;;
        --board) CONVERGE_ARGS+=(--board "$2"); shift 2 ;;
        --designer-rules) CONVERGE_ARGS+=(--designer-rules "$2"); shift 2 ;;
        --max-rounds) CONVERGE_ARGS+=(--max-rounds "$2"); shift 2 ;;
        --manifest) CONVERGE_ARGS+=(--manifest "$2"); shift 2 ;;
        --provider) CONVERGE_ARGS+=(--provider "$2"); shift 2 ;;
        --surface) CONVERGE_ARGS+=(--surface "$2"); shift 2 ;;
        --output) CONVERGE_ARGS+=(--output "$2"); shift 2 ;;
        --gates) CONVERGE_ARGS+=(--gates "$2"); shift 2 ;;
        --skip-gate0) CONVERGE_ARGS+=(--skip-gate0); shift ;;
        --skip-gate1) CONVERGE_ARGS+=(--skip-gate1); shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
      esac
    done
    cd "$SCRIPT_DIR"
    python converge.py "${CONVERGE_ARGS[@]}"
    ;;

  test)
    shift
    # Run interaction tests with optional persona for the review step
    TEST_ARGS=()
    PERSONA=""
    SURFACE=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --persona) PERSONA="$2"; shift 2 ;;
        --surface) SURFACE="$2"; shift 2 ;;
        --manifest) TEST_ARGS+=(--manifest "$2"); shift 2 ;;
        --output-dir) TEST_ARGS+=(--output-dir "$2"); shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
      esac
    done
    # Find persona manifest if no explicit manifest given
    if [[ ! " ${TEST_ARGS[*]:-} " =~ " --manifest " ]] && [[ -n "$PERSONA" ]]; then
      PERSONA_MANIFEST="$SCRIPT_DIR/fixtures/${PERSONA}-manifest.json"
      if [[ -f "$PERSONA_MANIFEST" ]]; then
        TEST_ARGS+=(--manifest "$PERSONA_MANIFEST")
      else
        echo "No persona manifest found: $PERSONA_MANIFEST" >&2
        exit 1
      fi
    fi
    if [[ -n "$SURFACE" ]]; then
      TEST_ARGS+=(--surface "$SURFACE")
    fi
    # Default output dir
    if [[ ! " ${TEST_ARGS[*]:-} " =~ " --output-dir " ]]; then
      TEST_ARGS+=(--output-dir "$SCRIPT_DIR/captures")
    fi
    SKILL_RUN="${HOME}/.pi/skills/test-interactions/run.sh"
    if [[ ! -f "$SKILL_RUN" ]]; then
      SKILL_RUN="$(dirname "$SCRIPT_DIR")/../.pi/skills/test-interactions/run.sh"
    fi
    exec "$SKILL_RUN" run "${TEST_ARGS[@]}"
    ;;

  *)
    usage
    exit 1
    ;;
esac
