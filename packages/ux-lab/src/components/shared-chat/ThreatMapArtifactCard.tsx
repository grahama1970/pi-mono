/**
 * Threat-matrix stream card — delegates to unified ChatArtifactCard.
 */
import type { Artifact } from './types'
import { ChatArtifactCard } from './ChatArtifactCard'

export interface ThreatMapArtifactCardProps {
  artifact: Artifact
  caseId?: string | null
  contextShareLabel?: string | null
  onDismissContextShare?: () => void
  onOpenMatrix?: () => void
}

export function ThreatMapArtifactCard(props: ThreatMapArtifactCardProps) {
  const { onOpenMatrix, ...rest } = props
  return <ChatArtifactCard {...rest} onOpen={onOpenMatrix} />
}
