import type { TransportDialogResponse, TransportRunResponse } from './types'

export const MOCK_TRANSPORT_RUN_ID = 'otr-mock-collab'

export const mockTransportDialog: TransportDialogResponse = {
  schema: 'scillm.opencode_transport.dialog.v1',
  transport_run_id: MOCK_TRANSPORT_RUN_ID,
  collaborators: ['human', 'project_agent', 'worker'],
  human_can_participate: true,
  dialog_session_id: 'ses_mock_parent',
  turns: [
    {
      message_id: 'msg-1',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nStarted transport run `otr-mock-collab` (DAG `transport-review-r008`). This session is the **three-way collaboration room**.',
    },
    {
      message_id: 'msg-2',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nSpawned **Reviewer** (`reviewer`) attempt 1.\n- Agent: `scillm-worker`\n- Worker session: `ses_mock_child_01`',
      subagent_kind: 'Reviewer',
      subagent_label: 'Reviewer · scillm-worker',
      agent: 'scillm-worker',
      subagent_run_id: 'otr-mock-collab-reviewer-1',
      attempt_id: 1,
      skills: ['memory', 'scillm', 'best-practices-scillm'],
    },
    {
      message_id: 'msg-3',
      collaborator: 'human',
      speaker: 'Human',
      text: 'Human (proof round 008): Please acknowledge three-way collaboration before the worker proceeds.',
    },
    {
      message_id: 'msg-4',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nForwarding **human** input from this collaboration room into the worker dispatch.',
    },
    {
      message_id: 'msg-5',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nDispatching **reviewer** → `scillm-worker` with model `gpt-5.5`.',
    },
    {
      message_id: 'msg-6',
      collaborator: 'worker',
      speaker: 'Worker (reviewer)',
      text: '**Worker (reviewer)**\n\nFinished on `scillm-worker` / `gpt-5.5`.\n\nVERDICT: PASS\n\nAcknowledged collaboration.',
      subagent_kind: 'Reviewer',
      subagent_label: 'Reviewer · scillm-worker',
      agent: 'scillm-worker',
      subagent_run_id: 'otr-mock-collab-reviewer-1',
      attempt_id: 1,
      skills: ['memory', 'scillm', 'best-practices-scillm'],
    },
  ],
  active_subagent: {
    subagent_run_id: 'otr-mock-collab-reviewer-1',
    role: 'reviewer',
    subagent_kind: 'Reviewer',
    subagent_label: 'Reviewer · scillm-worker',
    agent: 'scillm-worker',
    mode: 'propose_patches',
    attempt_id: 1,
    skills_materialized: ['memory', 'scillm', 'best-practices-scillm'],
  },
  children: [
    {
      subagent_run_id: 'otr-mock-collab-reviewer-1',
      role: 'reviewer',
      subagent_kind: 'Reviewer',
      subagent_label: 'Reviewer · scillm-worker',
      agent: 'scillm-worker',
      attempt_id: 1,
      delivery_state: 'completed',
      active: true,
      skills_materialized: ['memory', 'scillm', 'best-practices-scillm'],
    },
  ],
  pending_human: [],
  observation: {
    transport_run_id: MOCK_TRANSPORT_RUN_ID,
    collaboration_mode: 'three_way',
    parent_ui_model: 'gpt-5.5',
    browser_worker_url: 'http://127.0.0.1:4098/mock/worker',
  },
}

export const mockTransportRun: TransportRunResponse = {
  schema: 'scillm.opencode_transport.state.v1',
  state: {
    transport_run_id: MOCK_TRANSPORT_RUN_ID,
    dag_node_id: 'transport-review-r008',
    parent_session_id: 'ses_mock_parent',
    workspace: '/home/graham/workspace/experiments/scillm',
    children: [
      {
        subagent_run_id: 'otr-mock-collab-reviewer-1',
        role: 'reviewer',
        subagent_kind: 'Reviewer',
        subagent_label: 'Reviewer · scillm-worker',
        child_session_id: 'ses_mock_child_01',
        agent: 'scillm-worker',
        delivery_state: 'completed',
        active: true,
        skills_materialized: ['memory', 'scillm', 'best-practices-scillm'],
      },
    ],
  },
  observation: mockTransportDialog.observation,
}


export const mockTransportEvents = [
  {
    event_type: 'child.created',
    transport_run_id: MOCK_TRANSPORT_RUN_ID,
    subagent_run_id: 'otr-mock-collab-reviewer-1',
    delivery_state: 'created',
    ts: 1000,
  },
  {
    event_type: 'message.queued',
    transport_run_id: MOCK_TRANSPORT_RUN_ID,
    subagent_run_id: 'otr-mock-collab-reviewer-1',
    model: 'gpt-5.5',
    delivery_state: 'queued',
    ts: 1001,
  },
  {
    event_type: 'message.delivered',
    transport_run_id: MOCK_TRANSPORT_RUN_ID,
    subagent_run_id: 'otr-mock-collab-reviewer-1',
    delivery_state: 'completed',
    ts: 1002,
  },
]
