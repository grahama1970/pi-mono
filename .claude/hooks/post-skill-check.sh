#!/usr/bin/env bash
# Post-tool hook for Write|Edit: pattern detection + escalation.
# Warns on first 2 violations, BLOCKS on 3rd+ in same session.
# Logs every decision for tuning.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0
[[ -f "$FILE_PATH" ]] || exit 0

echo "$FILE_PATH" | grep -qE '\.(py|ts|tsx|js|jsx|sh)$' || exit 0

# Skip hook files themselves (they contain the patterns they check for)
echo "$FILE_PATH" | grep -qE '\.claude/hooks/' && exit 0

# Locate project root
DIR=$(dirname "$(realpath "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")")
PROJECT_ROOT=""
while [[ "$DIR" != "/" ]]; do
    if [[ -d "$DIR/.git" || -d "$DIR/.pi" ]]; then
        PROJECT_ROOT="$DIR"
        break
    fi
    DIR=$(dirname "$DIR")
done

SKILLS_DIR="${PROJECT_ROOT:+$PROJECT_ROOT/.pi/skills}"
LOG_DIR="${PROJECT_ROOT:+$PROJECT_ROOT/.claude/hook-logs}"
[[ -z "$LOG_DIR" ]] && LOG_DIR="$HOME/.claude/hook-logs"
VIOLATION_FILE="$LOG_DIR/violations.count"
mkdir -p "$LOG_DIR" 2>/dev/null

BASENAME=$(basename "$FILE_PATH")
WARNINGS=""

# --- Extract only ADDED lines (avoid false positives on pre-existing code) ---
# Check unstaged, staged, and HEAD diffs. If all empty and file is tracked, skip
# (no new code to check). Only scan whole file for untracked/new files.
SCAN_SOURCE=""
if git -C "$(dirname "$FILE_PATH")" rev-parse --git-dir &>/dev/null; then
    # Try unstaged, then staged, then vs HEAD (covers recently committed files)
    for DIFF_CMD in \
        "git diff --no-ext-diff -U0 -- $FILE_PATH" \
        "git diff --cached --no-ext-diff -U0 -- $FILE_PATH" \
        "git diff HEAD~1 --no-ext-diff -U0 -- $FILE_PATH"; do
        DIFF_LINES=$(eval "$DIFF_CMD" 2>/dev/null | grep '^+' | grep -v '^+++' || true)
        if [[ -n "$DIFF_LINES" ]]; then
            SCAN_SOURCE="$DIFF_LINES"
            break
        fi
    done
    # If tracked and no diff at any level, nothing new to check
    if [[ -z "$SCAN_SOURCE" ]]; then
        git ls-files --error-unmatch "$FILE_PATH" &>/dev/null && exit 0
    fi
fi
# Fallback: untracked/new file — scan whole file
if [[ -z "$SCAN_SOURCE" ]]; then
    SCAN_SOURCE=$(cat "$FILE_PATH" 2>/dev/null)
fi

# Helper: grep against the diff lines, not the whole file
scan() { echo "$SCAN_SOURCE" | grep -qE "$1" 2>/dev/null; }

# --- Pattern checks (on added lines only) ---

# 1. Subprocess wrapping run.sh
if scan "subprocess.*run\.sh"; then
    SKILL=$(echo "$SCAN_SOURCE" | grep -oP 'skills/\K[^/]+(?=/run\.sh)' 2>/dev/null | head -1)
    [[ -n "$SKILL" ]] && WARNINGS+="BESPOKE: Wraps /$SKILL via subprocess.\n"
fi

# 2. Direct ArangoDB (memory.sock is OK — that's the approved daemon interface)
scan 'arango_client|ArangoClient|python-arango|:8529|arangodb\.connect' && WARNINGS+="BESPOKE: Direct ArangoDB. Use /memory.\n"

# 3. Hand-written prompts
scan '(f""".*You are|f"You are a|prompt\s*=\s*f"|system_prompt\s*=\s*f")' && WARNINGS+="BESPOKE: Hand-written prompt. Use /prompt-lab.\n"

# 4. Direct scillm (exempt approved callers)
if scan 'httpx\.post.*localhost:4001|httpx\.post.*SCILLM'; then
    if [[ "$BASENAME" != "tool_use.py" && "$BASENAME" != "code_runner.py" && "$BASENAME" != "review_prompt.py" ]]; then
        WARNINGS+="BESPOKE: Direct scillm httpx. Use /scillm skill.\n"
    fi
fi

# 5-7. Python conventions
scan '^.?import logging|^.?from logging import' && WARNINGS+="CONVENTION: Use loguru, not logging.\n"
scan '^.?import requests|^.?from requests import' && WARNINGS+="CONVENTION: Use httpx, not requests.\n"
scan '^.?import argparse|^.?import click|^.?from click import' && WARNINGS+="CONVENTION: Use typer, not argparse/click.\n"

# 8. Banned
scan 'claude\s+-p|codex\s+exec' && WARNINGS+="BANNED: claude -p / codex exec.\n"

# 9-10. Security
scan "re\.(search|match|findall).*import\s" && WARNINGS+="CONVENTION: Regex import detection. Use ast.\n"
echo "$SCAN_SOURCE" | grep -vE '^\s*#' | grep -qE '\beval\s*\(' 2>/dev/null && WARNINGS+="SECURITY: eval() detected.\n"

# 11-12. Bare/fallback except (hides errors silently)
scan '^\s*\+?\s*except\s*:' && WARNINGS+="SECURITY: Bare except: hides errors. Catch specific exceptions.\n"
echo "$SCAN_SOURCE" | grep -vE '^\s*#' | grep -qE '^\+?\s*except\s+Exception\s*:' 2>/dev/null && WARNINGS+="CONVENTION: Broad except Exception. Catch specific exceptions.\n"

# 13-14. Skill reimplementation
if [[ "$BASENAME" != "tool_use.py" ]]; then
    scan 'def.*repo.?map|def.*symbol.*extract|def.*parse.*symbols' && WARNINGS+="BESPOKE: Symbol extraction. Use /treesitter.\n"
fi
scan 'sentence.transformers|SentenceTransformer|faiss\.' && WARNINGS+="BESPOKE: Embedding code. Use /embedding.\n"

# --- No warnings? Clean exit ---
if [[ -z "$WARNINGS" ]]; then
    echo "{\"ts\":$(date +%s),\"file\":\"$BASENAME\",\"result\":\"clean\"}" >> "$LOG_DIR/post-check.jsonl" 2>/dev/null
    exit 0
fi

# --- Count violations for escalation ---
CURRENT_COUNT=0
[[ -f "$VIOLATION_FILE" ]] && CURRENT_COUNT=$(cat "$VIOLATION_FILE" 2>/dev/null || echo 0)
NEW_COUNT=$((CURRENT_COUNT + 1))
echo "$NEW_COUNT" > "$VIOLATION_FILE"

# --- Log ---
echo "{\"ts\":$(date +%s),\"file\":\"$BASENAME\",\"violations\":$NEW_COUNT,\"warnings\":\"$(echo -e "$WARNINGS" | tr '\n' '|')\"}" >> "$LOG_DIR/post-check.jsonl" 2>/dev/null

# --- Escalation: 3+ violations → BLOCK ---
if [[ $NEW_COUNT -ge 3 ]]; then
    echo "" >&2
    echo "═══════════════════════════════════════════════════════════════" >&2
    echo "  POST-EDIT BLOCKED — $NEW_COUNT violations this session" >&2
    echo "═══════════════════════════════════════════════════════════════" >&2
    echo -e "$WARNINGS" | sed 's/^/  /' >&2
    echo "" >&2
    echo "  Too many bespoke patterns detected. Fix violations or" >&2
    echo "  reset: rm $VIOLATION_FILE" >&2
    echo "═══════════════════════════════════════════════════════════════" >&2
    exit 2
fi

# --- Warning (violations 1-2) ---
echo ""
echo "=== POST-EDIT WARNING ($NEW_COUNT/3 before block) for $BASENAME ==="
echo -e "$WARNINGS"

exit 0
