#!/usr/bin/env bash
# PostCompact hook: re-inject checkpoint briefing after context compaction.
# This ensures the agent knows what it was doing even after automatic compaction
# strips prior conversation turns.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
CHECKPOINT_SKILL="$PROJECT_ROOT/.pi/skills/checkpoint"

# Only inject if checkpoint skill exists and memory daemon is reachable
if [ ! -f "$CHECKPOINT_SKILL/run.sh" ]; then
    exit 0
fi

# Run checkpoint resume --json, extract the briefing fields
# Output goes to stdout which becomes additionalContext for the agent
RESUME_JSON=$("$CHECKPOINT_SKILL/run.sh" resume --json 2>/dev/null || echo '{}')

if [ "$RESUME_JSON" = "{}" ] || [ -z "$RESUME_JSON" ]; then
    exit 0
fi

# Extract key fields with python (available via uv)
python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    cp = data.get('checkpoint') or {}
    git = data.get('live_git') or {}
    if not cp:
        sys.exit(0)
    parts = ['--- CHECKPOINT CONTEXT (auto-injected after compaction) ---']
    parts.append(f'TOPIC: {cp.get(\"topic\", \"?\")}')
    parts.append(f'GRADE: {cp.get(\"grade\", \"?\").upper()}')
    resume = cp.get('resume', '')
    if resume:
        parts.append(f'DO THIS NEXT: {resume}')
    failures = cp.get('failures', [])
    if failures:
        parts.append('DON\\'T REPEAT: ' + '; '.join(failures))
    skills = cp.get('skills_used', [])
    if skills:
        parts.append('SKILLS: ' + ', '.join('/' + s for s in skills))
    parts.append(f'GIT: {git.get(\"branch\", \"?\")} @ {git.get(\"commit\", \"?\")}')
    changed = git.get('files_changed', [])
    if changed:
        parts.append(f'CHANGED FILES ({len(changed)}): ' + ', '.join(changed[:8]))
    parts.append('--- END CHECKPOINT CONTEXT ---')
    print('\n'.join(parts))
except (json.JSONDecodeError, KeyError, TypeError):
    sys.exit(0)
" <<< "$RESUME_JSON"
