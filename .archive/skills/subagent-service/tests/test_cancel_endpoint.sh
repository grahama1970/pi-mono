#!/bin/bash
# Test: subagent-service cancel endpoint
#
# Verifies POST /tasks/{id}/cancel exists and behaves correctly.
# Requires a running subagent container.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

echo "=== Test: cancel endpoint ==="

# Find a running instance
PORT=$(docker ps --filter "label=embry.skill=subagent-service" --format '{{.Label "embry.port"}}' | head -1)
if [[ -z "$PORT" ]]; then
    echo "SKIP: no running subagent-service container"
    exit 0
fi
echo "Using instance on port $PORT"

# 1. Cancel nonexistent task → 404
echo -n "1. Cancel nonexistent task returns 404... "
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${PORT}/tasks/nonexistent/cancel")
if [[ "$code" == "404" ]]; then
    echo "PASS"
else
    echo "FAIL (got $code)"
    ERRORS=$((ERRORS + 1))
fi

# 2. Tasks endpoint returns valid JSON
echo -n "2. GET /tasks returns valid JSON... "
tasks_output=$(curl -sf "http://localhost:${PORT}/tasks" 2>/dev/null)
if echo "$tasks_output" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "PASS"
else
    echo "FAIL"
    ERRORS=$((ERRORS + 1))
fi

# 3. Health endpoint includes all backends
echo -n "3. Health check shows all backends... "
health=$(curl -sf "http://localhost:${PORT}/health" 2>/dev/null)
if echo "$health" | python3 -c "
import sys, json
d = json.load(sys.stdin)
backends = d.get('backends', {})
assert 'claude' in backends, 'missing claude'
assert 'codex' in backends, 'missing codex'
assert 'gemini' in backends, 'missing gemini'
print('OK')
" 2>/dev/null; then
    echo "PASS"
else
    echo "FAIL"
    echo "   $health"
    ERRORS=$((ERRORS + 1))
fi

# 4. docker-compose.yml exists and validates
echo -n "4. docker-compose.yml valid... "
if docker compose -f "$SCRIPT_DIR/docker-compose.yml" config --quiet 2>/dev/null; then
    echo "PASS"
else
    echo "FAIL"
    ERRORS=$((ERRORS + 1))
fi

echo ""
if [[ $ERRORS -gt 0 ]]; then
    echo "FAILED ($ERRORS errors)"
    exit 1
fi
echo "ALL PASSED"
