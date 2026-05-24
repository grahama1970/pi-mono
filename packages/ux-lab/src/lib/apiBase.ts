const configuredApiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export const API_ORIGIN = configuredApiBase.endsWith("/api")
	? configuredApiBase.slice(0, -"/api".length)
	: configuredApiBase;

export const API_ROOT = configuredApiBase
	? configuredApiBase.endsWith("/api")
		? configuredApiBase
		: `${configuredApiBase}/api`
	: "/api";

export const MEMORY_API_ROOT = `${API_ROOT}/memory`;

export function apiUrl(path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	if (path.startsWith("/api/")) return `${API_ORIGIN}${path}`;
	if (path.startsWith("/")) return `${API_ROOT}${path}`;
	return `${API_ROOT}/${path}`;
}
