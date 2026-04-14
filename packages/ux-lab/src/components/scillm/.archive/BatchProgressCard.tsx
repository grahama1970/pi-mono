/**
 * BatchProgressCard — shows progress for a single batch job
 */
import { EMBRY, card, label as labelStyle, glowDot } from "../common/EmbryStyle";
import type { BatchProgress } from "../../hooks/useScillmData";

interface Props {
  batch: BatchProgress;
}

export function BatchProgressCard({ batch }: Props) {
  const pct = batch.total > 0 ? Math.round((batch.completed / batch.total) * 100) : 0;
  const hasErrors = batch.errors > 0;
  const isComplete = batch.completed + batch.errors >= batch.total;
  const statusColor = isComplete
    ? hasErrors
      ? EMBRY.amber
      : EMBRY.green
    : EMBRY.blue;

  return (
    <div style={{ ...card, padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={glowDot(statusColor)} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: EMBRY.white,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {batch.batch_id}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 6,
          backgroundColor: EMBRY.bgDeep,
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: statusColor,
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: EMBRY.dim }}>
          <span style={{ color: EMBRY.white, fontWeight: 700 }}>{batch.completed}</span>
          /{batch.total}
        </span>
        {hasErrors && (
          <span style={{ color: EMBRY.red }}>
            {batch.errors} error{batch.errors !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ color: EMBRY.dim }}>
          ${(batch.cost_usd || 0).toFixed(4)}
        </span>
        <span style={{ color: EMBRY.dim }}>
          {Math.round(batch.avg_duration_ms || 0)}ms avg
        </span>
      </div>
    </div>
  );
}
