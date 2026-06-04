/** scillm OpenCode transport v1 — types for ux-lab TransportCollaborationRoom */

export type TransportCollaborator = 'human' | 'project_agent' | 'worker' | 'labeled' | 'opencode_model' | 'unknown'

export interface TransportSubagentSummary {
  subagent_run_id?: string
  role?: string
  subagent_kind?: string
  subagent_label?: string
  agent?: string
  agent_id?: string
  mode?: string
  attempt_id?: number
  child_session_id?: string
  delivery_state?: string
  active?: boolean
  skills?: string[]
  skills_materialized?: string[]
  skills_missing?: string[]
}

export interface TransportDialogTurn {
  message_id: string
  collaborator: TransportCollaborator
  speaker: string
  text: string
  role?: string
  subagent_run_id?: string
  subagent_kind?: string
  subagent_label?: string
  agent?: string
  agent_id?: string
  mode?: string
  attempt_id?: number
  skills?: string[]
  created_at?: string
  audience?: string
  routing_hint?: {
    label: string
    tone: 'to-human' | 'to-reviewer' | 'to-worker'
    audience?: string
    inferred?: boolean
  }
}

export interface TransportObservation {
  transport_run_id?: string
  opencode_url?: string
  parent_session_id?: string
  active_child_session_id?: string
  browser_dialog_url?: string
  browser_worker_url?: string
  scillm_dialog_api?: string
  scillm_events_stream?: string
  collaboration_mode?: string
  parent_ui_model?: string
  parent_ui_model_note?: string
}

export interface TransportSkillCallResponse {
  schema?: string
  transport_run_id?: string
  status?: string
  skill_call_spec?: Record<string, unknown>
  skill_invocation?: Record<string, unknown>
  observation?: TransportObservation
}

export interface TransportDialogResponse {
  schema?: string
  transport_run_id?: string
  collaborators?: string[]
  human_can_participate?: boolean
  project_agent_can_participate?: boolean
  dialog_session_id?: string
  children?: TransportSubagentSummary[]
  active_subagent?: TransportSubagentSummary | null
  turns: TransportDialogTurn[]
  pending_human: TransportDialogTurn[]
  observation?: TransportObservation
}

export interface TransportRunState {
  transport_run_id: string
  dag_node_id?: string
  parent_session_id?: string
  workspace?: string
  children?: TransportSubagentSummary[]
}

export interface TransportRunResponse {
  schema?: string
  state: TransportRunState
  observation?: TransportObservation
}

export interface TransportStreamEvent {
  event_type?: string
  transport_run_id?: string
  delivery_state?: string
  ts?: number
  dag_node_id?: string
  subagent_run_id?: string
  [key: string]: unknown
}
