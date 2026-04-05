# Pi-Mono Project Rules

<!-- Agent behavioral rules (git, security, simplicity) are in .pi/SYSTEM.md. This file covers project gates and conventions. -->

## Mandatory Gates

### /skills-ci scan (NON-NEGOTIABLE)

Any task that modifies files under `.pi/skills/` MUST run `/skills-ci` scan **before starting** and **after finishing**:

```bash
cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan
```

- **Before**: Establish baseline error count. Do not introduce new errors.
- **After**: Verify error count is equal to or lower than baseline. If higher, fix before stopping.
- This applies to ALL skill-related work: migrations, refactors, new skills, dependency changes, pyproject.toml edits, Python file edits.
- There are no exceptions. "I only changed 3 files" is not an exception.

### best-practices-* consultation

Before modifying any skill, read the relevant best-practices skill:
- Python changes → read `best-practices-python/SKILL.md`
- Skill structure changes → read `best-practices-skills/SKILL.md`
- React/KDE/StreamDeck → read the corresponding best-practices skill

Do not claim compliance without running the validator.

### Memory-First (NON-NEGOTIABLE)

All interactions query `/memory recall` BEFORE scanning codebases. Enforced by `memory-first.ts` and `skill-first-gate.ts` extensions.

### Quality gate

Tests must pass before stopping: `uv run pytest tests -q -x --tb=short`

## Python Conventions

- Logging: `from loguru import logger` (NEVER `import logging`)
- CLI: `typer` (NEVER `click` or `argparse`)
- HTTP: `httpx` (NEVER `import requests`)
- Import detection: use `ast` module, not regex
- Every `import` in source MUST have a matching `pyproject.toml` dependency
- Max 800 lines per Python file

## Blast Radius

When a task says "fix N skills," verify ALL skills — not just the named ones. Migrations have systemic blast radius. Run `/skills-ci` against the full estate.

## No Bespoke Hacks

If a helper skill already exists, use it. Never reimplement functionality that an existing skill provides. Check `/memory recall` and the skill manifest first.
