# SPARTA Explorer — Component List

## Folder Structure

```
SPARTA Explorer/
├── Threat Map/
│   ├── ThreatMap          — ATT&CK Navigator-style grid (tactics × techniques)
│   ├── ThreatMapCell      — Single technique cell with coverage/status color
│   └── ThreatMapLegend    — Color legend for coverage states
├── Lemma Graph/
│   ├── LemmaGraph         — Force-directed cross-framework knowledge graph
│   ├── GraphNode          — Framework-colored node (SPARTA, ATT&CK, D3FEND, NIST, CWE)
│   └── GraphEdge          — Validated/unvalidated edge with method label
├── Tables/
│   ├── ControlTable       — Sortable/filterable control browser
│   ├── QRATable           — Question-Reasoning-Answer browse + search
│   ├── RelationshipTable  — Cross-framework edge browser
│   └── KnowledgeTable     — Extracted chunks with confidence scores
├── Query/
│   ├── ChatWell           — Natural language + direct AQL through /memory
│   ├── QueryResults       — Formatted results from queries
│   └── QueryHistory       — Recent queries sidebar
├── Detail/
│   ├── ControlDetail      — Full control panel (URLs, rels, knowledge, issues)
│   └── QRADetail          — Full QRA with grounding evidence + source
├── Integrity/
│   ├── DimensionCard      — One of 8 integrity check dimensions
│   ├── DimensionGrid      — All 8 dimensions overview
│   └── IssueList          — Filterable integrity issues
└── Common/
    ├── FrameworkBadge      — Colored badge per framework
    ├── StatusIndicator     — Pass/warn/fail indicator
    └── FilterChips        — Framework + status filter row

Composed/
├── Explorer Layout        — Full SPARTA Explorer with all panes arranged
├── Query + Results        — Chat well with results table
└── Map + Detail           — Threat map with control detail sidebar
```

## Data Sources

All components query through `/memory` daemon endpoints:
- `GET /recall` — semantic search across SPARTA collections
- `POST /analytics/run` — direct AQL queries
- `GET /store/{collection}` — browse collections

## NVIS Palette

| Token | Hex | Use |
|-------|-----|-----|
| GREEN | #00ff88 | Pass, validated, D3FEND |
| RED | #ff4444 | Fail, critical, ATT&CK |
| AMBER | #ffaa00 | Warn, CWE |
| BLUE | #44aaff | Info, NIST |
| ACCENT | #7c3aed | SPARTA, primary actions |
| WHITE | #c8c8c8 | Labels |
| DIM | #505050 | Muted, borders |
| BG_PRIMARY | #0a0a1a | Main background |
| BG_SECONDARY | #111128 | Panels |
| BG_TERTIARY | #1a1a3e | Hover/active |
