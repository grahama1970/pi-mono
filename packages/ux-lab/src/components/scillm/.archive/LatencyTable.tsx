/**
 * LatencyTable — p50/p95/p99 latency by model
 */
import { EMBRY, panel, label as labelStyle } from "../common/EmbryStyle";
import type { LatencyStats } from "../../hooks/useScillmData";

interface Props {
  latency: LatencyStats[];
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function latencyColor(ms: number | null): string {
  if (ms == null) return EMBRY.dim;
  if (ms > 10000) return EMBRY.red;
  if (ms > 5000) return EMBRY.amber;
  return EMBRY.green;
}

export function LatencyTable({ latency }: Props) {
  return (
    <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 70px 70px 70px 50px",
          gap: 8,
          padding: "10px 12px",
          backgroundColor: EMBRY.bgDeep,
          borderBottom: `1px solid ${EMBRY.border}`,
        }}
      >
        {["Model", "p50", "p95", "p99", "N"].map((h) => (
          <span key={h} style={labelStyle}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {latency.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: EMBRY.dim,
              fontSize: 12,
            }}
          >
            No latency data
          </div>
        ) : (
          latency.map((stat) => (
            <div
              key={stat.model}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 70px 70px 70px 50px",
                gap: 8,
                padding: "8px 12px",
                borderBottom: `1px solid ${EMBRY.border}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: EMBRY.white,
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={stat.model}
              >
                {stat.model}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: latencyColor(stat.p50),
                  fontFamily: "monospace",
                }}
              >
                {formatMs(stat.p50)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: latencyColor(stat.p95),
                  fontFamily: "monospace",
                }}
              >
                {formatMs(stat.p95)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: latencyColor(stat.p99),
                  fontFamily: "monospace",
                }}
              >
                {formatMs(stat.p99)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: EMBRY.dim,
                  fontFamily: "monospace",
                }}
              >
                {stat.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
