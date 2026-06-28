# Project Knowledge: pi-mono

**Last updated:** 2026-06-27 15:55 by agent
**Status:** Active development

## Current Understanding

- Project initialized, knowledge tracking started
- unique_project_knowledge_probe_20260422
- scillm Monitor UI polish lives in pi-mono packages/ux-lab, not the scillm proxy repo. On 2026-04-27 the #scillm dashboard added JSON key/value response previews, Stored/Fail/Skipped/Total/Calls metric pills, search focus glow, and stalled-state pulse/progress emphasis in packages/ux-lab/src/components/scillm/ScillmDashboard.tsx and scillm-dashboard.css. Live Playwright smoke confirmed the UI rendered without crash log. Full npm run check is currently blocked by unrelated existing ux-lab issues, including packages/ux-lab/src/hooks/useSpartaCollections.ts:439 unused qraCacheKey.
- The #scillm batch UX must synthesize a live `create-evidence-case-adjudication` orchestrator row from `/tmp/run_sparta_qra_relationship_adjudication_resume_*.sh` and sibling PID/log/report files; resumed C2C relationship adjudication loops do not update `~/.create_qras_manifest_state.json`, so the old `create-qras-manifest` checkpoint can be stale while `/scillm` still has live work.
- No-exceptions batch policy: ALL/ANY batch LLM work must follow the `scillm` SKILL.md and `best-practices-skills`; synchronous per-item `httpx` endpoint loops such as `relationship-manifest -> /create-evidence-case enable_llm=True` are forbidden. On 2026-04-27 the violating `create-evidence-case-adjudication` PID 3801357 was killed, the memory agent was notified as `memory_0c888bd7`, the scillm agent was notified as `scillm_d3c672dc`, and `create-qras/runtime/maintenance/batch_evidence_cases.py` was patched to fail closed before constructing a memory endpoint client.
- SPARTA Explorer Coverage URL QRA lane must not use all `sparta_urls` rows as SPARTA URL-QRA targets. `sparta_urls=6,854` is the broad normalized URL universe; the SPARTA URL-QRA scope follows preflight inventory: distinct `sparta_url_knowledge.url_id` where `topic` or `url` contains `sparta`. As of 2026-04-29 12:58 ET, that scope is 881 URLs, with 881 fetched-text OK, 881 control-mediated QRA covered, 0 direct URL-attributed standalone QRAs, and 0 URL QRA gaps.
- SPARTA Explorer Coverage State at a Glance reached all-pass source lanes on 2026-04-29 13:30 ET after correcting false scanner scope: Source/Embedding no longer counts all generic datalake chunks as SPARTA vector targets, Source Text/QRA follows create-qras terminal outcome semantics, and live API reports source text/QRA `pass/covered` plus source embedding `pass/reconciled`.
- 2026-06-27 Tau UX Lab #tau now exposes the Tau command-loop GitHub projection receipt as a visible receipt card and adapter metadata. Source proof is /tmp/tau-command-loop-explicit-ticket-source-proof/summary.json with dry-run GitHub command count 2, mutation applied false, and explicit ticket source /tmp/tau-command-loop-explicit-ticket-source-proof/ticket-source.json. UI marker: /tmp/codex-ui-verification/pi-mono/tau-command-loop-github-projection-ui/20260627T195418Z.meta.json.
- 2026-06-28 Tau UX Lab route proofs now have a repeatable bridge from browser-emitted handoff JSON into the real Tau command-loop. Script: `packages/ux-lab/scripts/tau-ui-handoff-command-loop-proof.mjs`. Fresh proof: `/tmp/tau-ui-handoff-command-loop-proof-20260628T004339Z/summary.json`; it consumed `/tmp/tau-memory-chat-proof-suite-20260628T003628Z/compliance/proof.json`, wrote `start-handoff.json`, ran `uv run tau handoff-command-loop`, selected `reviewer`, command exit `0`, `mocked:false`, `live:true`, and stopped at `human`. This proves one browser-extracted handoff is executable by the Tau command-loop; it does not prove live GitHub mutation, final Sparta Chat readiness, or unbounded autonomous operation.
- 2026-06-28 Tau special-mode bridge hardening added focused validator coverage for `packages/ux-lab/scripts/tau-ui-handoff-command-loop-proof.mjs`. `npx vitest run scripts/tau-ui-handoff-command-loop-proof.test.mjs` passed 1 file / 4 tests, the broader Tau route/chat suite passed 6 files / 66 tests, and `npx tsc --noEmit --pretty false` exited 0. Fresh live bridge proof: `/tmp/tau-ui-handoff-command-loop-proof-20260628T004844Z/summary.json`, with `mocked:false`, `live:true`, selected agent `reviewer`, command exit `0`, and terminal agent `human`.
- 2026-06-28 Tau special-mode contract hardening extended `server/tauRoutes.test.ts` so the T’au-owned UX contract fails closed if the parameter-driven orchestration mode omits `TAU_ORCHESTRATOR_START`, stops naming `handoff-command-loop`, stops naming `docker/tau-cron.sh`, or no longer documents bounded selected-subagent command ticks. Scoped command `npx vitest run server/tauRoutes.test.ts src/components/tau/TauChatView.test.ts src/components/tau/tauAgentHandoff.test.ts src/components/tau/tauCommandLoopProjection.test.ts src/components/tau/tauPeerStatus.test.ts scripts/tau-ui-handoff-command-loop-proof.test.mjs` passed 6 files / 70 tests, and `npx tsc --noEmit --pretty false` exited 0.
- 2026-06-28 Tau Memory intent ambiguity hardening now routes low-confidence supported Memory actions and close-ranked `top_intents` / `candidate_intents` through `/clarify` before any recall, research, evidence, or subagent handoff path. `TauReceiptAdapter` keeps the raw Memory intent visible in the receipt table but builds downstream handoff JSON from the effective route action, so ambiguous COMPLIANCE and RESEARCH both stop at `next_agent: human`. Scoped command `npx vitest run server/tauRoutes.test.ts src/components/tau/TauChatView.test.ts src/components/tau/tauAgentHandoff.test.ts src/components/tau/tauCommandLoopProjection.test.ts src/components/tau/tauPeerStatus.test.ts scripts/tau-ui-handoff-command-loop-proof.test.mjs` passed 6 files / 73 tests, and `npx tsc --noEmit --pretty false` exited 0.
- 2026-06-28 After the Memory ambiguity change, the live Tau Memory chat proof suite at `/tmp/tau-memory-chat-proof-suite-20260628T005757Z/summary.json` passed with `scenarioCount:12`, `liveScenarioCount:5`, `mockedScenarioCount:7`; the live COMPLIANCE scenario still emitted `tau.agent_handoff.v1` routed to `reviewer`. Fresh command-loop bridge `/tmp/tau-ui-handoff-command-loop-proof-20260628T005856Z/summary.json` consumed that compliance proof, ran `uv run tau handoff-command-loop`, selected `reviewer`, command exit `0`, `mocked:false`, `live:true`, and stopped at `human`.
- 2026-06-28 Tau's special parameter-driven orchestration mode remains the governing contract for long-running subagent work: UX Lab may render it, but the source contract is T’au's `ui/tau-chat-contract.json` with `parameter_driven_orchestrated_loop`, `TAU_ORCHESTRATOR_START`, `handoff-command-loop`, and `docker/tau-cron.sh`. A Watch-style shared chat hardening slice now keeps appearance answers evidence-first for the future shared Tau/Watch/Sparta chat surface: `WatchChatAdapter` prefers loaded frame/video rows over remote transcript-only prose and fails closed with `/clarify` when appearance questions have no frame/video evidence. Mocked/unit command `npx vitest run src/components/shared-chat/memory-turn/WatchChatAdapter.test.ts` passed 1 file / 2 tests; scoped Tau regression command `npx vitest run server/tauRoutes.test.ts src/components/tau/TauChatView.test.ts src/components/tau/tauAgentHandoff.test.ts src/components/tau/tauCommandLoopProjection.test.ts src/components/tau/tauPeerStatus.test.ts scripts/tau-ui-handoff-command-loop-proof.test.mjs src/components/shared-chat/memory-turn/WatchChatAdapter.test.ts` passed 7 files / 75 tests; `npx tsc --noEmit --pretty false` exited 0. This does not prove live Watch backend answers or live GitHub mutation.

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
- 2026-06-26: KDE Plasma/Chrome audio playback can fail from a stale PipeWire/PipeWire-Pulse graph even when UX Lab Watch MP4 range serving is healthy. Proof pattern: Watch media endpoint returned HTTP 206 Partial Content for segment_0024.mp4; journal showed pipewire spa.alsa front:4p Broken pipe and pipewire-pulse Google Chrome Input/output error. Working recovery: systemctl --user restart pipewire-pulse.service wireplumber.service pipewire.service, then verify pipewire.service, pipewire-pulse.service, and wireplumber.service are active. Reload Chrome/YouTube tabs if they keep stale Pulse streams.

## 2026-04-29 - SPARTA Coverage Continuous Agent Contract

- `monitor-sparta` is the continuous owner for Sparta Explorer Coverage: it should run scheduled audits plus push-triggered wakeups until actionable coverage is 100% or remaining work is explicitly human-blocked.
- Sparta Explorer Coverage now treats legacy QRAs and generic datalake chunks as reference inventories, not actionable missing coverage proof.
- SPARTA Corpora inventory is wired numerically: Relationships, URLs, URL Knowledge, and Datalake Chunks no longer display `not wired`; actionable gaps must be numeric and backed by a defensible target query.
- URL inventory currently shows 6,854/6,854 normalized URLs with fetch records, 6,139 HTTP-200 file fetches, and 43,398 URL-knowledge chunks across 5,867 URLs.
- Automatic remediation is safe for observe/read-only checks and approved idempotent fixes; destructive, ambiguous, high-cost, or schema-risk actions must create a human attention item with a concrete resume command.
- Runtime instance started as user-systemd transient observe-only services `sparta-coverage-observe-loop.service` and `sparta-coverage-observe-watchdog.service`; loop cadence is 300s and watchdog report is `/tmp/sparta_coverage_observe_loop_report.txt`.
- Prompt Health is now a lane subagent contract: scan prompt units continuously, apply `/best-practices-prompt`, generate `/review-prompt` payloads for non-mechanical rewrites, and only promote prompt edits after scanner/canary validation or human approval.
