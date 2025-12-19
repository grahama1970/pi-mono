import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CodexCliAuth {
	accessToken: string;
	refreshToken?: string;
	idToken?: string;
	expiresAtMs?: number;
}

export interface CodexCliAuthOptions {
	/**
	 * Path to Codex CLI auth file.
	 * Defaults to "~/.codex/auth.json".
	 */
	authJsonPath?: string;

	/**
	 * Refresh token if the access token expires within this many seconds.
	 * Defaults to 120 seconds.
	 */
	refreshLeewaySeconds?: number;

	/**
	 * OpenAI OAuth client id used by Codex CLI.
	 * Defaults to the one used in CLIProxyAPIPlus.
	 */
	oauthClientId?: string;

	/**
	 * OAuth token endpoint.
	 * Defaults to "https://auth.openai.com/oauth/token".
	 */
	tokenUrl?: string;

	/**
	 * If true, write refreshed tokens back to authJsonPath.
	 * Defaults to true.
	 */
	writeBack?: boolean;
}

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_REFRESH_LEEWAY_SECONDS = 120;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOptionalString(obj: UnknownRecord, key: string): string | undefined {
	const value = obj[key];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function base64UrlDecodeToUtf8(data: string): string {
	const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "===".slice((normalized.length + 3) % 4);
	return Buffer.from(padded, "base64").toString("utf8");
}

function extractJwtExpMs(jwt: string): number | undefined {
	const parts = jwt.split(".");
	if (parts.length !== 3) return undefined;
	const payloadB64 = parts[1];
	if (!payloadB64) return undefined;
	try {
		const payloadJson = base64UrlDecodeToUtf8(payloadB64);
		const payload = JSON.parse(payloadJson) as unknown;
		if (!isRecord(payload)) return undefined;
		const exp = payload.exp;
		if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) {
			return Math.floor(exp * 1000);
		}
		return undefined;
	} catch {
		return undefined;
	}
}

async function readJsonFile(path: string): Promise<unknown> {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as unknown;
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true, mode: 0o700 });

	const tmpPath = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
	const json = `${JSON.stringify(data, null, 2)}\n`;
	await writeFile(tmpPath, json, { mode: 0o600 });
	await rename(tmpPath, path);
}

function defaultAuthJsonPath(): string {
	return join(homedir(), ".codex", "auth.json");
}

interface TokenRefreshResponse {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	expires_in?: number;
	token_type?: string;
}

async function refreshTokens(params: {
	tokenUrl: string;
	clientId: string;
	refreshToken: string;
	signal?: AbortSignal;
}): Promise<TokenRefreshResponse> {
	const body = new URLSearchParams();
	body.set("client_id", params.clientId);
	body.set("grant_type", "refresh_token");
	body.set("refresh_token", params.refreshToken);
	body.set("scope", "openid profile email");

	const resp = await fetch(params.tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body,
		signal: params.signal,
	});

	const text = await resp.text();
	if (!resp.ok) {
		throw new Error(`Codex token refresh failed (${resp.status}): ${text}`);
	}

	const json = JSON.parse(text) as unknown;
	if (!isRecord(json)) {
		throw new Error("Codex token refresh returned non-object JSON");
	}

	const accessToken = getOptionalString(json, "access_token");
	if (!accessToken) {
		throw new Error("Codex token refresh response missing access_token");
	}

	const token: TokenRefreshResponse = {
		access_token: accessToken,
		refresh_token: getOptionalString(json, "refresh_token"),
		id_token: getOptionalString(json, "id_token"),
	};

	const expiresIn = json.expires_in;
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
		token.expires_in = expiresIn;
	}

	const tokenType = getOptionalString(json, "token_type");
	if (tokenType) token.token_type = tokenType;

	return token;
}

export async function getCodexCliAuth(options: CodexCliAuthOptions = {}): Promise<CodexCliAuth | undefined> {
	const authJsonPath = options.authJsonPath ?? defaultAuthJsonPath();
	const refreshLeewaySeconds = options.refreshLeewaySeconds ?? DEFAULT_REFRESH_LEEWAY_SECONDS;
	const clientId = options.oauthClientId ?? CODEX_CLIENT_ID;
	const tokenUrl = options.tokenUrl ?? CODEX_TOKEN_URL;
	const writeBack = options.writeBack ?? true;

	let file: unknown;
	try {
		file = await readJsonFile(authJsonPath);
	} catch {
		return undefined;
	}

	if (!isRecord(file)) return undefined;
	const tokens = file.tokens;
	if (!isRecord(tokens)) return undefined;

	const accessToken = getOptionalString(tokens, "access_token");
	const refreshToken = getOptionalString(tokens, "refresh_token");
	const idToken = getOptionalString(tokens, "id_token");
	if (!accessToken) return undefined;

	const expiresAtMs = extractJwtExpMs(accessToken);
	const now = Date.now();
	const isExpiringSoon = expiresAtMs !== undefined && expiresAtMs - now <= Math.max(0, refreshLeewaySeconds) * 1000;

	if (isExpiringSoon && refreshToken) {
		const refreshed = await refreshTokens({ tokenUrl, clientId, refreshToken });
		const nextAccessToken = refreshed.access_token;
		const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
		const nextIdToken = refreshed.id_token ?? idToken;

		// Update file in-place (preserve unknown keys)
		(tokens as UnknownRecord).access_token = nextAccessToken;
		(tokens as UnknownRecord).refresh_token = nextRefreshToken;
		if (nextIdToken) (tokens as UnknownRecord).id_token = nextIdToken;
		(file as UnknownRecord).last_refresh = new Date().toISOString();

		if (writeBack) {
			await writeJsonFile(authJsonPath, file);
		}

		return {
			accessToken: nextAccessToken,
			refreshToken: nextRefreshToken,
			idToken: nextIdToken,
			expiresAtMs: extractJwtExpMs(nextAccessToken),
		};
	}

	return {
		accessToken,
		refreshToken,
		idToken,
		expiresAtMs,
	};
}
