# Pi-Mono

Python: loguru, typer, httpx. Never logging, click, argparse, requests.

Skills live in `.pi/skills/`. Read SKILL.md before calling any skill.

Use existing skills. Don't rebuild what exists.

## Resume after /clear

When the user says "resume", "continue", "proceed", or "where were we":
run `.pi/skills/checkpoint/run.sh resume` and follow the DO THIS NEXT instruction.
This is how context is restored after /clear — the checkpoint has ground truth from git + ArangoDB.
