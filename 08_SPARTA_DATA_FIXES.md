# SPARTA Data Fixes

## Context

Working directory: `/home/graham/workspace/experiments/pi-mono`

The SPARTA Explorer UI is complete. The dataset has 4 remaining data gaps that need fixing.
All tools exist and work. The NASA QRA generation script at `/tmp/generate_esa_nasa_qras.py` is a working reference — it uses `/scillm` for LLM generation, `/embedding` service (port 8602) for 384-dim vectors, and `/upsert` for storage.

### Services Running
- Memory daemon: Unix socket `/run/user/1000/embry/memory.sock`, proxied at `http://localhost:3001/api/memory/*`
- Embedding service: `http://127.0.0.1:8602` — 384-dim all-MiniLM-L6-v2. Read `/home/graham/workspace/experiments/pi-mono/.pi/skills/embedding/SKILL.md`
- scillm LLM: `http://localhost:4001/v1/chat/completions` — model "text", auth "Bearer sk-dev-proxy-123"

### Rules
- ALL embeddings from `http://127.0.0.1:8602/embed` — 384-dim, no exceptions
- ALL data via daemon endpoints (`/list`, `/upsert`, `/recall`, `/learn`) — never call ArangoDB directly
- Deterministic `_key` on QRA documents (sha1 of run_id + control_id + index)
- `sparta_qra` has unique index on `(run_id, qra_id)` — both fields required
- Curated relationship scores (method starts with "curated:") must NOT be overwritten

---

## Task 1: Fix ESA HTML descriptions

137 ESA controls have raw HTML in the description field (e.g. `<div class="card-header collapsed"...`).

1. Fetch: `POST /api/memory/list` with `{collection: "sparta_controls", limit: 200, filters: {source_framework: "ESA"}, return_fields: ["_key", "control_id", "name", "description"]}`
2. For each control where description contains `<div` or `<span` or starts with `<`: strip HTML tags using Python `html.parser` to extract text
3. If extracted text is < 20 chars, set description to `[NEEDS ENRICHMENT] {name}`
4. Update: `POST /api/memory/upsert` with `{collection: "sparta_controls", documents: [{_key, description: cleaned}]}`

**Done when:** Zero ESA descriptions contain HTML tags.

---

## Task 2: Generate ESA QRAs

After Task 1 fixes descriptions, generate 3 QRAs per ESA control.

Reference script: `/tmp/generate_esa_nasa_qras.py` — copy the pattern exactly. It already handles:
- Fetching controls via `/list`
- Generating QRAs via scillm
- Embedding via `http://127.0.0.1:8602/embed`
- Storing via `/upsert` with deterministic `_key` and required `run_id` + `qra_id`

Use `run_id: "esa-qra-fix-20260326"`. Skip controls with description starting with `[NEEDS ENRICHMENT]`.

**Done when:** `POST /api/memory/list {collection: "sparta_qra", limit: 1, filters: {control_id: "ESA-T1489.001"}}` returns total >= 1.

---

## Task 3: Hybrid relationship rescoring

Recompute `combined_score` on 131K relationships in `sparta_relationships`.

Reference script: `/tmp/hybrid_rescore.py` — it has the correct algorithm but crashed because it went through Express proxy. Modify to use the daemon endpoints with rate limiting.

Algorithm:
- **Curated** (method starts with "curated:"): PRESERVE score. If score is 0 and method contains "CAPEC", restore to 0.9.
- **All others**: `score = 0.6 * cosine(src_emb, tgt_emb) + 0.3 * jaccard(src_mind, tgt_mind) + 0.1 * same_framework_bonus`

For embeddings: fetch from control's `embedding` field via `/list`. If missing, call `http://127.0.0.1:8602/embed` with the control's description. Cache aggressively — same control appears in many relationships.

For mind tags: fetch from control's `mind` field via `/list`. Cache.

Process 200 per batch. Total ~131K. Add 50ms sleep between batches to avoid overwhelming the daemon.

**Done when:** Sampled scores show variance (not all 0.2) and curated CAPEC scores are 0.9.

---

## Task 4: Compute per-control quality scores

Compute `nrs_score` (0.0-1.0) for all 11,620 controls.

Formula:
```
score = 0.2 * has_description + 0.2 * has_mind_tags + 0.3 * min(qra_count/5, 1.0) + 0.3 * avg_rel_score
```

- `has_description`: 1 if description exists and length > 20, else 0
- `has_mind_tags`: 1 if `mind` array is non-empty, else 0
- `qra_count`: from `POST /api/memory/list {collection: "sparta_qra", limit: 1, filters: {control_id: ID}}` → use `total`
- `avg_rel_score`: from `POST /api/memory/recall {q: control_id, collections: ["sparta_relationships"], k: 20, entities: [control_id]}` → average `combined_score`

Store via `POST /api/memory/upsert {collection: "sparta_controls", documents: [{_key, nrs_score: score}]}`

Process 100 per batch.

**Done when:** 80%+ of sampled controls have `nrs_score` between 0.0 and 1.0.
