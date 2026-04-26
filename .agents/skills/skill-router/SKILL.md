---
name: skill-router
description: "TRIGGER: $skill-router, skill lookup, unknown skill, Codex skill routing. Resolve project-local and canonical skills before acting."
---

> managed-by: skills-broadcast

# Skill Router

Codex-facing router for pi-mono.

Project root: /home/graham/workspace/experiments/pi-mono
Canonical skills: /home/graham/workspace/experiments/agent-skills/skills

When the user invokes a skill directly, asks for an unknown skill, or mentions
Codex skill discovery:

1. Read `references/skills_manifest.md`.
2. Find the exact skill name, alias, or nearest canonical skill path.
3. Read the target `SKILL.md` before acting.
4. Prefer explicit Codex mentions such as `$skill-name` when UI recognition matters.
5. State the loaded skill path before making changes.

This router is intentionally small. Do not copy full skill instructions here.
