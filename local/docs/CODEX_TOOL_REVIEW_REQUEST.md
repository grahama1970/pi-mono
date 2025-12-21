# Code Review Request: Codex CLI Tool Integration

## Repository and branch

- **Repo:** `badlogic/pi-mono`
- **Branch:** `feature/codex-tool-integration`
- **Paths of interest:**
  - `packages/coding-agent/examples/custom-tools/codex/index.ts`
  - `packages/coding-agent/examples/custom-tools/codex/README.md`

## Summary

This PR adds a custom tool that allows pi-mono users to invoke Codex CLI headlessly without switching tools. The approach:

1. **Avoids first-class provider status** — Codex is NOT added to `KnownProvider` or the provider registry
2. **Delegates auth** — Uses `~/.codex/auth.json` managed by Codex CLI, not pi-mono
3. **Subprocess integration** — Spawns `codex exec --json --full-auto` and streams JSONL events
4. **Example, not core** — Lives in `examples/custom-tools/`, users opt-in via symlink

## Objectives

### 1. Enable in-flow Codex usage

Allow users to invoke Codex without leaving pi-mono:

```
Use codex to optimize this function for memory
```

### 2. Avoid first-class provider concerns

The current `codex-experimental` provider in pi-mono has issues:

- Hard-coded internal endpoint (`chatgpt.com/backend-api/codex`)
- User-Agent spoofing (`codex_cli_rs/0.50.0`)
- Token piggybacking from `~/.codex/auth.json`
- No token refresh logic

This tool integration avoids all of these by delegating to the Codex CLI subprocess.

### 3. Support multi-turn via pi-mono's agent loop

pi-mono owns the iteration loop — the agent can call the codex tool multiple times as needed:

```
1. Call codex tool → get result
2. Evaluate result
3. Call codex tool again if needed
```

## Architecture Analysis

### What the tool does

```typescript
// Spawns Codex CLI as subprocess
child = spawn("codex", ["exec", "--json", "--full-auto", prompt], {
  cwd: workDir,
  stdio: ["ignore", "pipe", "pipe"],
});

// Streams JSONL events from stdout
child.stdout?.on("data", (data) => {
  // Parse JSONL, emit progress via onUpdate
});
```

### Separation of concerns

| Concern          | Owner                            |
| ---------------- | -------------------------------- |
| OAuth tokens     | Codex CLI (`~/.codex/auth.json`) |
| Token refresh    | Codex CLI                        |
| API endpoint     | Codex CLI (internal)             |
| User-Agent       | Codex CLI (legitimate)           |
| Tool invocation  | pi-mono (via subprocess)         |
| Streaming events | pi-mono (parse JSONL)            |

### Comparison to current `codex-experimental` provider

| Aspect        | Current Provider                    | This Tool                         |
| ------------- | ----------------------------------- | --------------------------------- |
| Auth handling | pi-mono reads `~/.codex/auth.json`  | Codex CLI manages auth            |
| API endpoint  | Hard-coded in `models.generated.ts` | Codex CLI handles                 |
| Token refresh | None (just reads file)              | Codex CLI handles                 |
| UA spoofing   | `codex_cli_rs/0.50.0 (pi-mono)`     | Legitimate CLI usage              |
| Streaming     | SSE from API                        | JSONL from subprocess             |
| Location      | Core (`packages/ai`)                | Example (`examples/custom-tools`) |
| Opt-in        | Default for codex models            | User must install                 |

## Risk Assessment

### Low risk factors

1. **Isolated from core** — Lives in `examples/`, not imported by default
2. **No API surface** — Doesn't touch provider registry, model definitions, or auth flows
3. **Delegates correctly** — Auth/API concerns stay with Codex CLI where they belong
4. **Follows patterns** — Uses same `CustomAgentTool` interface as existing examples

### Medium risk factors

1. **Codex CLI must be installed** — Error messaging when CLI missing could be improved
2. **JSONL format may change** — Tied to Codex CLI's output format (but isolated)
3. **No tests** — Manual testing only (acceptable for example)

### Upstream acceptance likelihood

| Factor             | Rating    | Reason                                        |
| ------------------ | --------- | --------------------------------------------- |
| Code quality       | ✓ Good    | TypeScript, follows existing patterns         |
| Scope              | ✓ Minimal | Example only, no core changes                 |
| ToS compliance     | ✓ Clean   | Uses legitimate CLI, no API spoofing          |
| Maintenance burden | ✓ Low     | Isolated, documented                          |
| User value         | ✓ Clear   | Enables new workflow without breaking changes |

## Constraints for acceptance

1. **Must not modify core packages** — Changes should stay in `examples/custom-tools/`
2. **No new dependencies** — Uses only existing deps (`child_process`, typebox, etc.)
3. **Documentation required** — README explains installation and usage
4. **Error handling** — Graceful failure when Codex CLI not installed

## Acceptance criteria

- [ ] Tool compiles without TypeScript errors
- [ ] Biome lint passes
- [ ] Can invoke via pi-mono when installed
- [ ] Handles abort signal correctly
- [ ] Returns useful error when Codex CLI missing
- [ ] README provides clear installation instructions

## Test plan

**Manual testing:**

1. Install the tool:

   ```bash
   mkdir -p ~/.pi/agent/tools/codex
   ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/codex/index.ts" \
     ~/.pi/agent/tools/codex/index.ts
   ```

2. Start pi-mono:

   ```bash
   cd packages/coding-agent && npx tsx src/cli.ts
   ```

3. Test basic invocation:

   ```
   Use codex to echo hello world
   ```

   Expected: Streaming events shown, final result returned.

4. Test abort (Ctrl+C during execution):
   Expected: Subprocess killed, partial result returned.

5. Test without Codex CLI installed:
   Expected: Clear error message about missing CLI.

## Implementation notes

### Event format

Codex CLI `--json` output uses this structure:

```json
{
  "type": "item.completed",
  "item": { "id": "item_2", "type": "agent_message", "text": "hello" }
}
```

The tool extracts `agent_message` items as the final result.

### Streaming

Progress updates emitted via `onUpdate` callback:

```typescript
onUpdate?.({
  content: [{ type: "text", text: formatEventForDisplay(event) }],
  details: { events: [...events], streaming: true },
});
```

### Abort handling

Uses `SIGTERM` with fallback to `SIGKILL` after 2 seconds:

```typescript
const onAbort = () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => child?.kill("SIGKILL"), 2000);
  }
};
```

## Known limitations

1. **No real-time token streaming** — Batch events, not character-by-character
2. **Subprocess overhead** — Slight latency vs direct API
3. **Codex CLI required** — Not zero-dependency

## Clarifying questions for reviewers

1. **Location:** Is `examples/custom-tools/codex/` the right location, or should this be in a separate `contrib/` directory?

2. **Core provider:** Should this eventually replace the current `codex-experimental` provider, or coexist?

3. **Error handling:** How verbose should errors be when Codex CLI is missing?

4. **Default sandbox:** Should `workspace-write` be default (matches `--full-auto`), or should `read-only` be safer default?

5. **Model parameter:** Should we validate model names against known Codex models, or pass through to CLI?

## Deliverable

The PR should include:

- `packages/coding-agent/examples/custom-tools/codex/index.ts` — Tool implementation
- `packages/coding-agent/examples/custom-tools/codex/README.md` — Documentation
- This review document (optional, for context)

## Recommendation

**✓ Likely to be accepted** — This approach:

- Solves a real user need (in-flow Codex access)
- Minimizes maintenance burden (example, not core)
- Avoids ToS/stability concerns (delegates to CLI)
- Follows existing patterns (`CustomAgentTool`)

## Changes Based on Review Feedback

The following changes were made to address Copilot review feedback:

### 1. Replaced `any` types with `ThemeInterface`

```typescript
interface ThemeInterface {
  fg(color: string, text: string): string;
  bold(text: string): string;
}
```

### 2. Removed emojis, using ASCII markers

- `⏳` → `[running]`
- `✓` → `[ok]`
- `✗` → `[error]` / `[exit N]`
- `💭` → `[thinking]`
- `💬` → `[message]`
- `📄` → `[file]`
- `→` → `->`

### 3. Changed to safe defaults

- **Sandbox**: Defaults to `read-only` (was implicit `workspace-write`)
- **--full-auto**: Only used when `workspace-write` explicitly requested
- Description updated to emphasize read-only default

### 4. Improved error handling

- ENOENT: "Codex CLI not found. Install with: npm install -g @openai/codex"
- EACCES: "Permission denied running Codex CLI"
- Other: Generic spawn error message

### 5. Added `settled` guard

Prevents double resolve/reject edge cases:

```typescript
let settled = false;
const safeResolve = (value) => {
  if (!settled) {
    settled = true;
    resolve(value);
  }
};
```

### 6. Updated README

- Added EXPERIMENTAL warning
- Added CAUTION for workspace-write mode
- Added platform notes (macOS/Linux tested, Windows best-effort)
