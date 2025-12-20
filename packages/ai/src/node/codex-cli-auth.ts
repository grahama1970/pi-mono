import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexCliAuth {
	accessToken: string;
	expiresAtMs?: number;
}

export interface CodexCliAuthOptions {
	/**
	 * Path to Codex CLI auth file.
	 * Defaults to "~/.codex/auth.json".
	 */
	authJsonPath?: string;
}

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

function defaultAuthJsonPath(): string {
	return join(homedir(), ".codex", "auth.json");
}

export async function getCodexCliAuth(options: CodexCliAuthOptions = {}): Promise<CodexCliAuth | undefined> {
	const authJsonPath = options.authJsonPath ?? defaultAuthJsonPath();

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
	if (!accessToken) return undefined;

	const expiresAtMs = extractJwtExpMs(accessToken);
	if (expiresAtMs !== undefined && expiresAtMs <= Date.now()) return undefined;

	return {
		accessToken,
		expiresAtMs,
	};
}
