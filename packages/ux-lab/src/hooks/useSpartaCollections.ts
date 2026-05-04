/**
 * Collection-specific hooks for SPARTA data via /memory daemon.
 *
 * Two data paths:
 *   /list   — browse/paginate (returns total count + documents)
 *   /recall — semantic search (BM25 + dense, returns ranked results)
 *
 * All data flows through: /api/memory/* → Express proxy → daemon Unix socket → ArangoDB.
 */
import { useCallback, useEffect, useState } from "react";

const API_ROOT = "http://localhost:3001/api";
const API = `${API_ROOT}/memory`;

// ── Shared fetch helpers ────────────────────────────────────────────────────

async function listPost(
	collection: string,
	opts: { limit?: number; offset?: number; return_fields?: string[]; filters?: Record<string, string> } = {},
): Promise<{ documents: Record<string, unknown>[]; total: number; count: number }> {
	const { filters, ...rest } = opts;
	const body: Record<string, unknown> = { collection, limit: rest.limit ?? 50, offset: rest.offset ?? 0, ...rest };
	if (filters) body.filters = filters;
	const res = await fetch(`${API}/list`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/list ${res.status}: ${await res.text()}`);
	return res.json();
}

async function recallPost(
	collections: string[],
	q: string,
	opts: { k?: number; entities?: string[]; include_edges?: boolean } = {},
): Promise<{ items: Record<string, unknown>[]; found: boolean }> {
	const body: Record<string, unknown> = { q, collections, k: opts.k ?? 50 };
	if (opts.entities?.length) body.entities = opts.entities;
	if (opts.include_edges) body.include_edges = true;

	const res = await fetch(`${API}/recall`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/recall ${res.status}: ${await res.text()}`);
	return res.json();
}

function useDebouncedValue<T>(value: T, ms = 300): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return debounced;
}

// ── Types (matching ACTUAL ArangoDB document shapes) ────────────────────────

export interface SpartaControl {
	_key: string;
	_id: string;
	control_id: string;
	name: string;
	description?: string;
	source_framework: string;
	control_type?: string;
	parent_id?: string;
	domain?: string;
	scope?: string;
	weaknesses?: string[];
	nrs_score?: number;
	mind?: string[];
	status?: string;
}

/** Span with character positions for inline highlighting */
export interface EvidenceSpan {
	text: string;
	span: [number, number];
	start?: number;
	end?: number;
	kind: "control_id" | "aerospace_term" | "phrase";
	framework?: string;
	name?: string;
	grounded_to_framework?: boolean;
}

/** Glossary entry with resolved control metadata */
export interface GlossaryEntry {
	id: string;
	name: string;
	framework: string;
	type?: string;
	description?: string;
}

/** Crosswalk chain showing framework-to-framework path */
export interface CrosswalkChain {
	// Field names vary: source/target OR from/from_framework/to_framework
	source?: string;
	target?: string;
	from?: string;
	from_framework?: string;
	to_framework?: string;
	hops?: Array<{ control_id?: string; id?: string; framework: string; name?: string }>;
	method?: string;
	relationship?: string;
	confidence?: number;
}

/** Formal proof result from /lean4-prove */
export interface FormalProof {
	success: boolean;
	code?: string;
	attempts?: number;
	errors?: string[];
	proved_at?: number;
}

/** Full evidence case from /create-evidence-case */
export interface EvidenceCase {
	// Core evidence data
	chains?: CrosswalkChain[];
	crosswalk_chains?: CrosswalkChain[];
	confidence?: number;
	methods?: string[];
	verdict?: "satisfied" | "inconclusive" | "not_satisfied" | "none" | string;
	grade?: string;
	gates_passed?: number;
	gates_total?: number;
	gate_trace?: Array<{ gate: string; passed: boolean; detail: string; duration?: number }>;

	// Entity extraction
	question_text?: string;
	control_ids?: string[];
	glossary?: GlossaryEntry[];
	resolved_entities?: Array<{ id: string; name: string; framework: string }>;
	spans?: EvidenceSpan[];
	answer?: string;
	response_action?: "answer" | "deflect" | "clarify" | string;
	entity_resolution?: Array<{ entity?: string; status?: string; mapping?: string }>;
	technique_check?: { status?: string; summary?: string };
	prior_qra_evidence?: Array<{
		_key?: string;
		qra_id?: string;
		source_framework?: string;
		citation_id?: string;
		question?: string;
		answer?: string;
	}>;
	failure_stage?: string;
	failure_reason?: string;
	failed_items?: string[];
	skipped_checks?: string[];
	gap_review_status?: "not_applicable" | "candidate" | "queued" | "completed" | "failed" | string;
	human_review_state?: "not_requested" | "requested" | "queued" | "in_review" | "approved" | "rejected" | string;
	gap_review?: Record<string, unknown>;
	proposed_correction?: Record<string, unknown>;
	correction_lineage?: Record<string, unknown>;
	evidence_case_version?: Record<string, unknown>;

	// Verification
	formal_proof?: FormalProof;
	sacm_ref?: { gid: string; xml_snippet?: string; generated_at?: number };

	// Review status
	review_status?: "auto" | "approved" | "rejected" | "pending";
	extracted_at?: string;
}

export interface SpartaQRA {
	_key: string;
	_id: string;
	control_id: string;
	qra_id?: string;
	question: string;
	reasoning: string;
	evidence: string;
	answer: string;
	grounding_score?: number;
	mind?: string[];
	tier0_pass?: boolean;
	tier15_pass?: boolean;
	tier2_pass?: boolean;
	source_framework?: string;
	review_status?: "auto" | "approved" | "rejected" | "pending" | "pass" | "passed" | "fail" | "failed" | string;
	qra_quality?: {
		status?: "needs_repair" | "waived" | "deprecated" | "blocked" | string;
		issue_code?: "ambiguous_referent" | string;
		issue_label?: string;
		ambiguous_referents?: string[];
		disposition?: string;
		safe_action?: string;
	};
	evidence_quotes?: Array<{ quote: string; relevance?: string }>;
	crosswalk_chain?: string[];
	qra_type?: string;
	evidence_case?: EvidenceCase;
	formal_proof?: FormalProof;
	sacm_ref?: { gid: string; xml_snippet?: string; generated_at?: number };
	lineage?: {
		upstream_qra_keys?: string[];
		entity_ids?: string[];
		entity_frameworks?: string[];
		assembled_at?: string;
	};
	// Grouping fields - links QRAs from same prompt/batch
	relationship_id?: string; // /create-evidence-case: EC-{timestamp}
	run_id?: string; // /create-qras: skill_create_qras_{mode}_{timestamp}
	expertise?: string;
	difficulty?: string;
	created_at?: number;
	// v2 architecture fields (2026-04-20)
	control_type?: string;
	pair_type?: string;
	grounding_mode?: "verbatim" | "close_paraphrase";
	actionable_for?: string;
	prompt_kind?: string;
	source_hash?: string;
	generator_version?: string;
	is_active?: boolean;
	// v2 collection indicator (derived from _id prefix)
	_collection?: "sparta_qra" | "sparta_qra_canonical" | "sparta_qra_relationship";
}

// v2 QRA collection sources
export type QRASource = "v2" | "legacy" | "all";
export type QRAEvidenceStatus = "grounded" | "review" | "passed" | "adversarial" | "missing" | "failed";
const EMPTY_QRA_STATUS_COUNTS: Record<QRAEvidenceStatus, number> = {
	grounded: 0,
	review: 0,
	passed: 0,
	adversarial: 0,
	missing: 0,
	failed: 0,
};

export interface QRAStatusCounts {
	total: number;
	sourceUsed: QRASource;
	counts: Record<QRAEvidenceStatus, number>;
	loading: boolean;
	error?: string | null;
	generatedAt?: string;
	fetchedAt?: string;
	lastSuccessfulAt?: string;
	stale?: boolean;
}

async function qraFeedPost(body: {
	source: QRASource;
	limit?: number;
	offset?: number;
}): Promise<{ documents: Record<string, unknown>[]; total: number; source_used?: string }> {
	const res = await fetch(`${API_ROOT}/qra/feed`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/qra/feed ${res.status}: ${await res.text()}`);
	return res.json();
}

async function qraSearchPost(body: {
	source: QRASource;
	q?: string;
	controlId?: string;
	limit?: number;
	offset?: number;
}): Promise<{ documents: Record<string, unknown>[]; total: number; source_used?: string }> {
	const res = await fetch(`${API_ROOT}/qra/search`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/qra/search ${res.status}: ${await res.text()}`);
	return res.json();
}

export async function qraDetailPost(body: {
	source?: QRASource;
	key?: string;
	qraId?: string;
}): Promise<{ document: Record<string, unknown> | null }> {
	const res = await fetch(`${API_ROOT}/qra/detail`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`/qra/detail ${res.status}: ${await res.text()}`);
	return res.json();
}

async function qraStatusCountsGet(source: QRASource): Promise<{
	total?: number;
	source_used?: QRASource;
	counts?: Partial<Record<QRAEvidenceStatus, number>>;
	generated_at?: string;
}> {
	const res = await fetch(`${API_ROOT}/qra/status-counts?source=${encodeURIComponent(source)}`);
	if (!res.ok) throw new Error(`/qra/status-counts ${res.status}: ${await res.text()}`);
	return res.json();
}

// Relationships are DOCUMENTS (not ArangoDB edges) — no _from/_to
export interface SpartaRelationship {
	_key: string;
	_id: string;
	relationship_id?: number;
	source_control_id: string;
	target_control_id: string;
	method?: string;
	combined_score?: number;
	updated_at?: number;
}

// URLs have minimal fields — no status_code, content_type, etc.
export interface SpartaURL {
	_key: string;
	url_id: number;
	url: string;
	domain: string;
	updated_at?: number;
}

export interface SpartaURLKnowledge {
	_key: string;
	url_id: string | number;
	control_id?: string;
	control_ids?: string[];
	text: string;
	topic?: string;
	excerpt_type?: string;
	source_framework?: string;
}

// ── Hook result shape ───────────────────────────────────────────────────────

interface HookResult<T> {
	data: T[];
	total: number;
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

// ── useControls ─────────────────────────────────────────────────────────────
// Loads from multiple offsets to get a diverse framework mix.

export function useControls(query = "", framework?: string): HookResult<SpartaControl> {
	const debouncedQuery = useDebouncedValue(query);
	const [data, setData] = useState<SpartaControl[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (debouncedQuery) {
				const result = await recallPost(["sparta_controls"], debouncedQuery, { k: 100 });
				let items = result.items as unknown as SpartaControl[];
				if (framework) items = items.filter((c) => normalizeFramework(c.source_framework) === framework);
				setData(items);
				setTotal(items.length);
			} else {
				// Sample from multiple offsets to get diverse frameworks
				const pageSize = 20;
				const offsets = [0, 1500, 3000, 5500, 7500, 9000];
				const pages = await Promise.all(
					offsets.map((offset) =>
						listPost("sparta_controls", {
							limit: pageSize,
							offset,
							return_fields: [
								"control_id",
								"name",
								"description",
								"source_framework",
								"control_type",
								"parent_id",
								"domain",
								"scope",
								"weaknesses",
								"mind",
							],
						}),
					),
				);
				const totalCount = pages[0].total;
				let items: SpartaControl[] = [];
				for (const page of pages) {
					items.push(...(page.documents as unknown as SpartaControl[]));
				}
				if (framework) items = items.filter((c) => normalizeFramework(c.source_framework) === framework);
				setData(items);
				setTotal(totalCount);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [debouncedQuery, framework]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);
	return { data, total, loading, error, refresh: fetchData };
}

// ── useControlsPaginated ─────────────────────────────────────────────────────
// Server-side pagination with optional framework filter. Returns one page at a time.

export function useControlsPaginated(
	page: number,
	pageSize: number,
	framework?: string,
): { data: SpartaControl[]; total: number; loading: boolean; error: string | null } {
	const [data, setData] = useState<SpartaControl[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const filters: Record<string, string> = {};
			if (framework) filters.source_framework = framework;
			const result = await listPost("sparta_controls", {
				limit: pageSize,
				offset: page * pageSize,
				return_fields: [
					"control_id",
					"name",
					"description",
					"source_framework",
					"control_type",
					"parent_id",
					"domain",
					"scope",
					"weaknesses",
					"mind",
					"nrs_score",
				],
				filters: Object.keys(filters).length > 0 ? filters : undefined,
			});
			setData(result.documents as unknown as SpartaControl[]);
			setTotal(result.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [page, pageSize, framework]);

	useEffect(() => {
		fetchPage();
	}, [fetchPage]);

	return { data, total, loading, error };
}

// ── useQRAs ─────────────────────────────────────────────────────────────────
// v2 architecture (2026-04-20): supports separate canonical vs relationship collections
// - source="v2": queries sparta_qra_canonical + sparta_qra_relationship (default)
// - source="legacy": queries sparta_qra (for comparison during migration)
// - source="all": queries all three collections
//
// Caching: module-level cache keyed by (query, controlId, source) with 30s TTL.
// Prevents re-fetching on every tab switch / remount.

interface QraCacheEntry {
	data: SpartaQRA[];
	total: number;
	at: number;
}

const QRA_CACHE = new Map<string, QraCacheEntry>();
const QRA_PENDING = new Map<string, Promise<QraCacheEntry>>();
const QRA_CACHE_TTL_MS = 30_000;

function qraCacheKey(
	query: string,
	controlId: string | undefined,
	source: QRASource,
	page: number,
	pageSize: number,
): string {
	return JSON.stringify({ query, controlId, source, page, pageSize });
}

export function useQRAs(
	query = "",
	controlId?: string,
	source: QRASource = "v2",
	page = 0,
	pageSize = 50,
): HookResult<SpartaQRA> {
	const debouncedQuery = useDebouncedValue(query);
	const [data, setData] = useState<SpartaQRA[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(
		async (opts?: { force?: boolean }) => {
			const cacheKey = qraCacheKey(debouncedQuery, controlId, source, page, pageSize);
			const cached = QRA_CACHE.get(cacheKey);

			// Serve stale immediately if available and not forcing refresh
			if (!opts?.force && cached && Date.now() - cached.at < QRA_CACHE_TTL_MS) {
				setData(cached.data);
				setTotal(cached.total);
				setLoading(false);
				setError(null);
				return;
			}

			setLoading(true);
			setError(null);
			try {
				const pending =
					!opts?.force && QRA_PENDING.has(cacheKey)
						? QRA_PENDING.get(cacheKey)!
						: (async () => {
								const result =
									debouncedQuery || controlId
										? await qraSearchPost({
												source,
												q: debouncedQuery || undefined,
												controlId,
												offset: page * pageSize,
												limit: pageSize,
											})
										: await qraFeedPost({ source, offset: page * pageSize, limit: pageSize });

								const items = (result.documents as unknown as SpartaQRA[]).map((item) => ({
									...item,
									_collection: item._id?.startsWith("sparta_qra_canonical")
										? ("sparta_qra_canonical" as const)
										: item._id?.startsWith("sparta_qra_relationship")
											? ("sparta_qra_relationship" as const)
											: ("sparta_qra" as const),
								}));

								return { data: items, total: result.total ?? items.length, at: Date.now() };
							})();

				if (!opts?.force && !QRA_PENDING.has(cacheKey)) QRA_PENDING.set(cacheKey, pending);
				const entry = await pending;
				QRA_CACHE.set(cacheKey, entry);
				setData(entry.data);
				setTotal(entry.total);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				QRA_PENDING.delete(cacheKey);
				setLoading(false);
			}
		},
		[debouncedQuery, controlId, source, page, pageSize],
	);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	return { data, total, loading, error, refresh: () => fetchData({ force: true }) };
}

export function useQRAStatusCounts(source: QRASource = "all"): QRAStatusCounts {
	const [statusCounts, setStatusCounts] = useState<QRAStatusCounts>({
		total: 0,
		sourceUsed: source,
		counts: EMPTY_QRA_STATUS_COUNTS,
		loading: true,
		error: null,
	});

	useEffect(() => {
		let cancelled = false;
		const loadingTimer = setTimeout(() => {
			if (!cancelled) setStatusCounts((prev) => ({ ...prev, sourceUsed: source, loading: true, error: null }));
		}, 0);
		qraStatusCountsGet(source)
			.then((payload) => {
				if (cancelled) return;
				setStatusCounts({
					total: Number(payload.total ?? 0),
					sourceUsed: payload.source_used ?? source,
					counts: { ...EMPTY_QRA_STATUS_COUNTS, ...(payload.counts ?? {}) },
					loading: false,
					error: null,
					generatedAt: payload.generated_at,
					fetchedAt: new Date().toISOString(),
					lastSuccessfulAt: new Date().toISOString(),
					stale: false,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				setStatusCounts((prev) => ({
					...prev,
					loading: false,
					error: err instanceof Error ? err.message : String(err),
					fetchedAt: new Date().toISOString(),
					stale: Boolean(prev.lastSuccessfulAt || prev.generatedAt || prev.total > 0),
				}));
			});
		return () => {
			cancelled = true;
			clearTimeout(loadingTimer);
		};
	}, [source]);

	return statusCounts;
}

// ── useRelationships ────────────────────────────────────────────────────────
// sparta_relationships are DOCUMENTS with source_control_id / target_control_id.
// NOT ArangoDB edges — no _from/_to.

export function useRelationships(controlId?: string): HookResult<SpartaRelationship> {
	const [data, setData] = useState<SpartaRelationship[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (controlId) {
				const result = await recallPost(["sparta_relationships"], `relationships for ${controlId}`, { k: 50 });
				setData(result.items as unknown as SpartaRelationship[]);
				setTotal(result.items.length);
			} else {
				const result = await listPost("sparta_relationships", { limit: 100 });
				setData(result.documents as unknown as SpartaRelationship[]);
				setTotal(result.total);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [controlId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);
	return { data, total, loading, error, refresh: fetchData };
}

// ── useURLs ─────────────────────────────────────────────────────────────────

export function useURLs(query = "", domain?: string): HookResult<SpartaURL> {
	const debouncedQuery = useDebouncedValue(query);
	const [data, setData] = useState<SpartaURL[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (debouncedQuery) {
				const result = await recallPost(["sparta_urls"], debouncedQuery, { k: 100 });
				let items = result.items as unknown as SpartaURL[];
				if (domain) items = items.filter((u) => u.domain === domain);
				setData(items);
				setTotal(items.length);
			} else {
				const result = await listPost("sparta_urls", {
					limit: 100,
					return_fields: ["url_id", "url", "domain", "updated_at"],
				});
				let items = result.documents as unknown as SpartaURL[];
				if (domain) items = items.filter((u) => u.domain === domain);
				setData(items);
				setTotal(result.total);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [debouncedQuery, domain]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);
	return { data, total, loading, error, refresh: fetchData };
}

// ── useURLsPaginated ─────────────────────────────────────────────────────────

export function useURLsPaginated(
	page: number,
	pageSize: number,
): { data: SpartaURL[]; total: number; loading: boolean; error: string | null } {
	const [data, setData] = useState<SpartaURL[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await listPost("sparta_urls", {
				limit: pageSize,
				offset: page * pageSize,
				return_fields: ["url_id", "url", "domain", "updated_at"],
			});
			setData(result.documents as unknown as SpartaURL[]);
			setTotal(result.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [page, pageSize]);

	useEffect(() => {
		fetchPage();
	}, [fetchPage]);

	return { data, total, loading, error };
}

// ── useRelationshipsPaginated ────────────────────────────────────────────────

export function useRelationshipsPaginated(
	page: number,
	pageSize: number,
): { data: SpartaRelationship[]; total: number; loading: boolean; error: string | null } {
	const [data, setData] = useState<SpartaRelationship[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await listPost("sparta_relationships", {
				limit: pageSize,
				offset: page * pageSize,
			});
			setData(result.documents as unknown as SpartaRelationship[]);
			setTotal(result.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [page, pageSize]);

	useEffect(() => {
		fetchPage();
	}, [fetchPage]);

	return { data, total, loading, error };
}

// ── useKnowledge ────────────────────────────────────────────────────────────

export function useKnowledge(query = "", urlId?: string): HookResult<SpartaURLKnowledge> {
	const debouncedQuery = useDebouncedValue(query);
	const [data, setData] = useState<SpartaURLKnowledge[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (debouncedQuery || urlId) {
				const q = debouncedQuery || `knowledge for ${urlId}`;
				const result = await recallPost(["technique_knowledge", "sparta_url_knowledge"], q, { k: 50 });
				setData(result.items as unknown as SpartaURLKnowledge[]);
				setTotal(result.items.length);
			} else {
				const result = await listPost("sparta_url_knowledge", { limit: 50 });
				setData(result.documents as unknown as SpartaURLKnowledge[]);
				setTotal(result.total);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [debouncedQuery, urlId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);
	return { data, total, loading, error, refresh: fetchData };
}

// ── useCollectionCounts ─────────────────────────────────────────────────────
// v2 architecture (2026-04-20): includes separate canonical + relationship QRA counts

export interface CollectionCounts {
	controls: number;
	qras: number; // legacy sparta_qra
	qrasCanonical: number; // v2 sparta_qra_canonical
	qrasRelationship: number; // v2 sparta_qra_relationship
	qrasTotal: number; // sum of all QRA collections
	relationships: number;
	urls: number;
	knowledge: number;
	loading: boolean;
}

export function useCollectionCounts(): CollectionCounts {
	const [counts, setCounts] = useState<CollectionCounts>({
		controls: 0,
		qras: 0,
		qrasCanonical: 0,
		qrasRelationship: 0,
		qrasTotal: 0,
		relationships: 0,
		urls: 0,
		knowledge: 0,
		loading: true,
	});

	useEffect(() => {
		async function fetchCounts() {
			try {
				const res = await fetch(`${API_ROOT}/sparta/counts`);
				if (!res.ok) throw new Error(`/sparta/counts ${res.status}: ${await res.text()}`);
				const payload = await res.json();
				setCounts({
					controls: payload.controls ?? 0,
					qras: payload.qras ?? 0,
					qrasCanonical: payload.qrasCanonical ?? 0,
					qrasRelationship: payload.qrasRelationship ?? 0,
					qrasTotal: payload.qrasTotal ?? 0,
					relationships: payload.relationships ?? 0,
					urls: payload.urls ?? 0,
					knowledge: payload.knowledge ?? 0,
					loading: false,
				});
			} catch {
				setCounts((prev) => ({ ...prev, loading: false }));
			}
		}
		fetchCounts();
	}, []);

	return counts;
}

// ── useFrameworkCounts ───────────────────────────────────────────────────────
// Samples broadly across the collection to estimate per-framework control counts.
// Uses many offsets to get representative framework distribution, then extrapolates.

export interface FrameworkCount {
	name: string;
	count: number;
	pct: number;
}

export function useFrameworkCounts(): { data: FrameworkCount[]; loading: boolean } {
	const [data, setData] = useState<FrameworkCount[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function fetch() {
			try {
				// Get total count
				const meta = await listPost("sparta_controls", { limit: 1, return_fields: ["_key"] });
				const total = meta.total;

				// Sample 25 pages of 40 across the full range for good coverage
				const pageSize = 40;
				const numSamples = 25;
				const step = Math.max(1, Math.floor(total / numSamples));
				const offsets = Array.from({ length: numSamples }, (_, i) => i * step);

				const pages = await Promise.all(
					offsets.map((offset) =>
						listPost("sparta_controls", {
							limit: pageSize,
							offset,
							return_fields: ["source_framework"],
						}),
					),
				);

				// Count frameworks in sample
				const fwCounts = new Map<string, number>();
				let sampleSize = 0;
				for (const page of pages) {
					for (const doc of page.documents) {
						const fw = normalizeFramework((doc as { source_framework: string }).source_framework);
						fwCounts.set(fw, (fwCounts.get(fw) ?? 0) + 1);
						sampleSize++;
					}
				}

				// Extrapolate to total collection size
				const result: FrameworkCount[] = [...fwCounts.entries()]
					.map(([name, sampled]) => {
						const estimated = Math.round((sampled / sampleSize) * total);
						return { name, count: estimated, pct: (sampled / sampleSize) * 100 };
					})
					.sort((a, b) => b.count - a.count);

				setData(result);
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		}
		fetch();
	}, []);

	return { data, loading };
}

// ── useRawFrameworkCounts ────────────────────────────────────────────────────
// Returns cached framework counts. Single sample query, no parallel storm.
// Previous version made 17 parallel /list calls → crashed ArangoDB.

let _fwCountsCache: FrameworkCount[] | null = null;

export function useRawFrameworkCounts(): { data: FrameworkCount[]; loading: boolean } {
	const [data, setData] = useState<FrameworkCount[]>(_fwCountsCache ?? []);
	const [loading, setLoading] = useState(_fwCountsCache === null);

	useEffect(() => {
		if (_fwCountsCache) return; // Use cache

		async function fetchOnce() {
			try {
				// Single query: sample 500 docs to estimate framework distribution
				const res = await listPost("sparta_controls", {
					limit: 500,
					return_fields: ["source_framework"],
				});

				// Count frameworks in sample
				const counts = new Map<string, number>();
				for (const doc of res.documents) {
					const fw = (doc as { source_framework?: string }).source_framework ?? "unknown";
					counts.set(fw, (counts.get(fw) ?? 0) + 1);
				}

				// Extrapolate to total
				const sampleSize = res.documents.length;
				const total = res.total;
				const fwData: FrameworkCount[] = [...counts.entries()]
					.map(([name, sampled]) => ({
						name,
						count: Math.round((sampled / sampleSize) * total),
						pct: (sampled / sampleSize) * 100,
					}))
					.sort((a, b) => b.count - a.count);

				_fwCountsCache = fwData;
				setData(fwData);
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		}
		fetchOnce();
	}, []);

	return { data, loading };
}

// ── useControlsByFramework ──────────────────────────────────────────────────
// Loads controls for given frameworks via server-side filter.
// Optionally filters by controlType server-side to reduce memory usage.

export function useControlsByFramework(
	rawFrameworks: string[],
	controlType?: string,
): { data: SpartaControl[]; total: number; loading: boolean; error: string | null } {
	const [data, setData] = useState<SpartaControl[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		if (rawFrameworks.length === 0) {
			setData([]);
			setTotal(0);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			// Build filters - include controlType if specified for server-side filtering
			const baseFilters: Record<string, string> = {};
			if (controlType) baseFilters.control_type = controlType;

			// Fetch docs for each framework
			const results = await Promise.all(
				rawFrameworks.map(async (fw) => {
					const filters = { ...baseFilters, source_framework: fw };

					// First get total
					const meta = await listPost("sparta_controls", { limit: 1, filters, return_fields: ["_key"] });
					const fwTotal = meta.total;
					if (fwTotal === 0) return [];

					// Fetch in batches of 200 to avoid memory issues
					const all: SpartaControl[] = [];
					for (let offset = 0; offset < fwTotal; offset += 200) {
						const batch = await listPost("sparta_controls", {
							limit: 200,
							offset,
							return_fields: [
								"control_id",
								"name",
								"description",
								"source_framework",
								"control_type",
								"domain",
								"scope",
								"parent_id",
								"weaknesses",
								"mind",
							],
							filters,
						});
						all.push(...(batch.documents as unknown as SpartaControl[]));
					}
					return all;
				}),
			);

			const merged = results.flat();
			setData(merged);
			setTotal(merged.length);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [controlType, rawFrameworks]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	return { data, total, loading, error };
}

// ── Shared utility ──────────────────────────────────────────────────────────

export function normalizeFramework(fw: string): string {
	const map: Record<string, string> = {
		sparta: "SPARTA",
		nist: "NIST",
		cwe: "CWE",
		nvd: "CWE",
		iso: "ISO",
		att_ck_enterprise: "ATT&CK",
		att_ck_mobile: "ATT&CK",
		att_ck_ics: "ATT&CK",
		d3fend: "D3FEND",
	};
	return map[fw.toLowerCase()] ?? fw;
}
