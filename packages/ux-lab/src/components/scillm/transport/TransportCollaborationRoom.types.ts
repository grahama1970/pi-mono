export type ComposerSpeaker = 'human' | 'project_agent'

export const SPEAKER_LABEL: Record<ComposerSpeaker, string> = {
  human: 'Human',
  project_agent: 'Project agent',
}
