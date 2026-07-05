/**
 * Shared artifact teaser helpers for stream-style chat receipts.
 */
import type { Artifact } from "./types";

export function isThreatMapArtifact(artifact: Artifact): boolean {
	return /threat\s*map/i.test(artifact.title) || artifact.type === "graph";
}

export function artifactPreviewSvg(artifact: Artifact): string | null {
	const svg = artifact.preview?.content?.trim();
	if (svg && svg.startsWith("<svg")) return svg;
	if (
		(artifact.type === "figure" || artifact.type === "graph") &&
		typeof artifact.content === "string" &&
		artifact.content.trim().startsWith("<svg")
	) {
		return artifact.content.trim();
	}
	return null;
}

export function artifactHasInteractivePreview(artifact: Artifact): boolean {
	return (artifact.type === "figure" || artifact.type === "graph") && Boolean(artifactPreviewSvg(artifact));
}

export function deriveSnapshotUpdated(artifacts: Artifact[]): string | null {
	for (const artifact of artifacts) {
		const meta = artifact as Artifact & { refreshedAt?: string };
		if (meta.refreshedAt) return meta.refreshedAt;
		const fromContent = artifact.content?.match(/refreshed\s+(\d{4}-\d{2}-\d{2})/i);
		if (fromContent) return fromContent[1];
	}
	return null;
}
