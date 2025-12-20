// Experimental/unsupported Codex backend integration (non-public API surface).
type UnknownRecord = Record<string, unknown>;
type BufferCtor = {
	from(data: string, encoding: string): { toString(encoding: string): string };
};

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlDecodeUtf8(data: string): string | undefined {
	const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "===".slice((normalized.length + 3) % 4);

	const atobFn = (globalThis as unknown as UnknownRecord).atob;
	if (typeof atobFn === "function") {
		try {
			return (atobFn as (input: string) => string)(padded);
		} catch {
			// fallthrough
		}
	}

	const bufferCtor = (globalThis as UnknownRecord).Buffer as BufferCtor | undefined;
	if (bufferCtor && typeof bufferCtor.from === "function") {
		try {
			return bufferCtor.from(padded, "base64").toString("utf8");
		} catch {
			return undefined;
		}
	}

	return undefined;
}

function getChatGptAccountIdFromAccessToken(accessToken: string): string | undefined {
	const parts = accessToken.split(".");
	if (parts.length !== 3) return undefined;
	const payloadB64 = parts[1];
	if (!payloadB64) return undefined;

	const payloadJson = base64UrlDecodeUtf8(payloadB64);
	if (!payloadJson) return undefined;

	try {
		const payload = JSON.parse(payloadJson) as unknown;
		if (!isRecord(payload)) return undefined;
		const auth = payload["https://api.openai.com/auth"];
		if (!isRecord(auth)) return undefined;
		const accountId = auth.chatgpt_account_id;
		return typeof accountId === "string" && accountId.trim() !== "" ? accountId : undefined;
	} catch {
		return undefined;
	}
}

function createSessionId(): string {
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function isProbablyBrowser(): boolean {
	const g = globalThis as unknown as UnknownRecord;
	return typeof g.window === "object" && g.window !== null;
}

export function applyCodexHeaders(headers: Record<string, string>, apiKey?: string): void {
	headers.Version = headers.Version || "0.21.0";
	headers["Openai-Beta"] = headers["Openai-Beta"] || "responses=experimental";
	headers.Session_id = headers.Session_id || createSessionId();
	headers.Originator = headers.Originator || "codex_cli_rs";

	const accountId =
		typeof apiKey === "string" && !isProbablyBrowser() ? getChatGptAccountIdFromAccessToken(apiKey) : undefined;
	if (accountId) {
		headers["Chatgpt-Account-Id"] = accountId;
	}

	if (!isProbablyBrowser() && !headers["User-Agent"]) {
		headers["User-Agent"] = "codex_cli_rs/0.50.0 (pi-mono)";
	}
}
