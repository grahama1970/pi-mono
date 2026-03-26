# Pi Task Tool Gap Analysis

**Date**: 2026-02-23
**Pi Version**: 0.52.8 (feat-triggers branch)
**Pi Native Tools**: read, bash, edit, write, grep, find, ls (7 total)
**Gap**: Claude Code's `Task` tool (subagent spawning) has no Pi equivalent

## Summary

18 of 228 skills declare `Task` in their `allowed-tools`. Analysis categorizes each by dependency severity and provides migration paths for running under Pi's 7 native tools.

| Category | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Core functionality requires concurrent isolated agents |
| ADAPTABLE | 8 | Can work with `bash + pi -p` sequential delegation |
| COSMETIC | 7 | Task listed but skill functions without it |

## CRITICAL (3 skills) — Need Task Tool Extension

These skills fundamentally require concurrent, isolated agent execution. They cannot be downgraded to sequential `bash + pi -p` without losing core functionality.

### 1. argue
- **How it uses Task**: Spawns 2-4 persona agents concurrently, each researching independently in isolated contexts, then synthesizes
- **What breaks without Task**: Cannot run personas in parallel with context isolation. Sequential execution leaks context between personas
- **Migration path**: Build `pi-task` extension via `registerTool()` that spawns `pi -p --no-session` subprocesses with JSON mode

### 2. review-paper
- **How it uses Task**: Parallel multi-persona review — each reviewer gets isolated context, reviews independently
- **What breaks without Task**: Sequential review means later reviewers see earlier reviews, biasing results
- **Migration path**: Same as argue — needs concurrent isolated subprocess spawning

### 3. create-movie
- **How it uses Task**: Multi-phase orchestration with parallel research agents (location scouting, casting, music, SFX simultaneously)
- **What breaks without Task**: Loses parallelism, 4-6x slower execution. Some phases need isolated context
- **Migration path**: Extension that manages parallel `pi -p --mode json` subprocesses with result aggregation

## ADAPTABLE (8 skills) — Can Use Sequential Delegation

These skills use Task for delegation but can function with sequential `bash + pi -p` calls. Quality may slightly decrease but core functionality preserved.

### 4. plan
- **How it uses Task**: Spawns explore agent for codebase research during planning
- **What breaks without Task**: Must do research inline rather than delegating
- **Migration**: Replace Task calls with `bash: pi -p --mode json "research query"` — works fine sequentially

### 5. create-story
- **How it uses Task**: Delegates research, character development, and world-building to sub-agents
- **What breaks without Task**: Loses parallel research, slightly slower
- **Migration**: Sequential `pi -p` calls for each research phase

### 6. paper-lab
- **How it uses Task**: Spawns review agents for iterative convergence loop
- **What breaks without Task**: Convergence loop runs sequentially (slower, not fundamentally broken)
- **Migration**: Sequential `pi -p --mode json` for each review iteration

### 7. review-story
- **How it uses Task**: Multi-provider review delegation
- **What breaks without Task**: Reviews run sequentially instead of concurrently
- **Migration**: Sequential `pi -p` with different provider flags per review

### 8. sparta-review
- **How it uses Task**: Delegates validation sub-tasks to specialist agents
- **What breaks without Task**: Sub-tasks run sequentially
- **Migration**: Chain `pi -p --mode json` calls

### 9. review-sparta
- **How it uses Task**: Similar to sparta-review — parallel validation delegation
- **What breaks without Task**: Sequential validation only
- **Migration**: Same as sparta-review

### 10. monitor-contacts
- **How it uses Task**: Spawns research agents for contact enrichment
- **What breaks without Task**: Contact research runs sequentially (slower but functional)
- **Migration**: Sequential `pi -p` calls per contact

### 11. discover-contacts
- **How it uses Task**: Parallel prospect research across multiple sources
- **What breaks without Task**: Sequential source queries
- **Migration**: Sequential `pi -p` calls per source

## COSMETIC (7 skills) — Works Without Task

These skills list Task in allowed-tools but don't critically depend on it. Core functionality uses Pi's 7 native tools.

### 12. orchestrate
- **Why cosmetic**: Orchestrate itself IS the task runner — it calls `pi -p` via bash. Task tool listed for self-reference
- **Works under Pi**: Yes, fully — bash tool drives `pi -p` subprocesses

### 13. create-music
- **Why cosmetic**: Task listed for potential parallel stem processing, but actual workflow is sequential
- **Works under Pi**: Yes — voice conversion, mixing are sequential bash operations

### 14. learn-voice
- **Why cosmetic**: Task listed for parallel audio processing, but pipeline is sequential
- **Works under Pi**: Yes — YouTube download → audio extraction → RVC training is sequential

### 15. learn-artist
- **Why cosmetic**: Same pattern as learn-voice
- **Works under Pi**: Yes — sequential pipeline

### 16. create-stems
- **Why cosmetic**: Demucs stem separation is a single bash command, Task not needed
- **Works under Pi**: Yes — `bash: demucs ...` is the core operation

### 17. voice-lab
- **Why cosmetic**: Task listed for potential parallel evaluation, but TTS eval is sequential
- **Works under Pi**: Yes — TTS generation and comparison are sequential

### 18. debug-fetcher
- **Why cosmetic**: Task listed for parallel URL testing, but works fine sequentially
- **Works under Pi**: Yes — sequential URL fetch attempts with strategy rotation

## Migration Strategy

### Phase 1: Immediate (0 effort)
Run the 7 COSMETIC skills under Pi today. No changes needed.

### Phase 2: Sequential Adaptation (Low effort)
Update the 8 ADAPTABLE skills to use `bash: pi -p --mode json` instead of Task. This is a SKILL.md edit per skill — replace Task references with bash-based delegation patterns.

### Phase 3: Task Extension (Medium effort)
Build a `pi-task` extension using Pi's `registerTool()` API:

```typescript
// .pi/extensions/pi-task.ts
export default function(pi: ExtensionAPI) {
  pi.registerTool("task", {
    description: "Spawn isolated sub-agent",
    parameters: { prompt: "string", mode: "string" },
    execute: async ({ prompt, mode }) => {
      // spawn: pi -p --no-session --mode json "prompt"
      // return parsed JSON result
    }
  });
}
```

This unlocks the 3 CRITICAL skills. Estimated effort: 1-2 days for basic implementation, 1 week for production-quality with concurrency control.

## Skill Compatibility Summary

| Status | Count | Skills |
|--------|-------|--------|
| Works TODAY | 210 | All skills not using Task (210 of 228) |
| Works with SKILL.md edit | 8 | plan, create-story, paper-lab, review-story, sparta-review, review-sparta, monitor-contacts, discover-contacts |
| Needs pi-task extension | 3 | argue, review-paper, create-movie |
| **Total Pi-compatible** | **228** | After Phase 3, all skills work |

## Recommendation

**Start with Phase 1+2 immediately.** 218 of 228 skills can run under Pi today or with trivial SKILL.md edits. The pi-task extension (Phase 3) is the only meaningful development work, and it only blocks 3 skills.
