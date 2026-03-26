import { EMBRY, card, label } from '../../sparta/common/EmbryStyle'

export function AnnotationsTab() {
  const panels = ['Human Labels', 'Agreement Scores', 'Export Queue']

  return (
    <div style={{ padding: 20 }}>
      <div style={{ ...label, marginBottom: 12 }}>Annotations</div>
      <div style={{ fontSize: 13, color: EMBRY.dim, marginBottom: 20 }}>
        Coming soon. This tab will manage human annotation workflows and label quality.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {panels.map((name) => (
          <div key={name} style={{ ...card, opacity: 0.5 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: EMBRY.white }}>
              {name}
            </div>
            <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4 }}>
              Placeholder
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
