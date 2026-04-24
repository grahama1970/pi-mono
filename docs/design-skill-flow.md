# Design Skill Flow

This document defines the canonical design-skill workflow for `pi-mono`.

The problem being fixed is fragmentation: multiple skills could all be read as
"the place to start" for design work. The new contract is one front door, one
critique stage, one ship-stage verification gate, and explicit downstream
packaging/governance tools.

## Canonical Stages

1. Create
   - Use `/create-mockup new` for a new design.
   - Use `/create-mockup improve` when the starting point is an existing UI,
     screenshot set, or HTML/CSS artifact.
   - `/create-image` is allowed here only for reference art, icons, textures,
     or supporting assets. It is not the source of truth for product UI layout.
   - `/mockup-lab` is the HTML/CSS generation engine behind this stage, not the
     primary user-facing front door.

2. Review
   - Use `/review-design` immediately after a mockup pass.
   - This is the canonical critique stage for both new designs and redesigns of
     pre-existing interfaces.
   - `/review-design` is also the final visual-drift check after implementation.

3. Ship
   - `/create-mockup ship` is the canonical route from approved mockup to
     implementation intent.
   - `/ux-lab` is the implementation workbench for live React/UI component work.
   - `/best-practices-react` applies here as the implementation hardening layer.

4. Verify
   - Use `/test-interactions` for live rendered interfaces with real DOM
     controls.
   - This is the ship-stage verification gate.
   - It is optional for static mockups and required for live UIs.

5. Package
   - `/create-design-board` packages iterations and visual comparisons.
   - `/create-styleguide` packages token guidance, audits, and drift tracking.
   - These are downstream packaging/governance tools, not design-entry points.

## Routing Matrix

| Situation | Canonical command | Supporting skills | Notes |
| --- | --- | --- | --- |
| New product UI from brief + refs | `/create-mockup new` | `/create-image`, `/mockup-lab`, `/review-design` | HTML/CSS is the source of truth for UI. |
| Improve an existing design | `/create-mockup improve` | `/review-design`, `/mockup-lab` | Start with critique before redesign. |
| Generate art/reference assets | `/create-image` | `/create-mockup` | Use for references/assets, not final UI layout. |
| Critique mockup or shipped UI | `/review-design` | none | Canonical critique stage. |
| Implement approved UI in code | `/create-mockup ship` | `/ux-lab`, `/best-practices-react` | Ship stage starts after review approval. |
| Verify live rendered behavior | `/test-interactions` | `/review-design` | Deterministic live-DOM verification gate. |
| Publish design boards | `/create-design-board` | `/create-mockup` | Downstream packaging. |
| Publish styleguide / token audit | `/create-styleguide` | `/review-design` | Downstream governance. |

## Role of Existing Skills

- `/create-mockup`
  - New canonical front door.
  - Exposes `new`, `improve`, and `ship`.
  - Owns routing, not duplicate implementation logic.

- `/mockup-lab`
  - Internal engine for HTML/CSS mockup generation and iteration.
  - No longer the primary user-facing start point.

- `/review-design`
  - Canonical critique stage.
  - Used once after mockup creation and again after implementation when needed.

- `/test-interactions`
  - Canonical deterministic verification stage for live interfaces.
  - Required before a rendered UI is considered shippable.

- `/ux-lab`
  - Implementation workbench for coded UI.
  - Sits after mockup approval and before final interaction verification.

- `/create-image`
  - Reference/asset/image generation tool.
  - Not a front door for UI layout creation.

- `/create-design-board` and `/create-styleguide`
  - Packaging and governance tools after design direction exists.

## Migration Decisions

- `mockup-lab`
  - Keep.
  - Reposition as the HTML/CSS engine behind `/create-mockup`.

- `create-react-designs`
  - Keep only as a narrower implementation-oriented or specialized route.
  - Point general users to `/create-mockup ship`.

- `prototype-react-iterate`
  - Keep only as a specialized variant-generation path where that extra loop is
    justified.
  - Point the default user path to `/create-mockup ship`.

- `create-design-board`
  - Keep as downstream packaging.

- `create-styleguide`
  - Keep as downstream governance and audit tooling.

- `create-image`
  - Keep as reference/asset generation only.

## Non-Goals

- Do not add another top-level polish skill for `make-interfaces-feel-better`.
- Do not make diffusion/image generation the canonical path for UI mockups.
- Do not mix production implementation constraints into the earliest mockup step
  when they are only relevant at ship time.

## Decision Rule

- If the user wants pixels or a mockup: `/create-mockup`
- If the user wants critique: `/review-design`
- If the user wants live behavior verification: `/test-interactions`
- If the user wants implementation workbench help: `/ux-lab`
- If the user wants assets or references: `/create-image`
- If the user wants packaging/governance: `/create-design-board` or `/create-styleguide`
