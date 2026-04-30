# Final Follow-up Review: /ask Resume Integrity and Deep Review Context

## Decision Needed

Do the final fixes in `cff169ed` close the remaining SAFE_WITH_CONDITIONS items from Web GPT?

## Pushed Code

- Repository: https://github.com/grahama1970/agent-skills
- Main branch: https://github.com/grahama1970/agent-skills/tree/main
- Fix commit under review: `cff169ed`
- Previous commit: `9ea7a5c2`
- Compare URL: https://github.com/grahama1970/agent-skills/compare/9ea7a5c2...cff169ed

## Prior Findings Being Rechecked

1. `--resume` must fail if original request JSON is missing.
2. `--resume` must fail if original request JSON is malformed.
3. Deep review must never treat inherited memory as evidence, even with `--inherit-memory full`.
4. Prune should prove malformed `status.updated_at` falls back to status-file mtime.

## Expected Contract

- Resume preserves one-run-one-request integrity and refuses corrupted run directories.
- Deep-review context policy records memory as context only, not evidence.
- Prune age fallback remains deterministic when `updated_at` is malformed.

## Validation Already Run

- `python3 -m py_compile skills/ask/src/ask/run_state.py`
- `uv run --project skills/ask pytest skills/ask/tests/test_run_state_protocol.py -q` passed: 43 tests.
- Broader adjacent runtime/deep-review tests passed: 59 tests.
- `cd skills/ask && ./sanity.sh` passed.
- `git diff --check` passed.

## Diff Stat

```text
 skills/ask/src/ask/run_state.py             | 11 ++++-
 skills/ask/tests/test_run_state_protocol.py | 66 +++++++++++++++++++++++++++++
 2 files changed, 75 insertions(+), 2 deletions(-)
```

## Selected Diff

```diff
diff --git a/skills/ask/src/ask/run_state.py b/skills/ask/src/ask/run_state.py
index 8950402a..ca8341ec 100644
--- a/skills/ask/src/ask/run_state.py
+++ b/skills/ask/src/ask/run_state.py
@@ -207,7 +207,10 @@ def build_context_policy(
     inherit_project_context: str = "no",
     memory_as_evidence: bool | None = None,
 ) -> dict[str, Any]:
-    use_memory_as_evidence = bool(memory_as_evidence) if memory_as_evidence is not None else inherit_memory == "full"
+    if mode == "deep-review":
+        use_memory_as_evidence = False
+    else:
+        use_memory_as_evidence = bool(memory_as_evidence) if memory_as_evidence is not None else inherit_memory == "full"
     return {
         "mode": mode,
         "review_context": review_context,
@@ -284,8 +287,12 @@ class AskRunState:
         }
 
     def write_request(self, payload: dict[str, Any]) -> None:
-        if self.resume and self.request_path.exists():
+        if self.resume:
+            if not self.request_path.exists():
+                raise FileNotFoundError(f"Cannot resume run without original request: {self.request_path}")
             existing_request = self._read_existing_request()
+            if not existing_request:
+                raise ValueError(f"Cannot resume run with missing or malformed original request: {self.request_path}")
             conflicts = {
                 key: (existing_request.get(key), payload.get(key))
                 for key in ("command", "question", "scope")
diff --git a/skills/ask/tests/test_run_state_protocol.py b/skills/ask/tests/test_run_state_protocol.py
index 7c55c5db..41247146 100644
--- a/skills/ask/tests/test_run_state_protocol.py
+++ b/skills/ask/tests/test_run_state_protocol.py
@@ -233,6 +233,22 @@ def test_prune_runs_uses_status_updated_at_not_directory_mtime(tmp_path):
     assert str(run.run_dir) not in result["removed"]
 
 
+def test_prune_runs_falls_back_to_status_file_mtime_for_malformed_updated_at(tmp_path):
+    run = AskRunState("malformed-updated-at", output_root=tmp_path)
+    run.write_request({"question": "old status file"})
+    run.finish({"question": "old status file", "items": []})
+    old_time = time.time() - 30 * 24 * 60 * 60
+    payload = json.loads(run.status_path.read_text())
+    payload["updated_at"] = "not-a-timestamp"
+    run.status_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
+    os.utime(run.status_path, (old_time, old_time))
+
+    result = prune_runs(output_root=tmp_path, older_than_days=14)
+
+    assert str(run.run_dir) in result["removed"]
+    assert not run.run_dir.exists()
+
+
 def test_prune_runs_keeps_unrecognized_old_dirs(tmp_path):
     unrelated = tmp_path / "unrelated-old-dir"
     unrelated.mkdir()
@@ -365,6 +381,30 @@ def test_resume_rejects_conflicting_request(tmp_path):
         resumed.write_request({"command": "ask", "question": "changed", "scope": "ask"})
 
 
+def test_resume_rejects_missing_original_request(tmp_path):
+    first = AskRunState("missing-request", output_root=tmp_path)
+    first.write_request({"command": "ask", "question": "original", "scope": "ask"})
+    first.update("running", current_step="memory_recall")
+    first.request_path.unlink()
+
+    resumed = AskRunState("missing-request", output_root=tmp_path, resume=True)
+
+    with pytest.raises(FileNotFoundError):
+        resumed.write_request({"command": "ask", "question": "original", "scope": "ask"})
+
+
+def test_resume_rejects_malformed_original_request(tmp_path):
+    first = AskRunState("malformed-request", output_root=tmp_path)
+    first.write_request({"command": "ask", "question": "original", "scope": "ask"})
+    first.update("running", current_step="memory_recall")
+    first.request_path.write_text("{not-json")
+
+    resumed = AskRunState("malformed-request", output_root=tmp_path, resume=True)
+
+    with pytest.raises(ValueError):
+        resumed.write_request({"command": "ask", "question": "original", "scope": "ask"})
+
+
 def test_make_run_id_same_question_does_not_collide():
     assert make_run_id("same question") != make_run_id("same question")
 
@@ -510,6 +550,32 @@ def test_cli_ask_dry_run_includes_context_policy(tmp_path):
     assert policy["memory_as_evidence"] is True
 
 
+def test_deep_review_context_policy_never_treats_memory_as_evidence(tmp_path):
+    result = CliRunner().invoke(
+        ask_module.app,
+        [
+            "review",
+            "runtime",
+            "--deep-review",
+            "--deep-review-target",
+            "skills/ask/src/ask/run_state.py",
+            "--dry-run",
+            "--inherit-memory",
+            "full",
+            "--run-output-root",
+            str(tmp_path),
+            "--json",
+        ],
+    )
+
+    assert result.exit_code == 0
+    payload = json.loads(result.stdout)
+    policy = payload["options"]["context_policy"]
+    assert policy["mode"] == "deep-review"
+    assert policy["inherit_memory"] == "full"
+    assert policy["memory_as_evidence"] is False
+
+
 def test_cli_real_non_oracle_ask_smoke_writes_granular_events(monkeypatch, tmp_path):
     def fake_recall(question, scope, k):
         return {
```

## Required Output Format

# Merge-blocking findings

List only true blockers.

# Important test gaps

List only tests required before merge.

# Merge recommendation

Use exactly one: SAFE_TO_MERGE, SAFE_WITH_CONDITIONS, CHANGES_REQUESTED, NOT_SAFE
