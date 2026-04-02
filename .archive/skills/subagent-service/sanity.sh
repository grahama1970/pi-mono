#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0

echo "=== subagent-service sanity ==="

# 1. Required files exist
for f in SKILL.md run.sh server.py Dockerfile requirements.txt backends.yml; do
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

# 4. backends.yml is valid YAML
if command -v python3 &>/dev/null; then
    python3 -c "import yaml; yaml.safe_load(open('$SCRIPT_DIR/backends.yml'))" 2>/dev/null || {
        echo "FAIL: backends.yml is not valid YAML"
        ERRORS=$((ERRORS + 1))
    }
fi

# 5. OAuth creds exist (Claude) and are valid JSON
if [[ ! -f "${HOME}/.claude/.credentials.json" ]]; then
    echo "WARN: No OAuth credentials at ~/.claude/.credentials.json (container will fail to start)"
else
    if ! python3 -c "import sys, json; json.load(open('${HOME}/.claude/.credentials.json'))" 2>/dev/null; then
        echo "FAIL: ~/.claude/.credentials.json is not valid JSON"
        ERRORS=$((ERRORS + 1))
    fi
fi

# 6. SKILL.md has triggers
if ! grep -q "triggers:" "$SCRIPT_DIR/SKILL.md"; then
    echo "FAIL: SKILL.md missing triggers"
    ERRORS=$((ERRORS + 1))
fi

# 7. All three CLIs available on host
for cli in claude codex gemini; do
    if ! command -v "$cli" &>/dev/null; then
        echo "WARN: $cli CLI not installed"
    fi
done

if [[ $ERRORS -gt 0 ]]; then
    echo "FAILED ($ERRORS errors)"
    exit 1
fi

echo "PASSED"
