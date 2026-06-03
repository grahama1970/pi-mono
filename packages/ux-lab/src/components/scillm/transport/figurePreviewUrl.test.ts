import { describe, expect, it } from 'vitest'
import { transportArtifactPreviewUrl } from './figurePreviewUrl'

describe('figurePreviewUrl', () => {
  it('maps backend artifact_url to scillm proxy path', () => {
    const url = transportArtifactPreviewUrl(
      {
        artifact_url: '/v1/scillm/opencode/transport/runs/otr-1/artifacts/plot.png',
      },
      'otr-1',
    )
    expect(url).toContain('/scillm/v1/scillm/opencode/transport/runs/otr-1/artifacts/plot.png')
  })
})
