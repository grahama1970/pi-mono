/**
 * SkillUsageTable — per-skill usage stats (calls, cost, tokens, error rate)
 */
import { EMBRY, panel, label as labelStyle } from "../common/EmbryStyle";
import type { SkillUsage } from "../../hooks/useScillmData";

interface Props {
  skills: SkillUsage[];
}

export function SkillUsageTable({ skills }: Props) {
  return (
    <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 60px 80px 80px 70px",
          gap: 8,
          padding: "10px 12px",
          backgroundColor: EMBRY.bgDeep,
          borderBottom: `1px solid ${EMBRY.border}`,
        }}
      >
        {["Skill", "Calls", "Cost", "Tokens", "Err %"].map((h) => (
          <span key={h} style={labelStyle}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {skills.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: EMBRY.dim,
              fontSize: 12,
            }}
          >
            No skill data
          </div>
        ) : (
          skills.map((skill) => {
            const errPct = Math.round((skill.error_rate || 0) * 100);
            const errColor =
              errPct > 10 ? EMBRY.red : errPct > 5 ? EMBRY.amber : EMBRY.dim;
            return (
              <div
                key={skill.caller}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 60px 80px 80px 70px",
                  gap: 8,
                  padding: "8px 12px",
                  borderBottom: `1px solid ${EMBRY.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: EMBRY.blue,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={skill.caller}
                >
                  {skill.caller}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: EMBRY.white,
                    fontWeight: 700,
                    fontFamily: "monospace",
                  }}
                >
                  {skill.calls.toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: EMBRY.dim,
                    fontFamily: "monospace",
                  }}
                >
                  ${(skill.cost_usd || 0).toFixed(4)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: EMBRY.dim,
                    fontFamily: "monospace",
                  }}
                >
                  {(skill.tokens / 1000).toFixed(1)}k
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: errColor,
                    fontFamily: "monospace",
                    fontWeight: errPct > 5 ? 700 : 400,
                  }}
                >
                  {errPct}%
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
