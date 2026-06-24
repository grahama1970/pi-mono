/**
 * Derive compact "Sources" chips for the Gemini-style turn chrome row.
 */

import { distinctChatArtifacts } from "./evidenceCaseReceipt";
import type { Artifact, EvidenceCaseData } from "./types";

export interface ChatSourceChip {
	id: string;
	label: string;
	/** Short domain or category shown in favicon stack */
	domain: string;
	/** Stable hue 0–360 for placeholder favicon */
	hue: number;
}

function hashHue(text: string): number {
	let h = 0;
	for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
	return h;
}

function domainFromLabel(label: string): string {
	const trimmed = label.trim();
	try {
		const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
		return url.hostname.replace(/^www\./, "");
	} catch {
		/* not a URL */
	}
	if (/\.(pdf|md|html?)$/i.test(trimmed)) {
		const base = trimmed.split("/").pop() ?? trimmed;
		return base.replace(/\.[^.]+$/, "").slice(0, 24);
	}
	if (/^(capec|CWE|ATT&CK|T\d{4})/i.test(trimmed)) return trimmed.split(/[\s:]/)[0].slice(0, 20);
	return trimmed.slice(0, 28);
}

function pushChip(chips: ChatSourceChip[], seen: Set<string>, id: string, label: string) {
	const key = id.toLowerCase();
	if (!label.trim() || seen.has(key)) return;
	seen.add(key);
	const domain = domainFromLabel(label);
	chips.push({ id, label: label.trim(), domain, hue: hashHue(domain) });
}

export function deriveMessageSources(
	evidenceCase: EvidenceCaseData | undefined,
	artifacts: Artifact[] | undefined,
): ChatSourceChip[] {
	const chips: ChatSourceChip[] = [];
	const seen = new Set<string>();

	const bound = evidenceCase?.artifact?.name || evidenceCase?.bound_artifact;
	if (bound && bound !== "Artifact pending") {
		pushChip(chips, seen, `bound:${bound}`, bound);
	}

	for (const artifact of distinctChatArtifacts(evidenceCase, artifacts)) {
		pushChip(chips, seen, `artifact:${artifact.id}`, artifact.title || artifact.id);
	}

	const citations = evidenceCase?.citations ?? [];
	for (const citation of citations) {
		pushChip(chips, seen, `cite:${citation}`, citation);
	}

	return chips;
}
