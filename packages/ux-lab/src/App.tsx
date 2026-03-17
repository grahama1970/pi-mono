import { UnifiedLab } from './components/unified-lab/UnifiedLab'
import { ChatFab } from './components/ChatFab'
import { EMBRY } from './components/sparta/common/EmbryStyle'

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
      <UnifiedLab />
      <ChatFab />
    </div>
  )
}

export default App
