# Codex Tool

Invoke OpenAI Codex CLI headlessly from within pi-mono.

## Prerequisites

1. **Install Codex CLI:**

   ```bash
   npm install -g @openai/codex
   ```

2. **Login:**
   ```bash
   codex login
   ```

## Installation

The tool is auto-discovered from `~/.pi/agent/tools/codex/`:

```bash
# From pi-mono root
mkdir -p ~/.pi/agent/tools/codex
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/codex/index.ts" \
  ~/.pi/agent/tools/codex/index.ts
```

## Usage

Within pi-mono, ask the model to use the codex tool:

```
Use codex to explain what packages/ai/src/types.ts does
```

```
Use codex with read-only sandbox to find all authentication-related code
```

```
Use codex with workspace-write sandbox and model o3 to refactor this function
```

## Parameters

| Parameter | Type                                        | Description                            |
| --------- | ------------------------------------------- | -------------------------------------- |
| `prompt`  | string (required)                           | Task for Codex to execute              |
| `model`   | string (optional)                           | Model override (e.g., "o3", "o4-mini") |
| `sandbox` | "read-only" \| "workspace-write" (optional) | Sandbox mode                           |
| `workDir` | string (optional)                           | Working directory                      |

## How It Works

1. Spawns `codex exec --json --full-auto` as a subprocess
2. Streams JSONL events to the TUI as progress updates
3. Returns Codex's final message as the tool result
4. Handles Ctrl+C by killing the subprocess cleanly

## Limitations vs Native Codex CLI

| Feature             | This Tool     | Native Codex CLI  |
| ------------------- | ------------- | ----------------- |
| Streaming tokens    | Batch events  | Real-time         |
| Interactive prompts | Not supported | Full support      |
| Multi-turn in Codex | Single task   | Full conversation |
| Rich TUI            | Simplified    | Full Codex TUI    |

**Best for:** Occasional, targeted Codex calls without leaving pi-mono.  
**Not for:** Extended Codex sessions—use `codex` directly for those.
