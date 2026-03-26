---
name: checkpoint
description: >
  Save and recall session checkpoints in /memory. Captures current topic,
  key files, decisions, and resumption context so the next session can
  pick up where you left off. Stored in ArangoDB via memory-agent learn,
  recalled via memory-agent recall.

triggers:
  - checkpoint
  - save checkpoint
  - /checkpoint
  - save where we left off
  - remember where we are

allowed-tools: [Bash, Read, Write, Glob, Grep]

metadata:
  short-description: "Session checkpoint storage and recall via /memory"
  author: "Horus"
  version: "1.0.0"

provides:
  - session-checkpoint
  - context-preservation
  - conversation-continuity

composes:
  - memory
  - create-context

taxonomy:
  - checkpoint
  - state-management
  - session-continuity
---

# /checkpoint

Save and recall session checkpoints so agents can pick up where they left off.

## Quick Start

### Save a checkpoint

```bash
./run.sh save \
  --topic "SPARTA convergence pipeline" \
  --summary "Fixed grounding threshold bug, PASS rate now 78%" \
  --files src/graph_memory/lessons/recall.py \
  --files scripts/seal/generate_aql_batch.py \
  --decisions "Kept threshold at 0.85 after testing" \
  --next-steps "Run full convergence cycle overnight"
```

### Recall the latest checkpoint

```bash
./run.sh last
```

### List recent checkpoints

```bash
./run.sh list
```

## How It Works

Checkpoints are stored as lessons in ArangoDB (database: `memory`) via the
`memory-agent learn` CLI. The problem field contains the checkpoint title and
summary. The solution field contains structured JSON with files, decisions,
next steps, and git state at the time of save.

On recall, the skill queries `memory-agent recall` with the checkpoint topic
and parses the structured solution back into a human-readable display.

## Commands

| Command  | Description                            |
|----------|----------------------------------------|
| `save`   | Save a session checkpoint to /memory   |
| `recall` | Recall checkpoints matching a topic    |
| `last`   | Recall the most recent checkpoint      |
| `list`   | List recent checkpoints                |

## Save Options

| Option           | Short | Required | Description                          |
|------------------|-------|----------|--------------------------------------|
| `--topic`        | `-t`  | Yes      | Current conversation topic           |
| `--summary`      | `-s`  | Yes      | Brief summary of where we left off   |
| `--files`        | `-f`  | No       | Key file paths (repeatable)          |
| `--decisions`    |       | No       | Decisions made this session (repeat.) |
| `--next-steps`   |       | No       | What should happen next (repeatable) |
| `--project-root` |       | No       | Project root (auto-detected from git)|
| `--scope`        |       | No       | Memory scope (default: git project)  |
| `--json`         |       | No       | Output as JSON                       |

## Recall Options

| Option    | Short | Required | Description                          |
|-----------|-------|----------|--------------------------------------|
| `--topic` | `-t`  | No       | Topic to search for (default: all)   |
| `--scope` |       | No       | Memory scope filter (defaults to current workspace; use to target another workspace) |
| `--limit` | `-k`  | No       | Max results (default: 3)             |
| `--json`  |       | No       | Output as JSON                       |

## Examples

```bash
# Save checkpoint with full context
./run.sh save \
  -t "Schema migration" \
  -s "Migrated controls collection, 3 fields remaining" \
  -f src/graph_memory/setup_schema.py \
  -f src/graph_memory/arango_client.py \
  --decisions "Keep backward compat for old field names" \
  --decisions "Use ALTER TABLE migration pattern" \
  --next-steps "Migrate remaining 3 fields" \
  --next-steps "Run sanity tests"

# Recall with specific topic
./run.sh recall -t "Schema migration"

# List last 5 checkpoints
./run.sh list --limit 5

# Query checkpoints from another workspace scope
./run.sh last --scope memory
./run.sh list --scope pi-mono --limit 3

# JSON output for programmatic use
./run.sh save -t "Debug session" -s "Found the bug" --json
./run.sh recall --json
```

## Integration with /memory

Checkpoints are standard lessons in the `lessons` collection with a
`CHECKPOINT:` prefix in the problem field. This means:

- They are searchable via `memory-agent recall`
- They participate in semantic search and BM25 ranking
- They have the same 90-day decay as other lessons
- They can be found alongside related lessons during recall
- Tags include `checkpoint` and `session-state` for filtering
