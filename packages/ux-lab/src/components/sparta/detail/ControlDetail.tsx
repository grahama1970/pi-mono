import { EMBRY, card, heading, label, body, fwBadge, glowDot } from '../common/EmbryStyle'

export interface ControlDetailData {
  id: string
  framework: string
  name: string
  description?: string
  controlType?: string
  domain?: string
  parentId?: string
  scope?: string
  weaknesses?: string[]
  relatedControls?: { id: string; framework: string; name: string; method: string }[]
}

export interface ControlDetailProps {
  control: ControlDetailData
  onClose?: () => void
}

export function ControlDetail({ control, onClose }: ControlDetailProps) {
  const fwColor = EMBRY.fw[control.framework] ?? EMBRY.dim

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header with close */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: `${fwColor}0F`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={fwBadge(control.framework)}>{control.framework}</span>
            <span style={{
              fontFamily: 'monospace',
              fontSize: 12,
              fontWeight: 700,
              color: fwColor,
            }}>
              {control.id}
            </span>
          </div>
          <div style={{ ...heading, fontSize: 16 }}>{control.name}</div>
        </div>
        {onClose && (
          <button data-qid="detail-controldetail:auto:51" data-qs-action="DETAIL_CONTROLDETAIL_AUTO_51"
            onClick={onClose}
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              color: EMBRY.dim,
              fontSize: 11,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* Description */}
      {control.description && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Description</div>
          <div style={{ ...body, color: EMBRY.dim }}>{control.description}</div>
        </div>
      )}

      {/* Metadata grid */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
      }}>
        {control.controlType && (
          <MetaField label="Type" value={control.controlType} />
        )}
        {control.domain && (
          <MetaField label="Domain" value={control.domain} />
        )}
        {control.parentId && (
          <MetaField label="Parent" value={control.parentId} mono />
        )}
        {control.scope && (
          <MetaField label="Scope" value={control.scope} />
        )}
      </div>

      {/* Weaknesses */}
      {control.weaknesses && control.weaknesses.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 8 }}>
            Weaknesses ({control.weaknesses.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {control.weaknesses.map((w) => (
              <span key={w} style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                backgroundColor: `${EMBRY.red}12`,
                color: EMBRY.red,
                border: `1px solid ${EMBRY.red}22`,
              }}>
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Related controls */}
      {control.relatedControls && control.relatedControls.length > 0 && (
        <div style={{ padding: '12px 20px' }}>
          <div style={{ ...label, marginBottom: 8 }}>
            Related Controls ({control.relatedControls.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {control.relatedControls.map((rel) => (
              <div key={`${rel.framework}-${rel.id}`} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: EMBRY.bgDeep,
              }}>
                <div style={glowDot(EMBRY.fw[rel.framework] ?? EMBRY.dim, 6)} />
                <span style={fwBadge(rel.framework)}>{rel.framework}</span>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  color: EMBRY.white,
                }}>
                  {rel.id}
                </span>
                <span style={{ fontSize: 12, color: EMBRY.dim, flex: 1 }}>{rel.name}</span>
                <span style={{
                  fontSize: 9,
                  color: EMBRY.dim,
                  padding: '2px 6px',
                  borderRadius: 4,
                  backgroundColor: `${EMBRY.muted}44`,
                }}>
                  {rel.method}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetaField({ label: l, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ ...label, marginBottom: 2 }}>{l}</div>
      <div style={{
        fontSize: 12,
        color: EMBRY.white,
        fontFamily: mono ? 'monospace' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  )
}
