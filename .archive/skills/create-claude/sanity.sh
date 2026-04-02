#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0

echo "=== create-claude sanity ==="

# 1. Required files exist
for f in SKILL.md run.sh server.py Dockerfile requirements.txt; do
    if [[ ! -f "$SCRIPT_DIR/$f" ]]; then
        echo "FAIL: missing $f"
        ERRORS=$((ERRORS + 1))
    fi
done

# 2. Docker available
if ! command -v docker &>/dev/null; then
    echo "WARN: docker not installed (skill won't work without it)"
fi

# 3. Python syntax check on server.py
if command -v python3 &>/dev/null; then
    python3 -c "import ast; ast.parse(open('$SCRIPT_DIR/server.py').read())" 2>/dev/null || {
        echo "FAIL: server.py has syntax errors"
        ERRORS=$((ERRORS + 1))
    }
fi

# 4. OAuth creds exist
if [[ ! -f "${HOME}/.claude/.credentials.json" ]]; then
    echo "WARN: No OAuth credentials at ~/.claude/.credentials.json"
fi

# 5. SKILL.md has triggers
if ! grep -q "triggers:" "$SCRIPT_DIR/SKILL.md"; then
    echo "FAIL: SKILL.md missing triggers"
    ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
    echo "FAILED ($ERRORS errors)"
    exit 1
fi

echo "PASSED"
