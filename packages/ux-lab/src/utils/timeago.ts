/**
 * Returns a human-readable relative time string for a given timestamp.
 */
export function timeAgo(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffS = Math.floor(diffMs / 1000);

	if (diffS < 5) return "just now";
	if (diffS < 60) return `${diffS}s ago`;

	const diffM = Math.floor(diffS / 60);
	if (diffM < 60) return `${diffM}m ago`;

	const diffH = Math.floor(diffM / 60);
	if (diffH < 24) return `${diffH}h ago`;

	const diffD = Math.floor(diffH / 24);
	return `${diffD}d ago`;
}
