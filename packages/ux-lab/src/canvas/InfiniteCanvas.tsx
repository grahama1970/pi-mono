import { useEffect, useRef, useCallback } from 'react';
import type { Canvas } from 'fabric';
import { NVIS } from '../theme';
import { useCanvas, clampZoom, computeZoomTransform, computePanTransform } from './useCanvas';
import { useCanvasSync } from './useCanvasSync';

const GRID_SIZE_BASE = 50;

export interface InfiniteCanvasProps {
  width?: number;
  height?: number;
  onCanvasReady?: (canvas: Canvas) => void;
}

/**
 * Draw a grid that scales with the current viewport transform.
 * Renders onto a dedicated background canvas layered behind the Fabric canvas.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vt: number[],
) {
  const zoom = vt[0];
  const panX = vt[4];
  const panY = vt[5];

  ctx.clearRect(0, 0, width, height);

  // Adaptive grid spacing: double when zoomed in far, halve when zoomed out
  let gridSize = GRID_SIZE_BASE;
  while (gridSize * zoom < 20) gridSize *= 2;
  while (gridSize * zoom > 100) gridSize /= 2;

  const scaledGrid = gridSize * zoom;

  // Offset so grid lines move with the pan
  const offsetX = panX % scaledGrid;
  const offsetY = panY % scaledGrid;

  ctx.beginPath();
  ctx.strokeStyle = NVIS.BG_TERTIARY;
  ctx.lineWidth = 1;

  for (let x = offsetX; x <= width; x += scaledGrid) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = offsetY; y <= height; y += scaledGrid) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }

  ctx.stroke();

  // Major grid every 5 subdivisions
  const majorScaled = scaledGrid * 5;
  const majorOffsetX = panX % majorScaled;
  const majorOffsetY = panY % majorScaled;

  ctx.beginPath();
  ctx.strokeStyle = NVIS.DIM;
  ctx.lineWidth = 1;

  for (let x = majorOffsetX; x <= width; x += majorScaled) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = majorOffsetY; y <= height; y += majorScaled) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }

  ctx.stroke();
}

export function InfiniteCanvas({
  width = 1200,
  height = 800,
  onCanvasReady,
}: InfiniteCanvasProps) {
  const { canvasRef, canvas, zoom, viewport, setZoom, panTo } = useCanvas();
  useCanvasSync(canvas);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const gridFrameRef = useRef<number | null>(null);

  // Notify parent when canvas is ready
  useEffect(() => {
    if (canvas && onCanvasReady) {
      onCanvasReady(canvas);
    }
  }, [canvas, onCanvasReady]);

  // Resize the Fabric canvas when dimensions change
  useEffect(() => {
    if (!canvas) return;
    canvas.setDimensions({ width, height });
    canvas.requestRenderAll();
  }, [canvas, width, height]);

  // Redraw grid whenever viewport changes, batched with requestAnimationFrame
  const updateGrid = useCallback(() => {
    if (gridFrameRef.current !== null) {
      cancelAnimationFrame(gridFrameRef.current);
    }
    gridFrameRef.current = requestAnimationFrame(() => {
      gridFrameRef.current = null;
      const gridEl = gridCanvasRef.current;
      if (!gridEl) return;
      const ctx = gridEl.getContext('2d');
      if (!ctx) return;
      if (!canvas) return;
      drawGrid(ctx, width, height, [...canvas.viewportTransform]);
    });
  }, [canvas, width, height]);

  useEffect(() => {
    updateGrid();
    return () => {
      if (gridFrameRef.current !== null) {
        cancelAnimationFrame(gridFrameRef.current);
        gridFrameRef.current = null;
      }
    };
  }, [updateGrid, zoom, viewport]);

  // Wire up pan and zoom event handlers on the Fabric canvas
  useEffect(() => {
    if (!canvas) return;

    const handleMouseDown = (opt: { e: MouseEvent }) => {
      const e = opt.e;
      // Alt+click or middle mouse button initiates pan
      if (e.altKey || e.button === 1) {
        isPanning.current = true;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        canvas.selection = false;
        e.preventDefault();
      }
    };

    const handleMouseMove = (opt: { e: MouseEvent }) => {
      if (!isPanning.current) return;
      const e = opt.e;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      const vt = canvas.viewportTransform;
      const newVt = computePanTransform(vt, vt[4] + dx, vt[5] + dy);
      canvas.setViewportTransform(newVt as Canvas['viewportTransform']);
      canvas.requestRenderAll();

      // Update React state
      panTo(newVt[4], newVt[5]);
    };

    const handleMouseUp = () => {
      if (isPanning.current) {
        isPanning.current = false;
        canvas.selection = true;
      }
    };

    const handleWheel = (opt: { e: WheelEvent }) => {
      const e = opt.e;
      if (!e.ctrlKey) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      const currentZoom = canvas.viewportTransform[0];
      // Smooth zoom: scale factor based on scroll delta
      const factor = Math.pow(0.999, delta);
      const newZoom = clampZoom(currentZoom * factor);

      // Get cursor position relative to the canvas element
      const rect = canvas.getElement().getBoundingClientRect();
      const point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const newVt = computeZoomTransform(canvas.viewportTransform, newZoom, point);
      canvas.setViewportTransform(newVt as Canvas['viewportTransform']);
      canvas.requestRenderAll();

      setZoom(newVt[0], point);
    };

    // Fabric.js v7 event registration — use object form for clean typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: Record<string, any> = {
      'mouse:down': handleMouseDown,
      'mouse:move': handleMouseMove,
      'mouse:up': handleMouseUp,
      'mouse:wheel': handleWheel,
    };

    canvas.on(events);

    return () => {
      canvas.off(events);
    };
  }, [canvas, panTo, setZoom, updateGrid]);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        backgroundColor: NVIS.BG_PRIMARY,
      }}
    >
      {/* Grid background layer */}
      <canvas
        ref={gridCanvasRef}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
        }}
      />
      {/* Fabric.js canvas layer */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}
