#!/usr/bin/env bash
# Pre-tool hook for Bash: block file mutations that bypass Write/Edit hooks.
# Agents use shell redirection to skip the plan gate. This catches that.
#
# Exit 0 = allow, Exit 2 = block.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Fail closed: if we can't parse the command, block it
if [[ -z "$COMMAND" ]]; then
    # Empty could mean parse error — allow only if INPUT is also empty (no tool_input)
    HAS_INPUT=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('tool_input',{}).get('command') else 'no')" 2>/dev/null)
    if [[ "$HAS_INPUT" == "yes" ]]; then
        echo "BASH GUARD: Could not parse command. Blocking for safety." >&2
        exit 2
    fi
    exit 0
fi

# --- Allow safe commands (read-only, build, test, git info) ---
# Quick exit for obviously safe patterns
# Safe: read-only commands that don't mutate files
# Note: cat WITHOUT redirect is safe; cat WITH > is caught below
echo "$COMMAND" | grep -qE '^\s*(ls |head |tail |wc |grep |rg |find |git (status|log|diff|show|branch)|python3? -c|pytest|npm (test|run|install)|uv |ruff (check|format)|which |echo [^>]|pwd|cd |mkdir |chmod |stat |file |diff |jq |curl )' && exit 0

# Docker exec runs inside a container — can't mutate host files
echo "$COMMAND" | grep -qE '^\s*(sudo\s+)?docker\s+exec\s' && exit 0

# Writes to .claude/hooks/ are self-maintenance, not bypass
echo "$COMMAND" | grep -qE '\.claude/hooks/' && exit 0

# --- Detect file mutation patterns ---
MUTATIONS=""

# Shell redirection writes
echo "$COMMAND" | grep -qE '\s+>\s+\S+\.(py|ts|tsx|js|jsx|sh|rs|go|c|cpp|java)' && MUTATIONS+="shell redirect to code file\n"
echo "$COMMAND" | grep -qE 'cat\s*>|>\s*\S+\.(py|ts|tsx|js|jsx|sh)|cat\s*<<|tee\s+\S+\.(py|ts|tsx|js|jsx|sh)' && MUTATIONS+="cat/tee/heredoc write to code file\n"

# sed/awk/perl in-place editing
echo "$COMMAND" | grep -qE 'sed\s+-i|perl\s+-[pi]i?' && MUTATIONS+="in-place edit (sed -i / perl -pi)\n"

# mv/cp into source directories
echo "$COMMAND" | grep -qE '(mv|cp)\s+.*\s+.*(src/|lib/|\.pi/skills/)' && MUTATIONS+="mv/cp into source directory\n"

# git checkout that overwrites files
echo "$COMMAND" | grep -qE 'git\s+checkout\s+--\s' && MUTATIONS+="git checkout -- (overwrites files)\n"

# Python/Node write operations
echo "$COMMAND" | grep -qE "python3?\s+-c.*open\(.*['\"]w['\"]" && MUTATIONS+="python -c file write\n"

if [[ -n "$MUTATIONS" ]]; then
    cat >&2 << BLOCK

═══════════════════════════════════════════════════════════════
  BASH MUTATION GUARD — File write detected in Bash command
═══════════════════════════════════════════════════════════════

  Detected:
$(echo -e "$MUTATIONS" | sed 's/^/    /')
  Use the Write or Edit tool instead of shell commands to
  modify code files. This ensures the plan gate and post-edit
  checks run.

  If this is a legitimate build/test command, it may be a
  false positive — the user can approve it.

═══════════════════════════════════════════════════════════════

BLOCK
    exit 2
fi

exit 0
