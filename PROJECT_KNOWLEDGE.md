# Project Knowledge: pi-mono

**Last updated:** 2026-04-29 12:27 by agent
**Status:** Active development

## Current Understanding

- Project initialized, knowledge tracking started
- unique_project_knowledge_probe_20260422
- scillm Monitor UI polish lives in pi-mono packages/ux-lab, not the scillm proxy repo. On 2026-04-27 the #scillm dashboard added JSON key/value response previews, Stored/Fail/Skipped/Total/Calls metric pills, search focus glow, and stalled-state pulse/progress emphasis in packages/ux-lab/src/components/scillm/ScillmDashboard.tsx and scillm-dashboard.css. Live Playwright smoke confirmed the UI rendered without crash log. Full npm run check is currently blocked by unrelated existing ux-lab issues, including packages/ux-lab/src/hooks/useSpartaCollections.ts:439 unused qraCacheKey.
- The #scillm batch UX must synthesize a live `create-evidence-case-adjudication` orchestrator row from `/tmp/run_sparta_qra_relationship_adjudication_resume_*.sh` and sibling PID/log/report files; resumed C2C relationship adjudication loops do not update `~/.create_qras_manifest_state.json`, so the old `create-qras-manifest` checkpoint can be stale while `/scillm` still has live work.
- No-exceptions batch policy: ALL/ANY batch LLM work must follow the `scillm` SKILL.md and `best-practices-skills`; synchronous per-item `httpx` endpoint loops such as `relationship-manifest -> /create-evidence-case enable_llm=True` are forbidden. On 2026-04-27 the violating `create-evidence-case-adjudication` PID 3801357 was killed, the memory agent was notified as `memory_0c888bd7`, the scillm agent was notified as `scillm_d3c672dc`, and `create-qras/runtime/maintenance/batch_evidence_cases.py` was patched to fail closed before constructing a memory endpoint client.
- SPARTA Explorer Coverage URL QRA lane now treats direct `/create-qras` standalone URL QRAs (`source_doc`/`source_url`/`url_id`) and control-mediated QRAs through `sparta_url_knowledge.control_ids` as valid coverage. As of 2026-04-29 12:27 ET, the live collections have 6,854 valid URLs, 5,862 text-backed URLs, 5,779 control-mediated URL QRA coverage, 0 direct URL-attributed standalone QRAs, and 83 URL QRA gaps.

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
