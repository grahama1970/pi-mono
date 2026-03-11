import { useCanvasStore } from '../store/canvasStore'
import { NVIS } from '../theme'

export type ToolMode = 'select' | 'pan'

export interface ToolDefinition {
  id: string
  label: string
  icon: string
  category: 'shape' | 'component' | 'mode'
}

export const TOOLS: ToolDefinition[] = [
  // Modes
  { id: 'select', label: 'Select', icon: '\u25B3', category: 'mode' },
  { id: 'pan', label: 'Pan', icon: '\u270B', category: 'mode' },
  // Shapes
  { id: 'rect', label: 'Rectangle', icon: '\u25A1', category: 'shape' },
  { id: 'circle', label: 'Circle', icon: '\u25CB', category: 'shape' },
  { id: 'text', label: 'Text', icon: 'T', category: 'shape' },
  { id: 'line', label: 'Line', icon: '\u2014', category: 'shape' },
  // Components
  { id: 'paper:button', label: 'Button', icon: 'Btn', category: 'component' },
  { id: 'paper:card', label: 'Card', icon: '\u25A3', category: 'component' },
  { id: 'paper:navbar', label: 'Navbar', icon: '\u2261', category: 'component' },
  { id: 'paper:container', label: 'Container', icon: '\u229E', category: 'component' },
]

const ELEMENT_DEFAULTS: Record<string, { width: number; height: number; props: Record<string, unknown> }> = {
  rect: { width: 120, height: 80, props: { fill: '#2563eb', stroke: '#1d4ed8' } },
  circle: { width: 80, height: 80, props: { fill: '#8b5cf6', stroke: '#7c3aed' } },
  text: { width: 200, height: 40, props: { text: 'Text', textStyle: 'body' } },
  line: { width: 200, height: 2, props: { stroke: '#64748b' } },
  'paper:button': { width: 120, height: 40, props: { buttonText: 'Button', variant: 'primary', size: 'md' } },
  'paper:card': { width: 280, height: 160, props: { cardTitle: 'Card Title', cardBody: 'Card body text goes here.' } },
  'paper:navbar': { width: 800, height: 56, props: { logoText: 'Logo', navLinks: ['Home', 'About', 'Contact'] } },
  'paper:container': { width: 320, height: 240, props: { layout: 'flex-col', gap: 8, containerPadding: 16 } },
}

const styles = {
  toolbar: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: 48,
    backgroundColor: NVIS.BG_SECONDARY,
    borderRight: `1px solid ${NVIS.DIM}`,
    padding: '8px 0',
    gap: 2,
    overflowY: 'auto' as const,
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '0 4px',
  },
  divider: {
    height: 1,
    backgroundColor: NVIS.DIM,
    margin: '6px 4px',
  },
  sectionLabel: {
    fontSize: 9,
    color: NVIS.DIM,
    textTransform: 'uppercase' as const,
    textAlign: 'center' as const,
    padding: '4px 0 2px',
    letterSpacing: '0.05em',
  },
  button: (active: boolean) => ({
    width: 40,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    backgroundColor: active ? NVIS.BG_TERTIARY : 'transparent',
    color: active ? NVIS.GREEN : NVIS.DIM,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    transition: 'background-color 0.15s',
  }),
}

export interface ToolbarProps {
  activeTool: string
  onToolSelect: (toolId: string) => void
}

export function Toolbar({ activeTool, onToolSelect }: ToolbarProps) {
  const addElement = useCanvasStore((s) => s.addElement)

  const handleToolClick = (tool: ToolDefinition) => {
    if (tool.category === 'mode') {
      onToolSelect(tool.id)
      return
    }

    const defaults = ELEMENT_DEFAULTS[tool.id]
    if (defaults) {
      addElement({
        type: tool.id,
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
        width: defaults.width,
        height: defaults.height,
        props: { ...defaults.props },
      })
    }

    onToolSelect('select')
  }

  const modes = TOOLS.filter((t) => t.category === 'mode')
  const shapes = TOOLS.filter((t) => t.category === 'shape')
  const components = TOOLS.filter((t) => t.category === 'component')

  return (
    <div style={styles.toolbar} data-testid="toolbar">
      <div style={styles.sectionLabel}>Mode</div>
      <div style={styles.section}>
        {modes.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            style={styles.button(activeTool === tool.id)}
            onClick={() => handleToolClick(tool)}
            data-tool-id={tool.id}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div style={styles.divider} />
      <div style={styles.sectionLabel}>Shape</div>
      <div style={styles.section}>
        {shapes.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            style={styles.button(false)}
            onClick={() => handleToolClick(tool)}
            data-tool-id={tool.id}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div style={styles.divider} />
      <div style={styles.sectionLabel}>UI</div>
      <div style={styles.section}>
        {components.map((tool) => (
          <button
            key={tool.id}
            title={tool.label}
            style={styles.button(false)}
            onClick={() => handleToolClick(tool)}
            data-tool-id={tool.id}
          >
            {tool.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
