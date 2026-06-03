import { describe, expect, it } from 'vitest'
import {
  buildChangeSummaryMarkdown,
  buildDiffMarkdown,
  buildFocusedSourceMarkdown,
  buildFullSourceAppendixMarkdown,
  buildReviewRequestMarkdown,
} from './transportReviewBundle'

describe('transportReviewBundle', () => {
  const ctx = {
    runId: 'otr-proof-r008',
    pageUrl: 'http://127.0.0.1:3002/#scillm/transport',
    runStatusLabel: 'Running',
    dagNodeId: 'node-1',
  }

  it('buildReviewRequestMarkdown defaults to icon-role scope', () => {
    const md = buildReviewRequestMarkdown(ctx, 'transport-room.png')
    expect(md).toContain('otr-proof-r008')
    expect(md).toContain('transport-room.png')
    expect(md).toContain('icon-role')
    expect(md).toContain('DIFF.md')
    expect(md).toContain('FOCUSED_SOURCE.md')
    expect(md).toContain('Human / Planner')
  })

  it('buildChangeSummaryMarkdown includes recommendation map', () => {
    const md = buildChangeSummaryMarkdown(ctx, { ok: true, stat: '1 file', diff: '+1\n' })
    expect(md).toContain('Recommendation map')
    expect(md).toContain('UserRound')
    expect(md).toContain('Git diff status')
  })

  it('buildDiffMarkdown uses real diff when available', () => {
    const md = buildDiffMarkdown({ ok: true, stat: 'a | 1 +', diff: '+added line\n', files: ['messageParse.ts'] })
    expect(md).toContain('```diff')
    expect(md).toContain('+added line')
  })

  it('buildDiffMarkdown explains fallback when diff missing', () => {
    const md = buildDiffMarkdown({ ok: false })
    expect(md).toContain('ux-lab-api/transport-review/diff')
    expect(md).toContain('git diff HEAD')
  })

  it('buildFocusedSourceMarkdown is smaller than full appendix', () => {
    const focused = buildFocusedSourceMarkdown()
    const full = buildFullSourceAppendixMarkdown()
    expect(focused).toContain('messageCardContract.ts')
    expect(focused).not.toContain('transportFixtures.ts')
    expect(full).toContain('TransportCollaborationRoom')
    expect(full.length).toBeGreaterThan(focused.length)
  })
})
