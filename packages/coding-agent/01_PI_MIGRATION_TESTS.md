# Pi Migration Readiness — Blind Adversarial Test Plan

**Primary Persona**: Graham Anderson — architect switching daily CLI from Claude Code to Pi
**Goal**: Prove Pi works reliably for daily interactive use before switching tomorrow
**Gate**: ALL tasks must pass before migration. Any failure blocks the switch.

---

## Wave 1: Infrastructure Verification (no LLM calls)

### Task 1: Vitest runs without zombies
- **Skill chain**: `/test` → `/ops-workstation`
- **Do**: Run `npx vitest run test/e2e-readiness.test.ts --maxWorkers=1 --no-file-parallelism` in `packages/coding-agent`
- **Do**: After run completes, verify `ps aux | grep vitest | grep -v grep | wc -l` returns 0
- **Do**: Verify exit code is 0 and all 26 tests pass
- **Definition of Done**: 26/26 pass, zero zombie processes, CPU returns to baseline within 10 seconds
- **Sanity**: `ps aux | grep vitest | grep -v grep | wc -l` == 0

### Task 2: Existing Pi test suite passes
- **Skill chain**: `/test`
- **Do**: Run `npx vitest run test/path-utils.test.ts test/args.test.ts test/git-ssh-url.test.ts test/truncate-to-width.test.ts --maxWorkers=1` in `packages/coding-agent`
- **Do**: These are pure-logic tests with no `src/core/skills.ts` import — they must pass quickly (<30s)
- **Definition of Done**: All tests pass, duration <30s, zero zombies
- **Sanity**: Exit code 0

### Task 3: Skill-selector test suite passes
- **Skill chain**: `/test`
- **Do**: Run `npx vitest run test/skill-selector.test.ts --maxWorkers=1` in `packages/coding-agent`
- **Do**: 61 tests covering slash ref parsing, trigger index, composes expansion, persona routing
- **Definition of Done**: 61/61 pass
- **Sanity**: Exit code 0, zero zombies

### Task 4: skills-ci scan passes
- **Skill chain**: `/skills-ci`
- **Do**: Run `cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan` from pi-mono root
- **Do**: Record baseline error count
- **Definition of Done**: Error count documented, no new errors introduced by vitest.config.ts change
- **Sanity**: Exit code 0

---

## Wave 2: Provider & CLI Smoke Tests (requires API keys)

### Task 5: Pi responds via Anthropic provider
- **Skill chain**: `/test`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "Respond with exactly: MIGRATION_OK" --no-session --no-tools`
- **Do**: Verify stdout contains "MIGRATION_OK"
- **Definition of Done**: Exit 0, stdout contains MIGRATION_OK
- **Sanity**: `echo $?` == 0

### Task 6: Pi responds via Google provider
- **Skill chain**: `/test`
- **Do**: Run `pi --provider google --model gemini-2.5-flash -p "Respond with exactly: MIGRATION_OK" --no-session --no-tools`
- **Do**: Verify stdout contains "MIGRATION_OK"
- **Definition of Done**: Exit 0, stdout contains MIGRATION_OK
- **Sanity**: `echo $?` == 0

### Task 7: Pi tool use works (read file)
- **Skill chain**: `/test`
- **Do**: Create `/tmp/pi-test-canary.txt` with content `CANARY_MIGRATION_2026`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "Read /tmp/pi-test-canary.txt and reply with just its contents" --no-session`
- **Do**: Verify stdout contains `CANARY_MIGRATION_2026`
- **Do**: Clean up `/tmp/pi-test-canary.txt`
- **Definition of Done**: File read correctly, canary value in output
- **Sanity**: stdout contains CANARY_MIGRATION_2026

### Task 8: Pi edit tool works (modify file)
- **Skill chain**: `/test`
- **Do**: Create `/tmp/pi-test-edit.txt` with content `OLD_VALUE`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "Edit /tmp/pi-test-edit.txt replacing OLD_VALUE with NEW_VALUE. Reply with done." --no-session`
- **Do**: Verify file contents are `NEW_VALUE`
- **Do**: Clean up
- **Definition of Done**: File modified correctly
- **Sanity**: `cat /tmp/pi-test-edit.txt` == NEW_VALUE

---

## Wave 3: Extension & Skill System (the migration-critical path)

### Task 9: Skill-selector filters 237 → <50 skills
- **Skill chain**: `/test`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "/memory recall pi migration" --no-session` with `PI_DEBUG=skill-selector` env var
- **Do**: Check `~/.pi/assistant/skill_selector.jsonl` for the last entry
- **Do**: Verify `filtered_to` is < 50 and `total_available` is > 200
- **Definition of Done**: Skill selector actively filtering, not passing all 237
- **Sanity**: `tail -1 ~/.pi/assistant/skill_selector.jsonl | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['filtered_to'], '<', d['total_available'])"` shows filtered < total

### Task 10: Extensions load without crash
- **Skill chain**: `/test`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "Say OK" --no-session --no-tools` with stderr captured
- **Do**: Verify no extension load errors in stderr (grep for "extension.*error\|extension.*fail\|extension.*crash")
- **Definition of Done**: Zero extension errors, clean startup
- **Sanity**: No error lines in stderr

### Task 11: Curated .claude/skills preserved by skills-broadcast
- **Skill chain**: `/skills-broadcast`
- **Do**: Run `cd .pi/skills/skills-broadcast && bash run.sh status` from pi-mono root
- **Do**: Verify output contains `CURATED .claude/skills (28 skills)` for the home directory entry
- **Do**: Verify it does NOT say `COPY` or `NEW` for `.claude/skills`
- **Definition of Done**: skills-broadcast recognizes and preserves the curated directory
- **Sanity**: Output contains "CURATED"

---

## Wave 4: Blind Adversarial Tests via /test-lab

### Task 12: Generate blind tests for Pi CLI
- **Skill chain**: `/test-lab generate`
- **Do**: Run `/test-lab generate` against this task file (`01_PI_MIGRATION_TESTS.md`)
- **Do**: Hidden tests generated for behavioral domain
- **Definition of Done**: Test generation completes, hidden tests created
- **Sanity**: `/test-lab` reports test count > 0

### Task 13: Run blind tests
- **Skill chain**: `/test-lab run`
- **Do**: Run `/test-lab run packages/coding-agent --domain behavioral`
- **Do**: Review results — fix any failures
- **Definition of Done**: All blind tests pass or failures are documented with remediation
- **Sanity**: `/test-lab report` shows PASS or documented exceptions

---

## Wave 5: Session & Continuity

### Task 14: Session save and resume works
- **Skill chain**: `/test`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -p "Remember the code word ELEPHANT" --session-dir /tmp/pi-session-test`
- **Do**: Run `pi --provider anthropic --model claude-sonnet-4-20250514 -c -p "What was the code word?" --session-dir /tmp/pi-session-test`
- **Do**: Verify second run output contains "ELEPHANT"
- **Do**: Clean up `/tmp/pi-session-test`
- **Definition of Done**: Session persisted and resumed correctly
- **Sanity**: stdout contains ELEPHANT

### Task 15: Compaction doesn't lose context
- **Skill chain**: `/test`
- **Do**: Run Pi with a long prompt that exceeds context (concatenate a large file as context)
- **Do**: Verify Pi compacts and continues without crash
- **Definition of Done**: No crash, compaction triggered, response coherent
- **Sanity**: Exit code 0

---

## Capability Overlap

| Capability | Claude Code | Pi | Test |
|---|---|---|---|
| Read/Write/Edit/Bash | Built-in | Built-in | Tasks 7-8 |
| Skill loading | All 237 always | Filtered by skill-selector | Task 9 |
| Extensions | Hooks in settings.json | .pi/extensions/*.ts | Task 10 |
| Session persistence | Built-in | SessionManager | Task 14 |
| Compaction | Built-in | Built-in | Task 15 |
| Multi-provider | Claude only | Anthropic, Google, OpenAI, Ollama | Tasks 5-6 |
| No skill re-injection | BUG (re-injects per message) | Fixed (system prompt once) | E2E test #9 |

---

## Blind Evaluation

- **test-lab generates hidden tests** for Tasks 12-13
- **Agent never sees test source** — only PASS/FAIL with category
- **Human reviews** blind test results before approving migration
