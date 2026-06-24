/**
 * Interactive D3 force graph for artifact pane (full expand target).
 */
import { memo, useEffect, useRef, useState } from 'react'
import { classifyEntity, type EntityType } from './highlightEntities'

export interface GraphNode { id: string; label: string; type?: string; group?: string }
export interface GraphEdge { source: string; target: string; label?: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export function isGraphData(d: unknown): d is GraphData {
  if (!d || typeof d !== 'object') return false
  const obj = d as Record<string, unknown>
  return Array.isArray(obj.nodes) && Array.isArray(obj.edges)
}

export const ArtifactGraphView = memo(function ArtifactGraphView({
  data,
  height = 420,
  onEntityClick,
}: {
  data: GraphData
  height?: number
  onEntityClick?: (entity: string, type: EntityType) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return
    let cancelled = false

    import('d3').then(d3 => {
      if (cancelled || !svgRef.current) return
      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()
      const width = svgRef.current.clientWidth || 600
      const g = svg.append('g')

      svg.call(
        d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.3, 4])
          .on('zoom', e => g.attr('transform', e.transform)) as never,
      )

      const nodes = data.nodes.map(n => ({ ...n }))
      const edges = data.edges.map(e => ({ ...e }))
      const groups = [...new Set(data.nodes.map(n => n.group || n.type || 'default'))]
      const color = d3.scaleOrdinal(['#4a9eff', '#00ff88', '#ff4444', '#ffaa00', '#7c3aed', '#ec4899']).domain(groups)

      const sim = d3.forceSimulation(nodes as never)
        .force('link', d3.forceLink(edges as never).id((d: { id: string }) => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))

      const link = g.append('g').selectAll('line').data(edges).join('line')
        .attr('stroke', 'rgba(255,255,255,0.15)').attr('stroke-width', 1)

      const node = g.append('g').selectAll('circle').data(nodes).join('circle')
        .attr('r', 8)
        .attr('fill', (d: GraphNode) => color(d.group || d.type || 'default') as string)
        .attr('stroke', 'rgba(255,255,255,0.2)')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('click', (_event, d: GraphNode) => {
          if (!onEntityClick) return
          const t = classifyEntity(d.label || d.id)
          if (t) onEntityClick(d.label || d.id, t)
        })

      const label = g.append('g').selectAll('text').data(nodes).join('text')
        .text((d: GraphNode) => d.label || d.id)
        .attr('font-size', 10)
        .attr('fill', '#94a3b8')
        .attr('dx', 12)
        .attr('dy', 4)

      const drag = d3.drag<SVGCircleElement, GraphNode & { x?: number; y?: number; fx?: number | null; fy?: number | null }>()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null
          d.fy = null
        })
      node.call(drag as never)

      sim.on('tick', () => {
        link
          .attr('x1', (d: { source: { x: number }; target: { x: number } }) => d.source.x)
          .attr('y1', (d: { source: { y: number }; target: { y: number } }) => d.source.y)
          .attr('x2', (d: { target: { x: number } }) => d.target.x)
          .attr('y2', (d: { target: { y: number } }) => d.target.y)
        node.attr('cx', (d: { x: number }) => d.x).attr('cy', (d: { y: number }) => d.y)
        label.attr('x', (d: { x: number }) => d.x).attr('y', (d: { y: number }) => d.y)
      })

      setLoading(false)
      return () => { sim.stop() }
    })

    return () => { cancelled = true }
  }, [data, height, onEntityClick])

  return (
    <div data-qid="artifact:graph-preview" style={{ position: 'relative' }}>
      {loading ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1220' }}>
          <div style={{ width: 120, height: 16, borderRadius: 4, background: 'linear-gradient(90deg, #18181b 0%, #27272a 50%, #18181b 100%)', backgroundSize: '200% 100%', animation: 'artifact-graph-shimmer 1.5s infinite' }} />
        </div>
      ) : null}
      <style>{`@keyframes artifact-graph-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <svg ref={svgRef} width="100%" height={height} style={{ background: '#0b1220', display: 'block' }} />
    </div>
  )
})
