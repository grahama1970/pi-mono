import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { StreamViewPreset } from './streamFilter'

const PRESETS: { id: StreamViewPreset; label: string; hint: string; action: string }[] = [
  { id: 'dialogue', label: 'Dialogue', hint: 'Human, reviewer, worker replies and tasks', action: 'TRANSPORT_STREAM_PRESET_DIALOGUE' },
  { id: 'handoffs', label: 'Handoffs', hint: 'Dialogue plus spawn cards', action: 'TRANSPORT_STREAM_PRESET_HANDOFFS' },
  { id: 'full', label: 'Full trace', hint: 'Includes forwards and transport start', action: 'TRANSPORT_STREAM_PRESET_FULL' },
]

export function TransportStreamControlBar({
  preset,
  onPresetChange,
  showRouting,
  onShowRoutingChange,
}: {
  preset: StreamViewPreset
  onPresetChange: (p: StreamViewPreset) => void
  showRouting: boolean
  onShowRoutingChange: (v: boolean) => void
}) {
  useRegisterAction('transport:stream-preset:dialogue', {
    app: 'ux-lab',
    action: 'TRANSPORT_STREAM_PRESET_DIALOGUE',
    label: 'Dialogue stream preset',
    description: 'Show dialogue-only transport timeline',
  })
  useRegisterAction('transport:stream-preset:handoffs', {
    app: 'ux-lab',
    action: 'TRANSPORT_STREAM_PRESET_HANDOFFS',
    label: 'Handoffs stream preset',
    description: 'Show handoffs transport timeline preset',
  })
  useRegisterAction('transport:stream-preset:full', {
    app: 'ux-lab',
    action: 'TRANSPORT_STREAM_PRESET_FULL',
    label: 'Full trace stream preset',
    description: 'Show full transport timeline trace',
  })
  useRegisterAction('transport:toggle-routing', {
    app: 'ux-lab',
    action: 'TRANSPORT_TOGGLE_ROUTING_HINTS',
    label: 'Toggle routing hints',
    description: 'Show or hide routing hints on transport timeline',
  })

  return (
    <div className="tr-stream-control-bar" data-qid="transport:stream-control">
      <span className="tr-stream-control-bar__label">Execution trace timeline</span>
      <div className="tr-stream-control-bar__controls">
        <div className="tr-stream-presets" role="group" aria-label="Stream view preset">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`tr-stream-preset${preset === p.id ? ' tr-stream-preset--active' : ''}`}
              data-qid={`transport:stream-preset:${p.id}`}
              data-qs-action={p.action}
              title={p.hint}
              onClick={() => onPresetChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="tr-filter-checkbox" data-qid="transport:toggle-routing:label" title="Show routing hints on timeline messages">
          <input
            type="checkbox"
            checked={showRouting}
            onChange={(e) => onShowRoutingChange(e.target.checked)}
            data-qid="transport:toggle-routing"
            data-qs-action="TRANSPORT_TOGGLE_ROUTING_HINTS"
            title="Show routing hints"
            aria-label="Show routing hints"
          />
          <span>Routing hints</span>
        </label>
      </div>
    </div>
  )
}
