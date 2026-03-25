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

const API = "http://localhost:3001/api/memory";

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

export interface SpartaQRA {
	_key: string;
	_id: string;
	control_id: string;
	question: string;
	reasoning: string;
	answer: string;
	grounding_score?: number;
	mind?: string[];
	tier0_pass?: boolean;
	tier15_pass?: boolean;
	tier2_pass?: boolean;
	source_framework?: string;
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

export function useQRAs(query = "", controlId?: string): HookResult<SpartaQRA> {
	const debouncedQuery = useDebouncedValue(query);
	const [data, setData] = useState<SpartaQRA[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (debouncedQuery || controlId) {
				const q = debouncedQuery || `QRA for ${controlId}`;
				const opts: { k?: number; entities?: string[] } = { k: 50 };
				if (controlId) opts.entities = [controlId];
				const result = await recallPost(["sparta_qra"], q, opts);
				setData(result.items as unknown as SpartaQRA[]);
				setTotal(result.items.length);
			} else {
				const result = await listPost("sparta_qra", { limit: 50 });
				setData(result.documents as unknown as SpartaQRA[]);
				setTotal(result.total);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [debouncedQuery, controlId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);
	return { data, total, loading, error, refresh: fetchData };
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
				const result = await listPost("sparta_urls", { limit: 100 });
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

export interface CollectionCounts {
	controls: number;
	qras: number;
	relationships: number;
	urls: number;
	knowledge: number;
	loading: boolean;
}

export function useCollectionCounts(): CollectionCounts {
	const [counts, setCounts] = useState<CollectionCounts>({
		controls: 0,
		qras: 0,
		relationships: 0,
		urls: 0,
		knowledge: 0,
		loading: true,
	});

	useEffect(() => {
		async function fetchCounts() {
			try {
				const [c, q, r, u, k] = await Promise.all([
					listPost("sparta_controls", { limit: 1 }),
					listPost("sparta_qra", { limit: 1 }),
					listPost("sparta_relationships", { limit: 1 }),
					listPost("sparta_urls", { limit: 1 }),
					listPost("sparta_url_knowledge", { limit: 1 }),
				]);
				setCounts({
					controls: c.total,
					qras: q.total,
					relationships: r.total,
					urls: u.total,
					knowledge: k.total,
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
				const meta = await listPost("sparta_controls", { limit: 1 });
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
// Exact per-framework counts via server-side filters.
// One /list call per known framework value — returns exact total, not sampled estimate.

const ALL_RAW_FRAMEWORKS = [
	"SPARTA",
	"sparta",
	"NIST",
	"nist",
	"CWE",
	"cwe",
	"nvd",
	"NVD",
	"D3FEND",
	"d3fend",
	"ATT_CK_Enterprise",
	"attack",
	"ATT_CK_Mobile",
	"ATT_CK_ICS",
	"ESA",
	"ISO",
	"iso",
	"NASA",
];

export function useRawFrameworkCounts(): { data: FrameworkCount[]; loading: boolean } {
	const [data, setData] = useState<FrameworkCount[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function fetchExact() {
			try {
				const results = await Promise.all(
					ALL_RAW_FRAMEWORKS.map(async (fw) => {
						const r = await listPost("sparta_controls", {
							limit: 1,
							filters: { source_framework: fw },
						});
						return { name: fw, total: r.total };
					}),
				);

				const totalAll = results.reduce((sum, r) => sum + r.total, 0);
				const fwData: FrameworkCount[] = results
					.filter((r) => r.total > 0)
					.map((r) => ({ name: r.name, count: r.total, pct: totalAll > 0 ? (r.total / totalAll) * 100 : 0 }))
					.sort((a, b) => b.count - a.count);

				setData(fwData);
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		}
		fetchExact();
	}, []);

	return { data, loading };
}

// ── useControlsByFramework ──────────────────────────────────────────────────
// Loads ALL controls for given frameworks via server-side filter.
// For small-to-medium frameworks (<5000), fetches all docs so client-side
// type filtering works correctly. Paginates display, not fetch.

export function useControlsByFramework(
	rawFrameworks: string[],
	_page = 0,
	_pageSize = 100,
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
			// Fetch all docs for each raw framework (most are <2000)
			const results = await Promise.all(
				rawFrameworks.map(async (fw) => {
					// First get total
					const meta = await listPost("sparta_controls", {
						limit: 1,
						filters: { source_framework: fw },
					});
					const fwTotal = meta.total;
					if (fwTotal === 0) return [];

					// Fetch all in batches of 500
					const all: SpartaControl[] = [];
					for (let offset = 0; offset < fwTotal; offset += 500) {
						const batch = await listPost("sparta_controls", {
							limit: 500,
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
							filters: { source_framework: fw },
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
	}, [rawFrameworks.length, rawFrameworks.map]);

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
