# SPARTA QRA Queue + Scoped Chat Mockup Bakeoff Brief

## Product Context

SPARTA Explorer is a compliance and cybersecurity training-data workbench. It lets compliance officers and SPARTA reviewers inspect generated QRAs (Question-Reasoning-Answer pairs), validate whether each QRA is standalone and evidence-grounded, and either approve, reject, repair, retain as adversarial fixture, or escalate the item.

The current QRA page contains useful data, but it is not fast enough for a compliance officer to bless or triage many QRAs. It reads like dashboard theater: queue counts, evidence trace panels, evidence flow diagrams, and action buttons compete for attention. A reviewer should not need to parse a visual evidence-flow diagram before making an obvious decision like "approval is blocked because `this payload` is ambiguous."

## Current Baseline

- Current QRA page URL: `http://localhost:3002/#sparta-explorer/qras?qra=000a5d68cbd446e5`
- Baseline screenshot: `baseline/qra-current.png`
- Current failure example: QRA asks `Why is CAPEC-649 relevant to T1036.006 in this payload?`
- Blocking issue: `this payload` is an unresolved/ambiguous referent.
- Current correct compliance decision: approval must be blocked until the QRA is repaired or intentionally retained as an adversarial fixture.

## Reference Surfaces

- Controls page reference: `references/controls-reference.png`
  - Use this as the model for dense, table/list-first navigation across a large corpus.
  - It does search, framework filters, status, row scanning, and click-to-select better than the current QRA queue.
- SPARTA Evidence Chat reference: `references/chat-evidence-reference.png`
  - Use this as the model for scoped conversation, Evidence Case cards, strict states, PDF/evidence affordances, shield agent identity, and answer separation.

## Required New Interaction Model

Design a QRA review surface with two primary jobs:

1. Fast navigation and triage of many QRAs.
2. Scoped conversation about the selected QRA.

Required flow:

1. The officer navigates a Controls-style QRA queue by status/category/source/search.
2. Clicking a QRA selects it.
3. The selected QRA opens or focuses a right-pane chat lane scoped to that QRA.
4. The first agent message is not generic chat. It is a structured review status summary:
   - `QRA blocked` or `Ready for review`
   - blocker or approval condition
   - grounded entities such as `CAPEC-649` and `T1036.006`
   - allowed next actions
5. The officer can ask follow-up questions about that QRA only.
6. Evidence Case cards appear inside the chat when needed; static evidence-flow diagrams should not be the primary surface.

## Hard Requirements

- Must make it obvious how to quickly find QRAs needing action.
- Must support category/status navigation, at minimum:
  - Needs repair
  - Ready to approve
  - Missing evidence case
  - Rejected
  - Approved
  - Adversarial fixture
- Must make the selected QRA's decision state dominant.
- Must show why approval is blocked in plain compliance language.
- Must support actions:
  - Approve
  - Reject
  - Correct & rerun
  - Retain fixture
  - Escalate
  - Export audit packet
- Must keep the chat scoped to the selected QRA.
- Must show controls, techniques, artifacts, and ambiguous terms with hover/focus explanation affordances.
- Must preserve an evidence-case object separate from the final answer.
- Must avoid model names, bakeoff tabs, score matrices, or winner labels in the officer-facing UI.
- Must be implementation-realistic for React inside `ux-lab`.

## Non-Goals

- Do not create another dashboard with metrics walls.
- Do not make chat the only navigation mechanism.
- Do not hide QRA navigation behind a conversational search box.
- Do not use a permanent evidence-flow graph as the primary review surface.
- Do not add model-picking UI.
- Do not make approvals look available when the QRA has unresolved referents.

## Dogpile Research Takeaways

Focused Dogpile query:
`UX patterns review queue contextual chat side pane compliance case management triage interface evidence review`

Early external-pattern takeaways from Dogpile/Brave results:

- Compliance or safety-critical status should be delivered upfront, not buried in progressive detail.
- Contextual help and AI assistance work best when scoped to the current task/object, not as a generic global assistant.
- Agentic AI UX guidance emphasizes control, consent, and accountability; proposed actions must be explicit and auditable.
- Chat UI guidance supports clean message lanes, clear author separation, and persistent context markers for the current object under discussion.

Use these as constraints, not visual templates.

## Candidate Assignment

Generate five independent static HTML/CSS mockup candidates for the same surface. Each candidate must include a concise rationale and support the current failed QRA example.

Candidate lanes:

1. Claude: visual hierarchy, calm compliance tone, readable density.
2. OpenAI: implementation-realistic React product workflow and action mechanics.
3. Gemini: alternate visual direction and modern interaction patterns.
4. DeepSeek V4: edge cases, queue triage, and reviewer state mechanics.
5. OpenCode Kimi: information architecture, state model, and QRA-chat relationship.

Each candidate must include:

- QRA queue/list/table area.
- Selected QRA decision card.
- Right-pane scoped chat about the selected QRA.
- Evidence Case card in the chat.
- Action rail or action cluster.
- States for blocked, ready, approved, rejected, and adversarial fixture.
- The example blocked QRA: `Why is CAPEC-649 relevant to T1036.006 in this payload?`

## Scoring Rubric

Score each candidate from 0-100:

- 25: Officer can quickly navigate QRAs by category/status.
- 25: Selected QRA decision state is clear within five seconds.
- 20: Scoped chat improves evaluation without replacing queue navigation.
- 15: Evidence Case is auditable and separate from final answer.
- 10: Actions are explicit, fail-closed, and compliance-safe.
- 5: Visual polish, density, and implementation feasibility.

Candidates fail hard if they:

- recreate the current dashboard/evidence-flow layout,
- make chat the only navigation path,
- obscure why approval is blocked,
- omit hover/focus entity explanations,
- or expose model/bakeoff concepts in the officer-facing surface.

