import { EMBRY, glowDot } from '../sparta/common/EmbryStyle'
import { useWebSocket } from './hooks/useWebSocket'
import { useLabStore, type TabId } from './hooks/useLabStore'
import { ModeBadge } from './components/ModeBadge'
import { ClassificationTab } from './tabs/ClassificationTab'
import { RationaleTab } from './tabs/RationaleTab'
import { RegressionTab } from './tabs/RegressionTab'
import { CascadeTab } from './tabs/CascadeTab'
import { AnnotationsTab } from './tabs/AnnotationsTab'
import { SweepsTab } from './tabs/SweepsTab'
import { ConvergenceTab } from './tabs/ConvergenceTab'
import { ModelHealthTab } from './tabs/ModelHealthTab'

const TABS: { id: TabId; label: string }[] = [
  { id: 'classification', label: 'Classification' },
  { id: 'rationale', label: 'Rationale Eval' },
  { id: 'convergence', label: 'Convergence' },
  { id: 'regression', label: 'Regression' },
  { id: 'cascade', label: 'Cascade' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'sweeps', label: 'Sweeps' },
  { id: 'model-health', label: 'Model Health' },
]

const wsStatusColor: Record<string, string> = {
  open: EMBRY.green,
  connecting: EMBRY.amber,
  closed: EMBRY.dim,
  error: EMBRY.red,
}

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'classification':
      return <ClassificationTab />
    case 'rationale':
      return <RationaleTab />
    case 'convergence':
      return <ConvergenceTab />
    case 'regression':
      return <RegressionTab />
    case 'cascade':
      return <CascadeTab />
    case 'annotations':
      return <AnnotationsTab />
    case 'sweeps':
      return <SweepsTab />
    case 'model-health':
      return <ModelHealthTab />
  }
}

export function UnifiedLab() {
  const { status } = useWebSocket()
  const { activeTab, setActiveTab, agentMode, setAgentMode } = useLabStore()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: EMBRY.bg,
        color: EMBRY.white,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 40,
          backgroundColor: EMBRY.bgHeader,
          borderBottom: `1px solid ${EMBRY.border}`,
          padding: '0 14px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontWeight: 900,
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: EMBRY.white,
            }}
          >
            Unified Lab
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={glowDot(wsStatusColor[status])} />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: EMBRY.dim,
                letterSpacing: '0.05em',
              }}
            >
              WS:{status}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ModeBadge mode={agentMode} />
          <button
            onClick={() =>
              setAgentMode(
                agentMode === 'paused' ? 'agent-driving' : 'paused'
              )
            }
            style={{
              backgroundColor: EMBRY.red,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            {agentMode === 'paused' ? 'RESUME' : 'STOP'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          backgroundColor: EMBRY.bgCard,
          borderBottom: `1px solid ${EMBRY.border}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px',
                fontSize: 11,
                fontWeight: isActive ? 700 : 400,
                color: isActive ? EMBRY.green : EMBRY.dim,
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: isActive
                  ? `2px solid ${EMBRY.green}`
                  : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <TabContent tab={activeTab} />
      </div>
    </div>
  )
}
