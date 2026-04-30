# Targeted Follow-up Review: /ask Runtime Hardening Fixes

## Reviewer Instructions

Review this as a focused follow-up code review for Web GPT. Only assess whether the prior findings were fixed without introducing new runtime regressions.

## Decision Needed

Does commit `9ea7a5c2` adequately address the prior Web GPT findings for prune safety, `--resume` semantics, and context-policy CLI exposure?

## Pushed Code

- Repository: https://github.com/grahama1970/agent-skills
- Main branch: https://github.com/grahama1970/agent-skills/tree/main
- Fix commit under review: `9ea7a5c2`
- Previous reviewed commit: `a6634764`
- Compare URL: https://github.com/grahama1970/agent-skills/compare/a6634764...9ea7a5c2

## Prior Findings Being Rechecked

1. `prune_runs()` used directory mtime and could delete active or recently updated runs.
2. `prune_runs()` did not skip non-terminal states by default.
3. `--resume` reused a run directory but overwrote request metadata instead of preserving original request semantics.
4. Context-policy flags had disappeared from the main `/ask` CLI path.

## Expected Safety Contract

1. Prune only validated `ask.runtime.v1` run dirs in terminal states.
2. Prune age must use `status.updated_at`, falling back to status-file mtime, never parent directory mtime.
3. Running/created runs must be kept regardless of directory mtime.
4. Resume must preserve original request JSON and reject conflicting `command`, `question`, or `scope`.
5. Main `/ask` CLI must expose context-policy controls and include them in dry-run/runtime request payloads.

## Non-goals

- Do not re-review the whole runtime parity patch.
- Do not review generated artifacts.
- Do not review unrelated skills.

## Validation Already Run

- `python3 -m py_compile skills/ask/src/ask/run_state.py skills/ask/src/ask/ask.py`
- `uv run --project skills/ask pytest skills/ask/tests/test_run_state_protocol.py -q` passed: 39 tests.
- Broader adjacent runtime/deep-review tests passed: 55 tests.
- `cd skills/ask && ./sanity.sh` passed.
- `git diff --check` passed.

## Selected Review Files

- `skills/ask/src/ask/run_state.py`
- `skills/ask/src/ask/ask.py`
- `skills/ask/tests/test_run_state_protocol.py`

## Diff Stat

```text
 skills/ask/src/ask/ask.py                   | 34 +++++++++-
 skills/ask/src/ask/run_state.py             | 76 ++++++++++++++++++----
 skills/ask/tests/test_run_state_protocol.py | 99 +++++++++++++++++++++++++++--
 3 files changed, 193 insertions(+), 16 deletions(-)
```

## Selected Diff

```diff
diff --git a/skills/ask/src/ask/ask.py b/skills/ask/src/ask/ask.py
index 1c146b63..fae36fa0 100644
--- a/skills/ask/src/ask/ask.py
+++ b/skills/ask/src/ask/ask.py
@@ -42,7 +42,7 @@ from .ask_routing import (
 )
 from .reviewer_specs import focus_from_reviewer_specs, load_selected_reviewer_specs
 from .review_protocols import is_date_sensitive_question
-from .run_state import AskRunState, NoopRunState, make_run_id
+from .run_state import AskRunState, NoopRunState, build_context_policy, make_run_id
 from .session_writer import SessionWriter
 from .skills_exec import run_skill, parse_memory_output, run_memory_recall
 from .persona_routing import (
@@ -607,6 +607,10 @@ def main(
     deep_review_fallback_policy: str = typer.Option("fail_closed", help="Deep-review downgrade policy: fail_closed or warn"),
     deep_review_persist: str = typer.Option("summary", help="Deep-review persistence: summary or full"),
     deep_review_output_root: str = typer.Option(".ask_artifacts/deep-review", help="Deep-review artifact directory"),
+    review_context: str = typer.Option("fresh", "--review-context", help="Context policy: fresh or inherited"),
+    inherit_memory: str = typer.Option("summary", "--inherit-memory", help="Context policy memory inheritance: none, summary, or full"),
+    inherit_skills: str = typer.Option("selected", "--inherit-skills", help="Context policy skill inheritance: none, selected, or all"),
+    inherit_project_context: str = typer.Option("no", "--inherit-project-context", help="Context policy project inheritance: no, summary, or full"),
     chain: Optional[str] = typer.Option(None, "--chain", help="Saved review chain spec name or path"),
     reviewer_specs: Optional[list[str]] = typer.Option(None, "--reviewer-spec", help="Reviewer spec name or path (repeatable)"),
     dry_run: bool = typer.Option(False, "--dry-run", help="Preview execution spec and risk analysis without mutation"),
@@ -732,6 +736,26 @@ def main(
             "Deep-review persistence must be summary or full.",
             param_hint="--deep-review-persist",
         )
+    if review_context not in {"fresh", "inherited"}:
+        raise typer.BadParameter(
+            "Review context must be fresh or inherited.",
+            param_hint="--review-context",
+        )
+    if inherit_memory not in {"none", "summary", "full"}:
+        raise typer.BadParameter(
+            "Memory inheritance must be none, summary, or full.",
+            param_hint="--inherit-memory",
+        )
+    if inherit_skills not in {"none", "selected", "all"}:
+        raise typer.BadParameter(
+            "Skill inheritance must be none, selected, or all.",
+            param_hint="--inherit-skills",
+        )
+    if inherit_project_context not in {"no", "summary", "full"}:
+        raise typer.BadParameter(
+            "Project context inheritance must be no, summary, or full.",
+            param_hint="--inherit-project-context",
+        )
     if oracle and raw:
         raise typer.BadParameter(
             "Oracle synthesis needs retrieved context. Remove --raw, or run without --oracle.",
@@ -791,6 +815,13 @@ def main(
         )
 
     run_id = ask_id or make_run_id(question)
+    context_policy = build_context_policy(
+        "deep-review" if deep_review else "ask",
+        review_context=review_context,
+        inherit_memory=inherit_memory,
+        inherit_skills=inherit_skills,
+        inherit_project_context=inherit_project_context,
+    )
     request_payload = {
         "command": "ask",
         "question": question,
@@ -827,6 +858,7 @@ def main(
         "deep_reviewers": deep_reviewers,
         "deep_review_focus": deep_review_focus,
         "deep_review_output_root": deep_review_output_root,
+        "context_policy": context_policy,
         "chain": chain,
         "reviewer_specs": reviewer_specs or [],
         "suggested_personas_count": 0,
diff --git a/skills/ask/src/ask/run_state.py b/skills/ask/src/ask/run_state.py
index ef8247b7..8950402a 100644
--- a/skills/ask/src/ask/run_state.py
+++ b/skills/ask/src/ask/run_state.py
@@ -254,14 +254,18 @@ class AskRunState:
         self.events_path = self.run_dir / f"{self.ask_id}.events.jsonl"
         self.started_at = datetime.now(timezone.utc).isoformat()
         self.state = "created"
+        self.resume = resume
         if resume and overwrite:
             raise ValueError("Use either resume or overwrite, not both")
         if resume:
             if not self.run_dir.exists():
                 raise FileNotFoundError(f"Run does not exist for resume: {self.run_dir}")
-            state = self._existing_status_state()
+            existing_status = self._existing_status()
+            state = existing_status.get("state")
             if state not in RESUMABLE_STATES:
                 raise FileExistsError(f"Run is not resumable: {self.run_dir} state={state or 'unknown'}")
+            self.started_at = str(existing_status.get("started_at") or self.started_at)
+            self.state = str(state)
         if self.run_dir.exists() and not overwrite and not resume:
             raise FileExistsError(f"Run already exists: {self.run_dir}")
         if overwrite and self.run_dir.exists():
@@ -280,6 +284,19 @@ class AskRunState:
         }
 
     def write_request(self, payload: dict[str, Any]) -> None:
+        if self.resume and self.request_path.exists():
+            existing_request = self._read_existing_request()
+            conflicts = {
+                key: (existing_request.get(key), payload.get(key))
+                for key in ("command", "question", "scope")
+                if existing_request.get(key) != payload.get(key)
+            }
+            if conflicts:
+                raise ValueError(f"Resume request conflicts with existing run request: {conflicts}")
+            current_status = self._read_current_status()
+            self.event("resumed", current_step=current_status.get("current_step", ""))
+            self.update("running", request=existing_request, resumed=True, current_step=current_status.get("current_step", ""))
+            return
         request = {
             "ask_id": self.ask_id,
             "created_at": self.started_at,
@@ -399,14 +416,25 @@ class AskRunState:
             }
 
     def _existing_status_state(self) -> str | None:
+        payload = self._existing_status()
+        state = payload.get("state")
+        return str(state) if state else None
+
+    def _existing_status(self) -> dict[str, Any]:
         if not self.status_path.exists():
-            return None
+            return {}
         try:
             payload = json.loads(self.status_path.read_text())
         except (OSError, json.JSONDecodeError):
-            return None
-        state = payload.get("state")
-        return str(state) if state else None
+            return {}
+        return payload if isinstance(payload, dict) else {}
+
+    def _read_existing_request(self) -> dict[str, Any]:
+        try:
+            payload = json.loads(self.request_path.read_text())
+        except (OSError, json.JSONDecodeError):
+            return {}
+        return payload if isinstance(payload, dict) else {}
 
     def _append_index(self, status_payload: dict[str, Any]) -> None:
         entry = {
@@ -647,11 +675,34 @@ def _validated_run_status(run_dir: Path) -> dict[str, Any] | None:
             return None
     except OSError:
         return None
+    payload["_status_path"] = str(status_path)
     return payload
 
 
-def prune_runs(output_root: Path | str | None = None, older_than_days: int = 14, dry_run: bool = False) -> dict[str, Any]:
+def _parse_status_timestamp(value: Any) -> float | None:
+    if not value:
+        return None
+    try:
+        text = str(value).replace("Z", "+00:00")
+        parsed = datetime.fromisoformat(text)
+        if parsed.tzinfo is None:
+            parsed = parsed.replace(tzinfo=timezone.utc)
+        return parsed.timestamp()
+    except (TypeError, ValueError):
+        return None
+
+
+def _run_age_basis(status: dict[str, Any], run_dir: Path) -> float | None:
+    parsed = _parse_status_timestamp(status.get("updated_at"))
+    if parsed is not None:
+        return parsed
+    try:
+        return (run_dir / f"{run_dir.name}.status.json").stat().st_mtime
+    except OSError:
+        return None
 
+
+def prune_runs(output_root: Path | str | None = None, older_than_days: int = 14, dry_run: bool = False) -> dict[str, Any]:
     root = Path(output_root).expanduser() if output_root else default_run_root()
     root = root.resolve()
     cutoff = time.time() - older_than_days * 24 * 60 * 60
@@ -668,15 +719,18 @@ def prune_runs(output_root: Path | str | None = None, older_than_days: int = 14,
         if resolved_parent != root:
             kept.append(str(run_dir))
             continue
-        if _validated_run_status(run_dir) is None:
+        status = _validated_run_status(run_dir)
+        if status is None:
             kept.append(str(run_dir))
             continue
-        try:
-            mtime = run_dir.stat().st_mtime
-        except OSError:
+        if status.get("state") not in TERMINAL_STATES:
+            kept.append(str(run_dir))
+            continue
+        age_basis = _run_age_basis(status, run_dir)
+        if age_basis is None:
             kept.append(str(run_dir))
             continue
-        if mtime >= cutoff:
+        if age_basis >= cutoff:
             kept.append(str(run_dir))
             continue
         removed.append(str(run_dir))
diff --git a/skills/ask/tests/test_run_state_protocol.py b/skills/ask/tests/test_run_state_protocol.py
index c723b31b..7c55c5db 100644
--- a/skills/ask/tests/test_run_state_protocol.py
+++ b/skills/ask/tests/test_run_state_protocol.py
@@ -3,6 +3,7 @@
 import json
 import os
 import time
+from datetime import datetime, timezone
 
 import pytest
 from typer.testing import CliRunner
@@ -18,6 +19,15 @@ from ask.runtime_schema import validate_run_dir, validate_runtime_tree
 from ask.run_state import AskRunState, make_run_id, list_runs, prune_runs, read_status, watch_status
 
 
+def age_run_status(run: AskRunState, days: int = 30) -> None:
+    old_time = time.time() - days * 24 * 60 * 60
+    payload = json.loads(run.status_path.read_text())
+    payload["updated_at"] = datetime.fromtimestamp(old_time, tz=timezone.utc).isoformat()
+    run.status_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
+    os.utime(run.status_path, (old_time, old_time))
+    os.utime(run.run_dir, (old_time, old_time))
+
+
 def test_run_state_writes_request_status_and_events(tmp_path):
     run = AskRunState("protocol-test", output_root=tmp_path)
     run.write_request({"question": "what changed?", "scope": "ask"})
@@ -184,8 +194,7 @@ def test_prune_runs_removes_old_run_dirs(tmp_path):
     new = AskRunState("new-run", output_root=tmp_path)
     new.write_request({"question": "new"})
     new.finish({"question": "new", "items": []})
-    old_time = time.time() - 30 * 24 * 60 * 60
-    os.utime(old.run_dir, (old_time, old_time))
+    age_run_status(old)
 
     preview = prune_runs(output_root=tmp_path, older_than_days=14, dry_run=True)
     result = prune_runs(output_root=tmp_path, older_than_days=14)
@@ -196,6 +205,34 @@ def test_prune_runs_removes_old_run_dirs(tmp_path):
     assert new.run_dir.exists()
 
 
+def test_prune_runs_keeps_old_running_run(tmp_path):
+    run = AskRunState("old-running", output_root=tmp_path)
+    run.write_request({"question": "still running"})
+    run.update("running", current_step="oracle")
+    old_time = time.time() - 30 * 24 * 60 * 60
+    os.utime(run.run_dir, (old_time, old_time))
+
+    result = prune_runs(output_root=tmp_path, older_than_days=14)
+
+    assert run.run_dir.exists()
+    assert str(run.run_dir) in result["kept"]
+    assert str(run.run_dir) not in result["removed"]
+
+
+def test_prune_runs_uses_status_updated_at_not_directory_mtime(tmp_path):
+    run = AskRunState("recent-status-old-dir", output_root=tmp_path)
+    run.write_request({"question": "recent status"})
+    run.finish({"question": "recent status", "items": []})
+    old_time = time.time() - 30 * 24 * 60 * 60
+    os.utime(run.run_dir, (old_time, old_time))
+
+    result = prune_runs(output_root=tmp_path, older_than_days=14)
+
+    assert run.run_dir.exists()
+    assert str(run.run_dir) in result["kept"]
+    assert str(run.run_dir) not in result["removed"]
+
+
 def test_prune_runs_keeps_unrecognized_old_dirs(tmp_path):
     unrelated = tmp_path / "unrelated-old-dir"
     unrelated.mkdir()
@@ -251,8 +288,7 @@ def test_cli_status_prune_dry_run_lists_old_run_dirs(tmp_path):
     old = AskRunState("old-cli-run", output_root=tmp_path)
     old.write_request({"question": "old"})
     old.finish({"question": "old", "items": []})
-    old_time = time.time() - 30 * 24 * 60 * 60
-    os.utime(old.run_dir, (old_time, old_time))
+    age_run_status(old)
 
     result = CliRunner().invoke(
         status_module.app,
@@ -305,6 +341,30 @@ def test_resume_accepts_running_state(tmp_path):
     assert resumed.ask_id == "running-id"
 
 
+def test_resume_does_not_overwrite_original_request(tmp_path):
+    first = AskRunState("resume-id", output_root=tmp_path)
+    first.write_request({"command": "ask", "question": "original", "scope": "ask"})
+    first.update("running", current_step="memory_recall")
+
+    resumed = AskRunState("resume-id", output_root=tmp_path, resume=True)
+    resumed.write_request({"command": "ask", "question": "original", "scope": "ask"})
+
+    request = json.loads(first.request_path.read_text())
+    events = [json.loads(line)["event"] for line in first.events_path.read_text().splitlines()]
+    assert request["question"] == "original"
+    assert "resumed" in events
+
+
+def test_resume_rejects_conflicting_request(tmp_path):
+    first = AskRunState("resume-conflict", output_root=tmp_path)
+    first.write_request({"command": "ask", "question": "original", "scope": "ask"})
+    first.update("running", current_step="memory_recall")
+
+    resumed = AskRunState("resume-conflict", output_root=tmp_path, resume=True)
+    with pytest.raises(ValueError):
+        resumed.write_request({"command": "ask", "question": "changed", "scope": "ask"})
+
+
 def test_make_run_id_same_question_does_not_collide():
     assert make_run_id("same question") != make_run_id("same question")
 
@@ -419,6 +479,37 @@ def test_cli_ask_chain_and_reviewer_specs_feed_dry_run_options(tmp_path):
     assert "secret-persistence" in options["deep_review_focus"]
 
 
+def test_cli_ask_dry_run_includes_context_policy(tmp_path):
+    result = CliRunner().invoke(
+        ask_module.app,
+        [
+            "review",
+            "runtime",
+            "--dry-run",
+            "--review-context",
+            "inherited",
+            "--inherit-memory",
+            "full",
+            "--inherit-skills",
+            "all",
+            "--inherit-project-context",
+            "summary",
+            "--run-output-root",
+            str(tmp_path),
+            "--json",
+        ],
+    )
+
+    assert result.exit_code == 0
+    payload = json.loads(result.stdout)
+    policy = payload["options"]["context_policy"]
+    assert policy["review_context"] == "inherited"
+    assert policy["inherit_memory"] == "full"
+    assert policy["inherit_skills"] == "all"
+    assert policy["inherit_project_context"] == "summary"
+    assert policy["memory_as_evidence"] is True
+
+
 def test_cli_real_non_oracle_ask_smoke_writes_granular_events(monkeypatch, tmp_path):
     def fake_recall(question, scope, k):
         return {
```

## Required Output Format

# Merge-blocking findings

## High severity

### H1. <title>
- Evidence:
- Impact:
- Exact fix:
- Test that should fail before the fix:

## Medium severity

Only include if it should block merge or materially affect runtime safety.

# Important test gaps

List only tests required before merge.

# Merge recommendation

Use exactly one:
- SAFE_TO_MERGE
- SAFE_WITH_CONDITIONS
- CHANGES_REQUESTED
- NOT_SAFE
