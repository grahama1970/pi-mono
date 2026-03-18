import { EMBRY } from './components/sparta/common/EmbryStyle'
import { SpartaExplorer } from './components/sparta/explorer/SpartaExplorer'
import { OverviewView } from './components/sparta/explorer/OverviewView'
import { SourcesView } from './components/sparta/explorer/SourcesView'
import { ControlsView } from './components/sparta/explorer/ControlsView'
import { URLsView } from './components/sparta/explorer/URLsView'
import { QRAsView } from './components/sparta/explorer/QRAsView'
import { RelationshipsView } from './components/sparta/explorer/RelationshipsView'
import { PipelineView } from './components/sparta/explorer/PipelineView'
import { PromptLabView } from './components/sparta/explorer/PromptLabView'
import { ChatWell } from './components/ChatWell'

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    width: '100vw',
    backgroundColor: EMBRY.bg,
    color: EMBRY.white,
    fontFamily: 'Inter, system-ui, sans-serif',
    overflow: 'hidden',
  },
}

function App() {
  return (
    <div style={styles.app}>
      <SpartaExplorer
        views={{
          Overview: <OverviewView />,
          Sources: <SourcesView />,
          Controls: <ControlsView />,
          URLs: <URLsView />,
          QRAs: <QRAsView />,
          Relationships: <RelationshipsView />,
          Pipeline: <PipelineView />,
          'Prompt Lab': <PromptLabView />,
        }}
      />
      <ChatWell />
    </div>
  )
}

export default App
