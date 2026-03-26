/**
 * UtilityBar — Copy Link + Export CSV buttons for detail panes.
 */
import { utilBtnStyle, copyControlLink, exportControlCSV } from './TableStyles'

interface UtilityBarProps {
  controlId: string
  name: string
  framework: string
  description: string
  onToast: (msg: string) => void
}

export function UtilityBar({ controlId, name, framework, description, onToast }: UtilityBarProps) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button
        onClick={() => copyControlLink(controlId).then(() => onToast('Link copied!'))}
        style={utilBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4cc9f0'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = '' }}
      >
        {'\uD83D\uDD17'} Copy Link
      </button>
      <button
        onClick={() => { exportControlCSV(controlId, name, framework, description); onToast('CSV exported!') }}
        style={utilBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4cc9f0'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = '' }}
      >
        {'\uD83D\uDCE5'} Export CSV
      </button>
    </div>
  )
}
