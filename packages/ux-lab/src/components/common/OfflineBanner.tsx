/**
 * OfflineBanner — Prominent warning when memory daemon is unreachable.
 *
 * - Shows at top of screen when OFFLINE or DEGRADED
 * - Includes retry button
 * - Auto-dismisses when connection restores
 * - COTS C02 compliant (44px touch targets)
 */
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import type { HealthStatus } from "../../hooks/useMemoryHealth";

interface OfflineBannerProps {
  status: HealthStatus;
  details: string;
  onRetry: () => void;
  onReload?: () => void; // Called when user wants to reload data after recovery
}

export function OfflineBanner({ status, details, onRetry, onReload }: OfflineBannerProps) {
  if (status === "NOMINAL") return null;

  const isOffline = status === "OFFLINE";
  const bgColor = isOffline ? "#7f1d1d" : "#78350f"; // red-900 / amber-900
  const borderColor = isOffline ? "#dc2626" : "#f59e0b"; // red-600 / amber-500
  const Icon = isOffline ? WifiOff : AlertTriangle;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "12px 16px",
        background: bgColor,
        borderBottom: `2px solid ${borderColor}`,
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      <Icon size={20} style={{ flexShrink: 0 }} aria-hidden="true" />

      <span>
        <strong>{isOffline ? "Memory Service Offline" : "Connection Degraded"}</strong>
        {" — "}
        {details}
      </span>

      <button
        onClick={onRetry}
        title="Check connection now"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 44,
          minHeight: 44,
          padding: "8px 16px",
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 6,
          color: "#fff",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <RefreshCw size={16} />
        Retry
      </button>

      {onReload && (
        <button
          onClick={onReload}
          title="Reload all data"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 44,
            minHeight: 44,
            padding: "8px 16px",
            background: borderColor,
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Reload Data
        </button>
      )}
    </div>
  );
}
