#!/bin/bash
# unset-venv: Block uv run commands that don't unset VIRTUAL_ENV
#
# Fires on: PreToolUse (Bash)
# Purpose:
#   When VIRTUAL_ENV is set (inherited from parent shell), uv run resolves
#   to the wrong .venv. Every run.sh starts with `unset VIRTUAL_ENV` but
#   agents bypass run.sh by calling uv run directly.
#
#   This hook blocks any `uv run` command that doesn't first unset VIRTUAL_ENV.
#   The agent must prefix with: unset VIRTUAL_ENV && uv run ...

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

[[ -z "$COMMAND" ]] && exit 0

# Only care about commands that invoke uv run
echo "$COMMAND" | grep -qE '\buv\s+run\b' || exit 0

# Allow if the command already unsets VIRTUAL_ENV
echo "$COMMAND" | grep -qE 'unset\s+VIRTUAL_ENV' && exit 0

# Allow if the command explicitly sets VIRTUAL_ENV= (empty)
echo "$COMMAND" | grep -qE 'VIRTUAL_ENV=' && exit 0

# Block — uv run without unset VIRTUAL_ENV will resolve to the wrong venv
cat >&2 <<EOF

═══════════════════════════════════════════════════════════════
  UNSET-VENV — uv run requires unset VIRTUAL_ENV
═══════════════════════════════════════════════════════════════
  Your command uses 'uv run' without unsetting VIRTUAL_ENV.
  This will resolve packages from the WRONG venv.

  Fix: prefix your command with 'unset VIRTUAL_ENV &&'
  Example: unset VIRTUAL_ENV && uv run python my_script.py

  Or call the skill's run.sh which already handles this.
═══════════════════════════════════════════════════════════════

EOF
exit 2
