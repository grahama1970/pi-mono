# Pi-Mono

Python: loguru, typer, httpx. Never logging, click, argparse, requests.

Skills live in `.pi/skills/`. Read SKILL.md before calling any skill.

Use existing skills. Don't rebuild what exists.

## Checkpoint and Resume

`/checkpoint sparta` — save. Agent fills in -t, --grade, --resume from context:
```
.pi/skills/checkpoint/run.sh save -s sparta -t "<topic>" --grade <grade> --resume "<next step>"
```

`/checkpoint resume sparta` — after `/clear`, restore context:
```
.pi/skills/checkpoint/run.sh resume -s sparta
```
Follow the DO THIS NEXT instruction. Without a session name, resumes latest.

`/clear` beats `/compact` — ground truth from git + ArangoDB, no compounding drift.
