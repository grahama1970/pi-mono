import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import { mockSweepData, F1_THRESHOLD, type SweepTrial } from '../data/mockSweepData'

const MARGIN = { top: 30, right: 30, bottom: 30, left: 30 }
const AXES = ['model', 'lr', 'epochs', 'batch', 'f1'] as const

const statusColor: Record<string, string> = {
  pass: EMBRY.green,
  fail: EMBRY.red,
  running: EMBRY.blue,
}

const MODELS_LIST = ['qwen3:1.7b', 'qwen2.5-coder:7b', 'DeepSeek-V3']

export function ParallelCoordinates() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    d3.select(el).selectAll('*').remove()

    const width = el.clientWidth
    const height = el.clientHeight
    const innerW = width - MARGIN.left - MARGIN.right
    const innerH = height - MARGIN.top - MARGIN.bottom

    const svg = d3
      .select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    const xScale = d3.scalePoint<string>().domain([...AXES]).range([0, innerW])

    const yScales: Record<string, d3.ScaleLinear<number, number> | d3.ScalePoint<string>> = {
      model: d3.scalePoint<string>().domain(MODELS_LIST).range([innerH, 0]),
      lr: d3.scaleLinear().domain([0.0001, 0.001]).range([innerH, 0]),
      epochs: d3.scaleLinear().domain([1, 12]).range([innerH, 0]),
      batch: d3.scaleLinear().domain([4, 32]).range([innerH, 0]),
      f1: d3.scaleLinear().domain([0.5, 1.0]).range([innerH, 0]),
    }

    // Draw axes
    for (const axis of AXES) {
      const x = xScale(axis) ?? 0
      const scale = yScales[axis]

      svg
        .append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', EMBRY.muted)
        .attr('stroke-width', 1)

      svg
        .append('text')
        .attr('x', x)
        .attr('y', -12)
        .attr('text-anchor', 'middle')
        .attr('fill', EMBRY.dim)
        .attr('font-size', 10)
        .attr('font-weight', 700)
        .attr('text-transform', 'uppercase')
        .text(axis.toUpperCase())

      if (axis === 'model') {
        const ps = scale as d3.ScalePoint<string>
        for (const m of MODELS_LIST) {
          const y = ps(m) ?? 0
          svg
            .append('text')
            .attr('x', x - 4)
            .attr('y', y + 3)
            .attr('text-anchor', 'end')
            .attr('fill', EMBRY.dim)
            .attr('font-size', 8)
            .text(m.split(':')[0])
        }
      } else {
        const ls = scale as d3.ScaleLinear<number, number>
        const [lo, hi] = ls.domain()
        svg
          .append('text')
          .attr('x', x + 4)
          .attr('y', innerH + 14)
          .attr('text-anchor', 'start')
          .attr('fill', EMBRY.dim)
          .attr('font-size', 8)
          .text(String(lo))
        svg
          .append('text')
          .attr('x', x + 4)
          .attr('y', 10)
          .attr('text-anchor', 'start')
          .attr('fill', EMBRY.dim)
          .attr('font-size', 8)
          .text(String(hi))
      }
    }

    // F1 threshold marker
    const f1Scale = yScales.f1 as d3.ScaleLinear<number, number>
    const threshY = f1Scale(F1_THRESHOLD)
    const f1X = xScale('f1') ?? 0
    svg
      .append('line')
      .attr('x1', f1X - 10)
      .attr('x2', f1X + 10)
      .attr('y1', threshY)
      .attr('y2', threshY)
      .attr('stroke', EMBRY.amber)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2')
    svg
      .append('text')
      .attr('x', f1X + 14)
      .attr('y', threshY + 3)
      .attr('fill', EMBRY.amber)
      .attr('font-size', 8)
      .text(`Gate ${F1_THRESHOLD}`)

    function getY(trial: SweepTrial, axis: string): number {
      if (axis === 'model') {
        return (yScales.model as d3.ScalePoint<string>)(trial.model) ?? 0
      }
      const val = trial[axis as keyof SweepTrial] as number
      return (yScales[axis] as d3.ScaleLinear<number, number>)(val)
    }

    // Draw lines
    const lineGen = d3
      .line<string>()
      .x((axis) => xScale(axis) ?? 0)
      .y((axis) => 0) // placeholder, overridden per trial
      .curve(d3.curveMonotoneX)

    for (const trial of mockSweepData) {
      const color = statusColor[trial.status]
      const points: [number, number][] = AXES.map((axis) => [
        xScale(axis) ?? 0,
        getY(trial, axis),
      ])

      svg
        .append('path')
        .datum(points)
        .attr('d', d3.line()(points))
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', trial.isBest ? 3 : 1.5)
        .attr('stroke-opacity', trial.isBest ? 1 : 0.6)
        .style('filter', trial.isBest ? `drop-shadow(0 0 4px ${color})` : 'none')

      // Dots on each axis
      for (const [px, py] of points) {
        svg
          .append('circle')
          .attr('cx', px)
          .attr('cy', py)
          .attr('r', trial.isBest ? 4 : 2.5)
          .attr('fill', color)
          .attr('stroke', trial.isBest ? EMBRY.white : 'none')
          .attr('stroke-width', trial.isBest ? 1 : 0)
      }
    }

    // suppress unused
    void lineGen
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 300,
        backgroundColor: EMBRY.bgPanel,
        borderRadius: 8,
        border: `1px solid ${EMBRY.border}`,
      }}
    />
  )
}
