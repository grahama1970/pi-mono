# Project Knowledge: pi-mono

**Last updated:** 2026-04-29 12:27 by agent
**Status:** Active development

## Current Understanding

- Project initialized, knowledge tracking started
- unique_project_knowledge_probe_20260422
- scillm Monitor UI polish lives in pi-mono packages/ux-lab, not the scillm proxy repo. On 2026-04-27 the #scillm dashboard added JSON key/value response previews, Stored/Fail/Skipped/Total/Calls metric pills, search focus glow, and stalled-state pulse/progress emphasis in packages/ux-lab/src/components/scillm/ScillmDashboard.tsx and scillm-dashboard.css. Live Playwright smoke confirmed the UI rendered without crash log. Full npm run check is currently blocked by unrelated existing ux-lab issues, including packages/ux-lab/src/hooks/useSpartaCollections.ts:439 unused qraCacheKey.
- The #scillm batch UX must synthesize a live `create-evidence-case-adjudication` orchestrator row from `/tmp/run_sparta_qra_relationship_adjudication_resume_*.sh` and sibling PID/log/report files; resumed C2C relationship adjudication loops do not update `~/.create_qras_manifest_state.json`, so the old `create-qras-manifest` checkpoint can be stale while `/scillm` still has live work.
- No-exceptions batch policy: ALL/ANY batch LLM work must follow the `scillm` SKILL.md and `best-practices-skills`; synchronous per-item `httpx` endpoint loops such as `relationship-manifest -> /create-evidence-case enable_llm=True` are forbidden. On 2026-04-27 the violating `create-evidence-case-adjudication` PID 3801357 was killed, the memory agent was notified as `memory_0c888bd7`, the scillm agent was notified as `scillm_d3c672dc`, and `create-qras/runtime/maintenance/batch_evidence_cases.py` was patched to fail closed before constructing a memory endpoint client.
- SPARTA Explorer Coverage URL QRA lane must not use all `sparta_urls` rows as SPARTA URL-QRA targets. `sparta_urls=6,854` is the broad normalized URL universe; the SPARTA URL-QRA scope follows preflight inventory: distinct `sparta_url_knowledge.url_id` where `topic` or `url` contains `sparta`. As of 2026-04-29 12:58 ET, that scope is 881 URLs, with 881 fetched-text OK, 881 control-mediated QRA covered, 0 direct URL-attributed standalone QRAs, and 0 URL QRA gaps.
- SPARTA Explorer Coverage State at a Glance reached all-pass source lanes on 2026-04-29 13:30 ET after correcting false scanner scope: Source/Embedding no longer counts all generic datalake chunks as SPARTA vector targets, Source Text/QRA follows create-qras terminal outcome semantics, and live API reports source text/QRA `pass/covered` plus source embedding `pass/reconciled`.

## Recent Decisions

| Date | Decision | Why |
|------|----------|-----|
| 2026-04-22 | Initialize project knowledge | Enable shared human/agent context |

## Open Questions

- [ ] What are the key architectural decisions?
- [ ] What are the known issues?

## Key Files

| File | Purpose |
|------|---------|
| PROJECT_KNOWLEDGE.md | Shared project knowledge |

## Infrastructure State

<!-- Auto-populated from /project-state --quick -->

## 2026-04-29 - SPARTA Coverage Continuous Agent Contract

- `monitor-sparta` is the continuous owner for Sparta Explorer Coverage: it should run scheduled audits plus push-triggered wakeups until actionable coverage is 100% or remaining work is explicitly human-blocked.
- Sparta Explorer Coverage now treats legacy QRAs and generic datalake chunks as reference inventories, not actionable missing coverage proof.
- SPARTA Corpora inventory is wired numerically: Relationships, URLs, URL Knowledge, and Datalake Chunks no longer display `not wired`; actionable gaps must be numeric and backed by a defensible target query.
- URL inventory currently shows 6,854/6,854 normalized URLs with fetch records, 6,139 HTTP-200 file fetches, and 43,398 URL-knowledge chunks across 5,867 URLs.
- Automatic remediation is safe for observe/read-only checks and approved idempotent fixes; destructive, ambiguous, high-cost, or schema-risk actions must create a human attention item with a concrete resume command.
- Runtime instance started as user-systemd transient observe-only services `sparta-coverage-observe-loop.service` and `sparta-coverage-observe-watchdog.service`; loop cadence is 300s and watchdog report is `/tmp/sparta_coverage_observe_loop_report.txt`.
- Prompt Health is now a lane subagent contract: scan prompt units continuously, apply `/best-practices-prompt`, generate `/review-prompt` payloads for non-mechanical rewrites, and only promote prompt edits after scanner/canary validation or human approval.
