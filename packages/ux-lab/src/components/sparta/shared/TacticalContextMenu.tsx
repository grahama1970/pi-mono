import { useEffect, useRef } from 'react'

export type TacticalContextMenuAction = 'ISOLATE' | 'PIN' | 'COPY'

interface TacticalContextMenuProps {
  x: number
  y: number
  nodeId: string | null
  isVisible: boolean
  onClose: () => void
  onAction: (action: TacticalContextMenuAction, nodeId: string) => void
}

export function TacticalContextMenu({
  x,
  y,
  nodeId,
  isVisible,
  onClose,
  onAction,
}: TacticalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVisible, onClose])

  if (!isVisible || !nodeId) return null

  return (
    <div
      ref={menuRef}
      data-qid="threat-matrix:graph:context-menu"
      role="menu"
      aria-label={`Tactical graph actions for ${nodeId}`}
      style={{ top: y, left: x }}
      className="absolute z-50 flex w-48 flex-col overflow-hidden rounded border border-white/10 bg-[#0a0a0c]/95 shadow-[0_0_15px_rgba(0,0,0,0.8)] backdrop-blur-md pointer-events-auto"
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-[#121214] px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-widest text-white/40">
        <span>Target:</span>
        <span className="max-w-28 truncate text-white/80">{nodeId}</span>
      </div>

      <div className="flex flex-col py-1">
        <button
          type="button"
          role="menuitem"
          data-qid="threat-matrix:graph:context-isolate"
          data-qs-action="GRAPH_CONTEXT_ISOLATE"
          data-qs-params={JSON.stringify({ nodeId })}
          title={`Isolate the kill chain for ${nodeId}`}
          onClick={() => { onAction('ISOLATE', nodeId); onClose() }}
          className="group flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors group-hover:text-yellow-500">
            Isolate Kill Chain
          </span>
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-500/20 transition-colors group-hover:bg-yellow-500" />
        </button>

        <button
          type="button"
          role="menuitem"
          data-qid="threat-matrix:graph:context-pin"
          data-qs-action="GRAPH_CONTEXT_PIN"
          data-qs-params={JSON.stringify({ nodeId })}
          title={`Pin a marker on ${nodeId}`}
          onClick={() => { onAction('PIN', nodeId); onClose() }}
          className="group flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors group-hover:text-white">
            Pin Node Marker
          </span>
          <div className="h-1.5 w-1.5 rounded-full bg-white/10 transition-colors group-hover:bg-white/60" />
        </button>

        <div className="my-1 h-px w-full bg-white/5" />

        <button
          type="button"
          role="menuitem"
          data-qid="threat-matrix:graph:context-copy"
          data-qs-action="GRAPH_CONTEXT_COPY"
          data-qs-params={JSON.stringify({ nodeId })}
          title={`Copy telemetry id ${nodeId}`}
          onClick={() => { onAction('COPY', nodeId); onClose() }}
          className="group flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 transition-colors group-hover:text-white/80">
            Copy Telemetry
          </span>
        </button>
      </div>
    </div>
  )
}
