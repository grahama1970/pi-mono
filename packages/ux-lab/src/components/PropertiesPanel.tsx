import { useCanvasStore } from '../store/canvasStore'
import { NVIS } from '../theme'
import type { CanvasElement } from '../types'

const styles = {
  panel: {
    width: 260,
    backgroundColor: NVIS.BG_SECONDARY,
    borderLeft: `1px solid ${NVIS.DIM}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    padding: '10px 12px',
    borderBottom: `1px solid ${NVIS.DIM}`,
    fontSize: 12,
    fontWeight: 700,
    color: NVIS.WHITE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 12,
  },
  emptyState: {
    color: NVIS.DIM,
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '20px 10px',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: NVIS.DIM,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  row: {
    display: 'flex',
    gap: 8,
    marginBottom: 6,
  },
  fieldGroup: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  label: {
    fontSize: 10,
    color: NVIS.DIM,
  },
  input: {
    width: '100%',
    padding: '4px 6px',
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    fontSize: 12,
    boxSizing: 'border-box' as const,
  },
  colorInput: {
    width: '100%',
    height: 28,
    padding: 2,
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    backgroundColor: NVIS.BG_TERTIARY,
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '4px 6px',
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    fontSize: 12,
    boxSizing: 'border-box' as const,
  },
  typeLabel: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={styles.fieldGroup}>
      <span style={styles.label}>{label}</span>
      <input
        type="number"
        style={styles.input}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={styles.fieldGroup}>
      <span style={styles.label}>{label}</span>
      <input
        type="text"
        style={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={styles.fieldGroup}>
      <span style={styles.label}>{label}</span>
      <input
        type="color"
        style={styles.colorInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div style={styles.fieldGroup}>
      <span style={styles.label}>{label}</span>
      <select
        style={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ComponentProps({
  element,
  onPropsChange,
}: {
  element: CanvasElement
  onPropsChange: (props: Record<string, unknown>) => void
}) {
  const props = element.props

  switch (element.type) {
    case 'paper:button':
      return (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Button Props</div>
          <TextField
            label="Text"
            value={(props.buttonText as string) ?? 'Button'}
            onChange={(v) => onPropsChange({ ...props, buttonText: v })}
          />
          <div style={{ height: 6 }} />
          <SelectField
            label="Variant"
            value={(props.variant as string) ?? 'primary'}
            options={[
              { value: 'primary', label: 'Primary' },
              { value: 'secondary', label: 'Secondary' },
              { value: 'outline', label: 'Outline' },
            ]}
            onChange={(v) => onPropsChange({ ...props, variant: v })}
          />
          <div style={{ height: 6 }} />
          <SelectField
            label="Size"
            value={(props.size as string) ?? 'md'}
            options={[
              { value: 'sm', label: 'Small' },
              { value: 'md', label: 'Medium' },
              { value: 'lg', label: 'Large' },
            ]}
            onChange={(v) => onPropsChange({ ...props, size: v })}
          />
        </div>
      )

    case 'paper:card':
      return (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Card Props</div>
          <TextField
            label="Title"
            value={(props.cardTitle as string) ?? 'Card Title'}
            onChange={(v) => onPropsChange({ ...props, cardTitle: v })}
          />
          <div style={{ height: 6 }} />
          <TextField
            label="Body"
            value={(props.cardBody as string) ?? ''}
            onChange={(v) => onPropsChange({ ...props, cardBody: v })}
          />
        </div>
      )

    case 'paper:navbar':
      return (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Navbar Props</div>
          <TextField
            label="Logo Text"
            value={(props.logoText as string) ?? 'Logo'}
            onChange={(v) => onPropsChange({ ...props, logoText: v })}
          />
        </div>
      )

    case 'paper:container':
      return (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Container Props</div>
          <SelectField
            label="Layout"
            value={(props.layout as string) ?? 'flex-col'}
            options={[
              { value: 'flex-row', label: 'Row' },
              { value: 'flex-col', label: 'Column' },
              { value: 'grid', label: 'Grid' },
            ]}
            onChange={(v) => onPropsChange({ ...props, layout: v })}
          />
          <div style={{ height: 6 }} />
          <NumberField
            label="Gap"
            value={(props.gap as number) ?? 8}
            onChange={(v) => onPropsChange({ ...props, gap: v })}
          />
        </div>
      )

    case 'text':
    case 'paper:text':
      return (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Text Props</div>
          <TextField
            label="Content"
            value={(props.text as string) ?? 'Text'}
            onChange={(v) => onPropsChange({ ...props, text: v })}
          />
          <div style={{ height: 6 }} />
          <SelectField
            label="Style"
            value={(props.textStyle as string) ?? 'body'}
            options={[
              { value: 'h1', label: 'Heading 1' },
              { value: 'h2', label: 'Heading 2' },
              { value: 'h3', label: 'Heading 3' },
              { value: 'body', label: 'Body' },
              { value: 'caption', label: 'Caption' },
            ]}
            onChange={(v) => onPropsChange({ ...props, textStyle: v })}
          />
        </div>
      )

    default:
      return null
  }
}

export function PropertiesPanel() {
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedElements = useCanvasStore((s) =>
    s.selectedIds.map((id) => s.elements[id]).filter(Boolean)
  )
  const updateElement = useCanvasStore((s) => s.updateElement)

  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null

  return (
    <div style={styles.panel} data-testid="properties-panel">
      <div style={styles.header}>Properties</div>
      <div style={styles.content}>
        {selectedElements.length === 0 ? (
          <div style={styles.emptyState}>Select an element to edit its properties</div>
        ) : selectedElements.length > 1 ? (
          <div style={styles.emptyState}>{selectedElements.length} elements selected</div>
        ) : singleSelected ? (
          <>
            <div style={styles.typeLabel}>{singleSelected.type}</div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Position</div>
              <div style={styles.row}>
                <NumberField
                  label="X"
                  value={singleSelected.x}
                  onChange={(v) => updateElement(singleSelected.id, { x: v })}
                />
                <NumberField
                  label="Y"
                  value={singleSelected.y}
                  onChange={(v) => updateElement(singleSelected.id, { y: v })}
                />
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Size</div>
              <div style={styles.row}>
                <NumberField
                  label="W"
                  value={singleSelected.width}
                  onChange={(v) => updateElement(singleSelected.id, { width: v })}
                />
                <NumberField
                  label="H"
                  value={singleSelected.height}
                  onChange={(v) => updateElement(singleSelected.id, { height: v })}
                />
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Appearance</div>
              <div style={styles.row}>
                <ColorField
                  label="Fill"
                  value={(singleSelected.props.fill as string) ?? '#2563eb'}
                  onChange={(v) =>
                    updateElement(singleSelected.id, {
                      props: { ...singleSelected.props, fill: v },
                    })
                  }
                />
                <ColorField
                  label="Stroke"
                  value={(singleSelected.props.stroke as string) ?? '#000000'}
                  onChange={(v) =>
                    updateElement(singleSelected.id, {
                      props: { ...singleSelected.props, stroke: v },
                    })
                  }
                />
              </div>
            </div>

            <ComponentProps
              element={singleSelected}
              onPropsChange={(newProps) =>
                updateElement(singleSelected.id, { props: newProps })
              }
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
