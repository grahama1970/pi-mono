import { useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorksheetConfig {
	type?: string;
	framework?: string;
	table_name?: string;
	description?: string;
	row_count?: number;
	columns?: string[];
	relationships?: string[];
	description_source?: string;
	description_preserve?: boolean;
	extract_urls?: boolean;
	[key: string]: unknown;
}

export interface SourceDef {
	name: string;
	group: "sparta" | "external" | "urls";
	rawFrameworks: string[];
	controlType?: string;
	file: string;
	minExpected: number;
	tooltip: string;
}

// ── worksheetToSourceDef ─────────────────────────────────────────────────────

const SPARTA_FRAMEWORKS = new Set(["sparta", "d3fend", "iso", "nasa"]);
const EXTERNAL_FRAMEWORKS = new Set(["attack", "cwe", "nvd", "esa"]);

export function worksheetToSourceDef(name: string, config: WorksheetConfig): SourceDef {
	const framework = (config.framework ?? "").toLowerCase();

	let group: SourceDef["group"];
	if (SPARTA_FRAMEWORKS.has(framework)) {
		group = "sparta";
	} else if (EXTERNAL_FRAMEWORKS.has(framework)) {
		group = "external";
	} else {
		group = "urls";
	}

	return {
		name,
		group,
		rawFrameworks: [framework, framework.toUpperCase()],
		controlType: config.type,
		file: config.table_name ?? "SPARTA-Data.xlsx",
		minExpected: config.row_count ?? 1,
		tooltip: config.description ?? name,
	};
}

// ── useWorksheets ────────────────────────────────────────────────────────────

interface UseWorksheetsResult {
	worksheets: Record<string, WorksheetConfig>;
	loading: boolean;
	error: string | null;
}

export function useWorksheets(): UseWorksheetsResult {
	const [worksheets, setWorksheets] = useState<Record<string, WorksheetConfig>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchWorksheets() {
			setLoading(true);
			setError(null);
			try {
				const res = await fetch("http://localhost:3001/api/worksheets");
				if (!res.ok) throw new Error(`/api/worksheets ${res.status}: ${await res.text()}`);
				const data = (await res.json()) as { worksheets: Record<string, WorksheetConfig> };
				if (!cancelled) {
					setWorksheets(data.worksheets ?? {});
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		fetchWorksheets();
		return () => {
			cancelled = true;
		};
	}, []);

	return { worksheets, loading, error };
}
