import { EMBRY } from '../common/EmbryStyle'
import { useF36SupplyChainReadModel } from '../../../hooks/useF36ExplorerReadModels'
import { PageDistanceRoot } from './pageDistance/PageDistanceMode'

export function SupplyChainView() {
  const { data, loading, error } = useF36SupplyChainReadModel()

  if (loading) return <PageDistanceRoot qid="supply-chain-mode-root"><div data-qid="supply-chain:f36-corpus-loading" style={{ padding: 24, color: EMBRY.dim }}>Loading live F-36 supply-chain requirements...</div></PageDistanceRoot>
  if (error || !data) return <PageDistanceRoot qid="supply-chain-mode-root"><div data-qid="supply-chain:f36-corpus-unavailable" style={{ padding: 24, color: EMBRY.red }}>F-36 supply-chain source unavailable: {error ?? 'no read model returned'}</div></PageDistanceRoot>

  return (
    <PageDistanceRoot qid="supply-chain-mode-root">
      <div data-qid="supply-chain:f36-corpus-read-model" data-projection-fingerprint={data.projection_fingerprint} style={{ height: '100%', overflow: 'auto', padding: 20, background: EMBRY.bg, color: EMBRY.white, display: 'grid', alignContent: 'start', gap: 14 }}>
        <section style={{ border: `1px solid ${EMBRY.amber}`, background: 'rgba(255,170,0,0.08)', padding: 16, display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: EMBRY.amber }}>SYNTHETIC F-36 CORPUS · LIVE SOURCE · NON-OPERATIONAL</div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Supply-chain provenance requirements</h2>
          <div data-qid="supply-chain:f36-counts">{data.counts.supply_chain_provenance_requirements} requirements · {data.requirement_component_edges.length} requirement-to-component allocations · {data.counts.component_families_with_requirements} active component families</div>
          <div>Reviewed SPARTA overlays 0 · compliance credit 0</div>
        </section>

        <section data-qid="supply-chain:instance-lineage-absent" style={{ border: `1px solid ${EMBRY.red}`, background: 'rgba(255,68,68,0.08)', padding: 16, display: 'grid', gap: 8 }}>
          <strong style={{ color: EMBRY.red }}>Instance lineage absent</strong>
          <span style={{ color: EMBRY.dim }}>The source corpus has no {data.instance_lineage.missing_node_types.join(', ')} records. No supplier graph or operational chain is inferred.</span>
          <span>Fabricated nodes: <strong>{data.instance_lineage.fabricated_nodes}</strong></span>
        </section>

        <section style={{ border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 10 }}>Source-grounded requirement allocation</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.requirement_rows.slice(0, 12).map((row) => (
              <div key={row.requirement_id} data-qid={`supply-chain:requirement:${row.requirement_id}`} style={{ borderBottom: `1px solid ${EMBRY.border}`, paddingBottom: 8 }}>
                <strong>{row.requirement_id}</strong> <span style={{ color: EMBRY.dim }}>to {row.component_family_id}</span>
                <div style={{ fontSize: 12, marginTop: 3 }}>{row.title}</div>
                <div style={{ color: EMBRY.dim, fontSize: 10 }}>revision {row.requirement_revision_id} · {row.review_state}</div>
              </div>
            ))}
          </div>
          <div style={{ color: EMBRY.dim, fontSize: 11, marginTop: 10 }}>Showing 12 of {data.requirement_rows.length} source records.</div>
        </section>

        <code style={{ color: EMBRY.dim, fontSize: 10, overflowWrap: 'anywhere' }}>projection fingerprint: {data.projection_fingerprint}</code>
      </div>
    </PageDistanceRoot>
  )
}
