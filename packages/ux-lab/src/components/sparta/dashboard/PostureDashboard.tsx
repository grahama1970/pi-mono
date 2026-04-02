/** Stub — PostureDashboard referenced by ChatTab but not yet implemented. */
import { useRegisterAction } from '../../../hooks/useRegisterAction'

export default function PostureDashboard({ onNavigateToControl }: { onNavigateToControl?: (id: string) => void }) {
  useRegisterAction('sparta-show-dashboard', { app: 'sparta-explorer', action: 'SHOW_DASHBOARD', label: 'Show Posture Dashboard', description: 'Display the security posture dashboard with coverage ring, drift alerts, and discrepancies' })
  return <div style={{ padding: 20, color: '#6b7280', fontSize: 12 }}>Posture Dashboard (coming soon)</div>
}
