/**
 * Build a review-design-style upload zip for external UX review (WebGPT, Gemini, etc.).
 *
 * Zip layout (icon/role verification bundle):
 *   README.md                 — index of artifacts
 *   REVIEW_REQUEST.md         — narrow review brief (default: icon/role taxonomy)
 *   CHANGE_SUMMARY.md         — what changed, recommendation map, known gaps
 *   DIFF.md                   — real git diff (dev server) or fallback instructions
 *   FOCUSED_SOURCE.md         — 6–10 critical-path sources only
 *   FULL_SOURCE_APPENDIX.md   — full transport folder sources (broad audit)
 *   transport-room.png        — current viewport screenshot
 *
 * Optional (manual): SCREENSHOT_BEFORE.png alongside AFTER for same run/viewport.
 */
import { toPng } from 'html-to-image'
import JSZip from 'jszip'
import { FOCUSED_TRANSPORT_REVIEW_FILES } from './transportReviewBundle.constants'

/** Bundled at build time — transport room implementation sources for reviewers. */
const TRANSPORT_SOURCE_RAW = import.meta.glob(
  [
    './*.tsx',
    './*.ts',
    '!./**/*.test.ts',
    '!./transportReviewBundle.ts',
    './transport-room.css',
    './transport-room-live-layout.css',
    './transport-room-mockup.css',
    './transport-run-health.css',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const FOCUSED_GLOB_KEYS = new Set(
  FOCUSED_TRANSPORT_REVIEW_FILES.map((f) => `./${f}`),
)

export type TransportReviewScope = 'icon-role' | 'full'

export type TransportReviewContext = {
  runId: string
  pageUrl: string
  runStatusLabel?: string
  dagNodeId?: string
  streamConnected?: boolean
  isMock?: boolean
  knownIssues?: string[]
  surfaceRoles?: string[]
  focus?: string[]
  /** Default icon-role: narrow taxonomy verification. Use full for broad transport audit. */
  reviewScope?: TransportReviewScope
}

type GitDiffPayload = {
  ok: boolean
  stat?: string
  diff?: string
  files?: string[]
  empty?: boolean
  error?: string
}

const ICON_ROLE_KNOWN_ISSUES = [
  'FIXED: Phase chip nowrap + pill nowrap (transport-room.css)',
  'FIXED: Role grammar — Reviewer = subagent persona only; spawn titles use "Spawned subagent: …"',
  'FIXED: TRANSPORT_ROLE_VISUALS unifies icons/labels/cssClass; worker avatar uses per-persona Lucide icons (BotMessageSquare fallback)',
  'VERIFY: Legend — Human · Project agent · Subagent; Harness events inline',
  'VERIFY: Icons — UserRound, Route, Workflow, BotMessageSquare + persona Lucide map',
  'OPTIONAL: API routing_hint may still say "Reviewer room" from backend',
]

const FULL_AUDIT_KNOWN_ISSUES = [
  ...ICON_ROLE_KNOWN_ISSUES,
  'VERIFY: URL overflow — trace URLs as pills only (stripUrlsFromProse + CSS min-width)',
  'VERIFY: Scroll-to-bottom bottom-right of chat well',
  'VERIFY: Composer human-only (no Speaking-as toggle)',
]

const CHANGE_SUMMARY_BODY = {
  whatChanged: [
    'Icon taxonomy: human=UserRound, plan=Route, spawn/harness=Workflow, subagent=per-persona Lucide (ClipboardCheck, SearchCode, ScanEye, CodeXml, …, …; BotMessageSquare fallback)',
    'messageCardContract.ts separates Project agent plan cards from spawn/harness Workflow cards',
    'Timeline legend and chips use Project agent instead of Reviewer for planner role',
    'Harness / transport_start rows labeled Harness with Workflow icon (Orchestrator as event layer, not fourth chat party)',
    'Human-only composer; scroll-to-bottom affordance; URL stripping from prose when trace in metadata pills',
    'Copy for review bundle restructured per WebGPT (focused source, change summary, git diff)',
  ],
  recommendationMap: [
    'WebGPT icon PASS — keep UserRound / Route / Workflow; subagents use persona icons via subagentPersonaIcons.ts',
    'WebGPT role grammar — Reviewer = subagent persona only; Project agent = planner; do not add Orchestrator chat avatar yet',
    'WebGPT SPAWN nowrap — CSS fix on phase chip and protected pills (DONE)',
    'WebGPT single visual contract — transportRoleVisuals.ts (DONE)',
    'scillm SKILL Planner/Orchestrator/Executor — Harness inline, three-party chat',
  ],
  filesTouched: [...FOCUSED_TRANSPORT_REVIEW_FILES],
}

function langForPath(path: string): string {
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.ts')) return 'typescript'
  return ''
}

function displayPath(relPath: string): string {
  return `pi-mono/packages/ux-lab/src/components/scillm/transport/${relPath.replace(/^\.\//, '')}`
}

function bundleMarkdownFromSources(
  title: string,
  intro: string,
  entries: Array<[string, string]>,
): string {
  const parts = [`# ${title}\n\n`, intro, '\n']
  for (const [relPath, fileContent] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`\n---\n\n## \`${displayPath(relPath)}\`\n\n\`\`\`${langForPath(relPath)}\n`)
    parts.push(fileContent)
    if (!fileContent.endsWith('\n')) parts.push('\n')
    parts.push('```\n')
  }
  return parts.join('')
}

export function buildFocusedSourceMarkdown(): string {
  const entries: Array<[string, string]> = []
  for (const key of FOCUSED_GLOB_KEYS) {
    const content = TRANSPORT_SOURCE_RAW[key]
    if (content) entries.push([key, content])
  }
  return bundleMarkdownFromSources(
    'Focused source (icon / role critical path)',
    'Subset of transport room files for verifying Human / Planner / Orchestrator-event / Subagent taxonomy. See FULL_SOURCE_APPENDIX.md for the full tree.',
    entries,
  )
}

export function buildFullSourceAppendixMarkdown(): string {
  const entries = Object.entries(TRANSPORT_SOURCE_RAW) as Array<[string, string]>
  return bundleMarkdownFromSources(
    'Full source appendix',
    'Complete transport folder sources bundled at copy time (fixtures, client, CSS variants included). Use for broad transport-room audits only.',
    entries,
  )
}

/** @deprecated Use buildFullSourceAppendixMarkdown */
export function buildCodeBundleMarkdown(): string {
  return buildFullSourceAppendixMarkdown()
}

export function buildChangeSummaryMarkdown(
  ctx: TransportReviewContext,
  git: GitDiffPayload,
): string {
  const issues = (ctx.knownIssues?.length
    ? ctx.knownIssues
    : ctx.reviewScope === 'full'
      ? FULL_AUDIT_KNOWN_ISSUES
      : ICON_ROLE_KNOWN_ISSUES)
    .map((item) => `- ${item}`)
    .join('\n')

  const recMap = CHANGE_SUMMARY_BODY.recommendationMap.map((item) => `- ${item}`).join('\n')
  const changed = CHANGE_SUMMARY_BODY.whatChanged.map((item) => `- ${item}`).join('\n')
  const files = CHANGE_SUMMARY_BODY.filesTouched.map((f) => `- \`${displayPath(`./${f}`)}\``).join('\n')

  const diffSection = git.ok && git.diff?.trim()
    ? `## Git diff status\n\nFocused diff captured at bundle time (\`git diff HEAD\` on critical path files).\n\n### Stat\n\n\`\`\`\n${git.stat ?? '(no stat)'}\n\`\`\`\n\nSee **DIFF.md** for full patch.\n`
    : `## Git diff status\n\n**Not embedded** — start ux-lab via \`pnpm dev\` so \`/ux-lab-api/transport-review/diff\` can run git, or run locally:\n\n\`\`\`bash\ncd pi-mono\ngit diff HEAD -- packages/ux-lab/src/components/scillm/transport/{collaboratorIcons,messageCardContract,TransportChatMessage,TransportMessageTimeline,TransportComposer,TransportRoomHeader,messageParse,transport-room}.tsx packages/ux-lab/src/components/scillm/transport/transport-room.css\n\`\`\`\n`

  return `# Change summary

Generated: ${new Date().toISOString()}
Transport run: \`${ctx.runId}\`
Review scope: **${ctx.reviewScope ?? 'icon-role'}**

## What changed

${changed}

## Recommendation map

${recMap}

## Files touched (focused path)

${files}

${diffSection}

## Known remaining issues

${issues}

## Optional manual artifacts

- \`SCREENSHOT_BEFORE.png\` — same viewport/run before changes (not captured automatically)
- \`transport-room.png\` — current AFTER screenshot in this zip
`
}

export function buildDiffMarkdown(git: GitDiffPayload): string {
  if (git.ok && git.diff?.trim()) {
    return `# Git diff (focused transport paths)

Generated from local repo at copy time: \`git diff HEAD\` on the icon/role critical path.

## Files

${(git.files ?? CHANGE_SUMMARY_BODY.filesTouched).map((f) => `- \`${displayPath(`./${f}`)}\``).join('\n')}

## Stat

\`\`\`
${git.stat ?? '(empty)'}
\`\`\`

## Patch

\`\`\`diff
${git.diff}
\`\`\`
`
  }

  return `# Git diff

No diff was captured in-browser.

## Why

Copy for Review fetches \`GET /ux-lab-api/transport-review/diff\` from the **ux-lab Vite dev server**. That endpoint runs git in \`pi-mono\`. Production builds and static hosting cannot run git.

## Generate locally

\`\`\`bash
cd pi-mono
git diff HEAD -- packages/ux-lab/src/components/scillm/transport/collaboratorIcons.tsx \\
  packages/ux-lab/src/components/scillm/transport/messageCardContract.ts \\
  packages/ux-lab/src/components/scillm/transport/TransportChatMessage.tsx \\
  packages/ux-lab/src/components/scillm/transport/TransportMessageTimeline.tsx \\
  packages/ux-lab/src/components/scillm/transport/TransportComposer.tsx \\
  packages/ux-lab/src/components/scillm/transport/TransportRoomHeader.tsx \\
  packages/ux-lab/src/components/scillm/transport/messageParse.ts \\
  packages/ux-lab/src/components/scillm/transport/transport-room.css
\`\`\`

Paste output here or re-run Copy for review while \`pnpm dev\` is active on port 3002.
`
}

export function buildReviewRequestMarkdown(ctx: TransportReviewContext, screenshotName: string): string {
  const scope = ctx.reviewScope ?? 'icon-role'
  const isIconRole = scope === 'icon-role'

  const focusLines = (ctx.focus?.length
    ? ctx.focus
    : isIconRole
      ? [
          'Did Human / Project agent (Planner) / Harness-orchestration events / Worker (Subagent) icons and labels land correctly?',
          'Is Route used for plan/update/skill and Workflow for spawn/system/harness (not confused with planner)?',
          'Is Reviewer only used as subagent persona, never as planner alias?',
          'Does the phase chip SPAWN wrap (should be nowrap)?',
          'Any drift between collaboratorIcons.tsx colors and timeline card lane CSS?',
        ]
      : [
          'confirm recent CSS/layout fixes on screenshot vs bundle',
          'scroll-to-bottom placement and visibility',
          'URL / trace presentation (pills vs inline prose)',
          'composer layout (human-only footer)',
        ]
  ).map((item) => `- ${item}`).join('\n')

  const issues = (ctx.knownIssues?.length
    ? ctx.knownIssues
    : isIconRole
      ? ICON_ROLE_KNOWN_ISSUES
      : FULL_AUDIT_KNOWN_ISSUES)
    .map((item) => `- ${item}`)
    .join('\n')

  const surfaces = (ctx.surfaceRoles?.length
    ? ctx.surfaceRoles
    : [
        'Center: three-party chat — Human, Project agent (planner), Worker/subagent; Harness/Orchestrator as inline system rows (Workflow icon)',
        'Header: Copy for review produces this zip; legend describes parties in round',
        'Composer: human-only interjection',
      ])
    .map((item) => `- ${item}`)
    .join('\n')

  const focusedList = FOCUSED_TRANSPORT_REVIEW_FILES.map((f) => `- \`${displayPath(`./${f}`)}\``).join('\n')

  const generatedAt = new Date().toISOString()
  const contextText = [
    'Scillm OpenCode transport collaboration room in ux-lab.',
    `Bundle generated: ${generatedAt}`,
    `Live URL: ${ctx.pageUrl}`,
    `Transport run id: \`${ctx.runId}\``,
    ctx.dagNodeId ? `DAG node: \`${ctx.dagNodeId}\`` : '',
    ctx.runStatusLabel ? `Run status: ${ctx.runStatusLabel}` : '',
    ctx.isMock ? 'Mode: fixture/mock dialog.' : 'Mode: live transport API.',
    ctx.streamConnected === false && !ctx.isMock ? 'SSE stream: disconnected (UI may be stale).' : '',
  ]
    .filter(Boolean)
    .join('\n')

  const objective = isIconRole
    ? `Verify whether the **Human / Planner (Project agent) / Orchestrator-event (Harness) / Subagent (Worker)** icon and role taxonomy landed correctly in the current transport room UI.

Do **not** expand into full transport architecture unless a finding requires it. Use DIFF.md + CHANGE_SUMMARY.md to separate **new** changes from pre-existing code.`
    : `Tactical UX review for the transport collaboration room — layout, URLs, spacing, composer, and implementation organization.`

  const requiredOutput = isIconRole
    ? `1. Verdict: PASS / NEEDS_CHANGES for **icon taxonomy** and **role grammar** separately
2. Primary findings (severity ordered)
3. Per finding: UI impact, exact file, recommended copy/CSS fix
4. Confirm what is intentional: Orchestrator as event layer (Workflow), not fourth chat party`
    : `1. Primary findings first, ordered by severity
2. Per finding: workflow impact and exact recommendation
3. Spacing tokens and overflow rules
4. Composer layout recommendation`

  return `# Design Review Request

Review **CHANGE_SUMMARY.md**, **DIFF.md**, **FOCUSED_SOURCE.md**, screenshot \`${screenshotName}\`, and optionally FULL_SOURCE_APPENDIX.md.

Target reviewer: external web LLM (Gemini, ChatGPT, UX Pilot)

**Scope:** \`${scope}\`

## Core objective

${objective}

## Context

${contextText}

## Surface roles

${surfaces}

## Known issues (from implementer)

${issues}

## Focused source files

${focusedList}

## Review focus

${focusLines}

## Required output

${requiredOutput}

## Zip contents

| File | Purpose |
|------|---------|
| README.md | Index |
| CHANGE_SUMMARY.md | What changed + recommendation map + remaining issues |
| DIFF.md | Git diff (focused paths) |
| FOCUSED_SOURCE.md | Critical-path sources only |
| FULL_SOURCE_APPENDIX.md | Full transport tree (optional deep dive) |
| ${screenshotName} | Current UI screenshot |
`
}

export function buildBundleReadme(fileNames: string[]): string {
  return `# Transport review bundle

Copy for review artifact index.

${fileNames.map((f) => `- \`${f}\``).join('\n')}

Default review scope: **icon-role** (taxonomy verification). Re-copy with \`reviewScope: 'full'\` in code for broad audits.
`
}

async function fetchTransportGitDiff(): Promise<GitDiffPayload> {
  try {
    const res = await fetch('/ux-lab-api/transport-review/diff')
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as GitDiffPayload & { ok?: boolean }
    return {
      ok: Boolean(data.ok),
      stat: data.stat,
      diff: data.diff,
      files: data.files,
      empty: data.empty,
      error: data.error,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function captureTransportScreenshot(): Promise<Uint8Array> {
  const root = document.querySelector('.transport-room')
  if (!root || !(root instanceof HTMLElement)) {
    throw new Error('Transport room root (.transport-room) not found')
  }
  const dataUrl = await toPng(root, {
    cacheBust: true,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true
      if (node.classList?.contains('transport-room-error')) return false
      return true
    },
  })
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Screenshot capture failed')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function buildTransportReviewZip(
  ctx: TransportReviewContext,
): Promise<{ blob: Blob; git: GitDiffPayload }> {
  const screenshotName = 'transport-room.png'
  const [pngBytes, git] = await Promise.all([captureTransportScreenshot(), fetchTransportGitDiff()])

  const zipEntries: Record<string, string> = {
    'CHANGE_SUMMARY.md': buildChangeSummaryMarkdown(ctx, git),
    'DIFF.md': buildDiffMarkdown(git),
    'FOCUSED_SOURCE.md': buildFocusedSourceMarkdown(),
    'FULL_SOURCE_APPENDIX.md': buildFullSourceAppendixMarkdown(),
    'REVIEW_REQUEST.md': buildReviewRequestMarkdown(ctx, screenshotName),
  }

  const zip = new JSZip()
  const names = ['README.md', ...Object.keys(zipEntries), screenshotName]
  zip.file('README.md', buildBundleReadme(names))
  for (const [name, body] of Object.entries(zipEntries)) {
    zip.file(name, body)
  }
  zip.file(screenshotName, pngBytes)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return {
    blob,
    git,
  }
}

function downloadReviewZip(blob: Blob, runId: string): void {
  const safeId = runId.replace(/[^\w.-]+/g, '_').slice(0, 48) || 'transport'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `transport-review-${safeId}.zip`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyZipToClipboard(blob: Blob): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    const type = blob.type || 'application/zip'
    await navigator.clipboard.write([
      new ClipboardItem({
        [type]: blob,
      }),
    ])
    return true
  } catch {
    return false
  }
}

export type CopyForReviewResult = {
  clipboard: boolean
  downloaded: boolean
  fileName: string
  diffCaptured: boolean
}

/** Capture screenshot, zip review bundle, copy to clipboard and/or trigger download. */
export async function copyTransportForReview(ctx: TransportReviewContext): Promise<CopyForReviewResult> {
  const { blob, git } = await buildTransportReviewZip(ctx)
  const safeId = ctx.runId.replace(/[^\w.-]+/g, '_').slice(0, 48) || 'transport'
  const fileName = `transport-review-${safeId}.zip`
  const clipboard = await copyZipToClipboard(blob)
  let downloaded = false
  if (!clipboard) {
    downloadReviewZip(blob, ctx.runId)
    downloaded = true
  }
  return { clipboard, downloaded, fileName, diffCaptured: Boolean(git.ok && git.diff?.trim()) }
}
