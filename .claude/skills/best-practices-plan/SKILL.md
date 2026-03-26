---
name: best-practices-plan
description: >
  Best practices for orchestration-ready task files. Enforces adversarial testing,
  skill chain syntax, definition-of-done requirements, gate definitions, persona
  routing, and /model directives. Referenced by /plan and /review-plan.
triggers:
  - plan best practices
  - task file conventions
  - plan conventions
  - plan rules
  - task file rules
  - how to write tasks
provides:
  - plan-conventions
  - plan-linting
composes:
  - memory
taxonomy:
  - precision
metadata:
  short-description: Conventions for orchestration-ready task files
  version: "1.0.0"
---

# Best Practices: Task Plans

Conventions for `0N_TASKS.md` files that `/plan` produces and `/orchestrate` executes.
`/review-plan` validates these rules. `/plan` MUST follow them. No exceptions.

## Rule 1: Adversarial Testing (NON-NEGOTIABLE)

Every implementation task MUST have a **blind test that the coding agent cannot see**.

This is not optional. This is not "nice to have". The coding agent that implements
the code MUST NEVER see the test source, test assertions, or expected values. The
agent sees ONLY the test output: pass/fail and failure descriptions.

### Why blind?

ImpossibleBench (arXiv:2510.20270) showed GPT-5 cheats 76% of the time when it can
see tests, but near-zero when tests are hidden. If the agent can read the test, it
optimizes for passing the test rather than actual correctness. **The test is an
adversary — an adversary you can see is no adversary at all.**

### What makes a test adversarial?

1. **The implementing agent CANNOT view or modify the test source**
2. **The test is generated/maintained by a separate process** (`/test-lab`)
3. **The agent sees ONLY pass/fail output** — no assertion code, no expected values
4. **The test can distinguish a correct implementation from a broken one**

```
# GOOD — blind: agent sees only output, not the test code
test-lab/run.sh run .pi/skills/stop-gates/ --domain skills

# GOOD — blind: hidden tests generated from the plan
test-lab/run.sh verify-task 3.1 .pi/extensions/ --max-retries 3

# GOOD — blind: sanity.sh is a pre-existing harness the agent doesn't write
./sanity.sh  # exits 0 or fails with description

# BAD — agent writes AND runs its own test (can game it)
uv run pytest tests/test_auth.py  # if agent wrote test_auth.py, it's not adversarial

# BAD — confirms existence, not correctness
ls .pi/extensions/stop-gates.ts  # File could be empty

# BAD — vague
"verify it works"
```

### Template

Every implementation task should include:

```markdown
- **Test**: `/test-lab verify-task <task-id> <target>` OR `sanity.sh` exits 0
- **Blind**: Agent cannot view test source — sees only pass/fail output
- **Catches**: <specific failure mode the test detects>
```

Example:
```markdown
- **Test**: `test-lab/run.sh verify-task 3.1 .pi/extensions/ --domain skills`
- **Blind**: Agent sees only "FAIL: quality gate did not block commit without tests"
- **Catches**: Missing quality gate — if stop-gates.ts is broken, commit goes through
```

## Rule 2: Skill Chain Syntax

Tasks SHOULD reference skills with `/skill-name` notation. Natural language without
explicit chains gets flagged for Tier 3 routing (slower, less reliable).

```
# GOOD — explicit chain, unambiguous
Use /memory recall then /assess findings then /plan next steps

# BAD — natural language, requires inference
Check memory and then assess what we found
```

When voice is the input channel, the human speaks `/slash` as "slash":
```
Brandon, slash assess your CMMC posture
```

## Rule 3: Definition of Done

Every implementation task MUST have a DoD with:

1. A **runnable command** (not prose)
2. A **concrete assertion** (not "it works")
3. An **exit code check** (exits 0, or specific output)

```
# GOOD
- **Definition of Done**: `uv run pytest tests/test_gate.py -x` exits 0

# GOOD
- **Definition of Done**: `./run.sh review plan.md --json | jq .fail` returns 0

# BAD
- **Definition of Done**: Verify the gate works correctly

# BAD
- **Definition of Done**: Feature is implemented
```

## Rule 4: Gate Definitions

Every implementation task MUST have a Gate field — what must be true before the
task can be considered complete.

```
- **Gate**: `echo "git commit" | pi -p 2>&1 | grep -q "BLOCKED"` — commit blocked without tests
```

## Rule 5: Persona Routing

Tasks involving persona agents MUST specify the persona:

```
# GOOD
Brandon /assess CMMC posture
@brandon-bailey: assess CMMC posture

# BAD
Have someone check CMMC
```

## Rule 6: `/model` Directive and `with <model>` Routing

Tasks with cost sensitivity SHOULD specify a model. Use `with <model>` syntax for per-step routing:

```
# GOOD — per-step model routing
- skill: /assess with codex
- skill: /dogpile with claude
- skill: /create-react-designs with gemini

# GOOD — command-level default
/orchestrate run tasks.md with codex

# GOOD — cost-sensitive inline directive
/model haiku
Use /memory recall to check for prior solutions

# OK (defaults to session model)
Use /memory recall to check for prior solutions
```

### Model Selection Guidance

| Model | Best For |
|-------|----------|
| `codex` | Debugging, complex reasoning, code generation |
| `gemini` | UI design, visual tasks, multimodal |
| `claude` | Simple coordination, cheap/fast steps |
| `deepseek` | Batch extraction, cost-sensitive LLM work |
| `pi` | Full orchestration features (parallel, pause/resume) |

### Precedence

1. Step-level `with <model>` — highest
2. Command-level `with <model>` — default for all steps
3. Auto-detect — fallback

## Rule 7: Skill Overlap Check

Tasks MUST NOT propose building functionality that an existing skill provides.
Before writing a task, check `skills-manifest.json` or `/memory recall "skill:<capability>"`.

```
# BAD — /fetcher already does this
## Task 3: Build a web page scraper

# GOOD — uses existing skill
## Task 3: Use /fetcher to extract content from target URLs
```

## Rule 8: Phase Ordering

- Blocking tasks MUST come before dependent tasks
- Parallelizable tasks SHOULD be grouped
- Every phase SHOULD have a time estimate

## Rule 9: No Exceptions

These rules apply to ALL task files consumed by `/orchestrate`. There are no
"quick and dirty" exceptions. A plan without adversarial tests is a plan that
wastes agent time on broken implementations.

The cost of writing a test is 30 seconds. The cost of a broken implementation
cascading through 5 dependent tasks is hours.

## Example: Well-Formed Task

```markdown
### Task 3.1: Create stop-gates.ts extension

- **What**: Block `git commit` if tests haven't passed this session
- **Why**: Claude Code's quality-gate.sh Stop hook needs a Pi equivalent
- **Implementation**:
  1. Listen on `tool_result` for pytest/npm test success
  2. Listen on `tool_call` for `git commit` — block if no test passed
  3. Register `/quality-gate` diagnostic command
- **File**: `.pi/extensions/stop-gates.ts`
- **Test**: `echo "run git commit -m test" | pi -p 2>&1 | grep -q "BLOCKED"`
- **Adversarial**: Catches missing quality gate — commit goes through without tests
- **Gate**: Agent cannot commit if tests haven't passed this session
- **Definition of Done**: `echo "run git commit" | pi -p 2>&1 | grep -q "BLOCKED"` exits 0
```

## Integration

| Skill | Relationship |
|-------|-------------|
| `/plan` | MUST consult this skill when generating task files |
| `/review-plan` | VALIDATES these rules against task files |
| `/orchestrate` | REFUSES to execute task files that fail `/review-plan` |
| `/best-practices-skills` | Complementary: this is for plans, that is for skills |
